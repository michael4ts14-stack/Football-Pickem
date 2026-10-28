// doPost email service (apps-script/Email.js). Run with: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { loadBot, makeResponse } = require("./harness");

const PROJECT = "football-pickem-46206";
const COMMISH = "michael4ts14@gmail.com";
const PLAYER = "u2cantcme2@gmail.com";

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
// Unsigned test token; the signature is checked by Identity Toolkit, which is stubbed here.
function token(uid, over) {
  const now = Math.floor(Date.now() / 1000);
  return [b64url({ alg: "RS256" }), b64url(Object.assign({ aud: PROJECT, iss: "https://securetoken.google.com/" + PROJECT, user_id: uid, exp: now + 3600 }, over || {})), "sig"].join(".");
}

const USERS = {
  "uid-commish": { localId: "uid-commish", email: COMMISH, emailVerified: true },
  "uid-player": { localId: "uid-player", email: PLAYER, emailVerified: true },
  "uid-unverified": { localId: "uid-unverified", email: "new@example.com", emailVerified: false },
};

function cloud(over) {
  return Object.assign({
    currentWeek: 9,
    weekLabel: "Week 9",
    customGames: [
      { id: 1, away: "Arizona", home: "Texas Tech", awayPts: 1, homePts: 1 },
      { id: 2, away: "Iowa", home: "Ohio State", awayPts: 2, homePts: 1 },
    ],
    poolMembers: [
      { name: "Player One", linkedAuthEmail: PLAYER, picks: {} },
      { name: "Someone Real", linkedAuthEmail: "real.member@example.com", picks: { 1: "Arizona" } },
    ],
    playerKey: { picks: { 1: "Arizona", 2: "Iowa" }, tiebreaker: "31-24" },
  }, over || {});
}

function service(opts) {
  opts = opts || {};
  return loadBot(Object.assign({
    cloud: cloud(opts.cloudOver),
    docs: Object.assign({
      ["pickem_v14_accounts/email_" + PLAYER.replace(/[^a-z0-9]/g, "_")]: { uid: "uid-player", boundProfileKey: "playerKey", linkedMemberName: "Player One" },
    }, opts.docs || {}),
    extraFetch: (url, params) => {
      if (url.indexOf("identitytoolkit.googleapis.com") !== -1) {
        const claims = JSON.parse(Buffer.from(JSON.parse(params.payload).idToken.split(".")[1], "base64").toString());
        const u = USERS[claims.user_id];
        return u ? makeResponse(200, { users: [u] }) : makeResponse(400, { error: { message: "INVALID_ID_TOKEN" } });
      }
      return null;
    },
  }, opts));
}

function post(h, body) {
  const out = h.ctx.doPost({ postData: { contents: JSON.stringify(body) } });
  return JSON.parse(out.text);
}

const logWrites = (h) => h.calls.filter((c) => c.url.indexOf("pickem_v14_email_log") !== -1);

test("ping answers without a sign-in and reports the API version and quota", () => {
  const r = post(service(), { action: "ping" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.apiVersion, 2);
  assert.strictEqual(r.quota, 100);
});

test("guests (no token) are told to sign in, and nothing is sent", () => {
  const h = service();
  const r = post(h, { action: "sendPickReceipt", email: "anyone@example.com" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "NOT_SIGNED_IN");
  assert.strictEqual(h.sentMail.length, 0);
});

test("a token for another project or an expired one is rejected", () => {
  const h = service();
  assert.strictEqual(post(h, { action: "sendPickReceipt", idToken: token("uid-player", { aud: "other-app" }) }).code, "INVALID_TOKEN");
  assert.strictEqual(post(h, { action: "sendPickReceipt", idToken: token("uid-player", { exp: 1 }) }).code, "TOKEN_EXPIRED");
  assert.strictEqual(post(h, { action: "sendPickReceipt", idToken: token("uid-nobody") }).code, "INVALID_TOKEN");
  assert.strictEqual(post(h, { action: "sendPickReceipt", idToken: "a.b.c" }).code, "INVALID_TOKEN");
  assert.strictEqual(h.sentMail.length, 0);
});

test("the token check says where it's from (the API key is referrer-restricted)", () => {
  const h = service();
  post(h, { action: "sendPickReceipt", idToken: token("uid-player") });
  const lookup = h.calls.find((c) => c.url.indexOf("accounts:lookup") !== -1);
  assert.strictEqual(lookup.params.headers.Referer, "https://football-pickem-46206.web.app/");
});

test("a blocked token check is its own error, not 'bad sign-in'", () => {
  const h = service({ extraFetch: (url) => (url.indexOf("identitytoolkit") !== -1 ? makeResponse(403, { error: { code: 403, message: "Requests from referer <empty> are blocked." } }) : null) });
  const r = post(h, { action: "sendPickReceipt", idToken: token("uid-player") });
  assert.strictEqual(r.code, "VERIFY_UNAVAILABLE");
  assert.match(r.error, /referer/);
  assert.strictEqual(h.sentMail.length, 0);
});

test("a receipt goes only to the caller's verified email, with picks read on the server", () => {
  const h = service();
  const r = post(h, { action: "sendPickReceipt", idToken: token("uid-player"), email: "victim@example.com", picks: { 1: "Texas Tech" } });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.sentTo, PLAYER);
  assert.strictEqual(h.sentMail.length, 1);
  assert.strictEqual(h.sentMail[0].to, PLAYER);
  assert.match(h.sentMail[0].body, /Arizona at Texas Tech: Arizona/);
  assert.match(h.sentMail[0].body, /Tie-breaker: 31-24/);
  assert.strictEqual(r.quota, 99);
  assert.strictEqual(logWrites(h).length, 1);
});

test("a second receipt within 45s is suppressed, and the hourly limit applies", () => {
  const h = service();
  post(h, { action: "sendPickReceipt", idToken: token("uid-player") });
  const dup = post(h, { action: "sendPickReceipt", idToken: token("uid-player") });
  assert.strictEqual(dup.suppressedDuplicate, true);
  assert.strictEqual(h.sentMail.length, 1);
  for (const k of Object.keys(h.cacheStore)) if (k.indexOf("rcpt_") === 0) delete h.cacheStore[k];
  h.cacheStore[Object.keys(h.cacheStore).find((k) => k.indexOf("rl_") === 0)] = "5";
  assert.strictEqual(post(h, { action: "sendPickReceipt", idToken: token("uid-player") }).code, "RATE_LIMITED");
});

test("verifying your email works right away (unverified checks aren't remembered)", () => {
  const h = service();
  const tok = token("uid-unverified");
  assert.strictEqual(post(h, { action: "sendPickReceipt", idToken: tok }).code, "EMAIL_NOT_VERIFIED");
  USERS["uid-unverified"].emailVerified = true;
  try {
    assert.notStrictEqual(post(h, { action: "sendPickReceipt", idToken: tok }).code, "EMAIL_NOT_VERIFIED");
  } finally { USERS["uid-unverified"].emailVerified = false; }
});

test("the send log says what the Pool emails switch did", () => {
  const h = service();
  post(h, { action: "setBroadcastsEnabled", idToken: token("uid-commish"), enabled: true });
  const entry = h.ctx.fromFirestoreValue({ mapValue: JSON.parse(logWrites(h)[0].params.payload) });
  assert.strictEqual(entry.detail, "Pool emails turned on");
});

test("an unverified email can't get a receipt", () => {
  const r = post(service(), { action: "sendPickReceipt", idToken: token("uid-unverified") });
  assert.strictEqual(r.code, "EMAIL_NOT_VERIFIED");
});

test("no current week means nothing is sent (no old-week fallback)", () => {
  const h = service({ cloudOver: { currentWeek: null } });
  const r = post(h, { action: "sendPickReceipt", idToken: token("uid-player") });
  assert.strictEqual(r.code, "NO_WEEK");
  assert.strictEqual(h.sentMail.length, 0);
});

test("a non-commissioner can't send broadcasts or read status", () => {
  const h = service({ scriptProps: { BROADCASTS_ENABLED: "true" } });
  for (const action of ["sendWedThuNudge", "sendSaturdayMasterSheet", "emailMasterCsvToAll", "status", "setBroadcastsEnabled"]) {
    const r = post(h, { action, idToken: token("uid-player"), enabled: true });
    assert.strictEqual(r.code, "NOT_COMMISSIONER", action);
  }
  assert.strictEqual(h.sentMail.length, 0);
  assert.strictEqual(h.scriptProps.store.BROADCASTS_ENABLED, "true");
});

test("kill switch: off blocks pool sends, test recipients still work, the commissioner can flip it", () => {
  const h = service();
  const off = post(h, { action: "sendSaturdayMasterSheet", idToken: token("uid-commish") });
  assert.strictEqual(off.code, "BROADCASTS_OFF");
  assert.strictEqual(h.sentMail.length, 0);

  const t = post(h, { action: "sendWedThuNudge", idToken: token("uid-commish"), testRecipients: [PLAYER, COMMISH] });
  assert.strictEqual(t.ok, true, JSON.stringify(t));
  assert.deepStrictEqual(h.sentMail.map((m) => m.to).sort(), [COMMISH, PLAYER].sort());
  assert.strictEqual(t.test, true);

  const st = post(h, { action: "status", idToken: token("uid-commish") });
  assert.strictEqual(st.broadcastsEnabled, false);
  const on = post(h, { action: "setBroadcastsEnabled", idToken: token("uid-commish"), enabled: true });
  assert.strictEqual(on.broadcastsEnabled, true);
  assert.strictEqual(h.scriptProps.store.BROADCASTS_ENABLED, "true");
});

test("a broadcast larger than the remaining quota sends nothing", () => {
  const h = service({ quota: 1, scriptProps: { BROADCASTS_ENABLED: "true" } });
  const r = post(h, { action: "sendWedThuNudge", idToken: token("uid-commish"), testRecipients: ["a@example.com", "b@example.com"] });
  assert.strictEqual(r.code, "QUOTA_TOO_LOW");
  assert.strictEqual(r.quota, 1);
  assert.strictEqual(h.sentMail.length, 0);
});

test("unknown actions get a clear JSON error, and every attempt is logged", () => {
  const h = service();
  const r = post(h, { action: "deleteEverything", idToken: token("uid-commish") });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "UNKNOWN_ACTION");
  const logs = logWrites(h);
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].params.headers.Authorization, "Bearer owner-token");
  const entry = h.ctx.fromFirestoreValue({ mapValue: JSON.parse(logs[0].params.payload) });
  assert.strictEqual(entry.action, "deleteEverything");
  assert.strictEqual(entry.caller, COMMISH);
  assert.strictEqual(entry.ok, false);
});

test("bad JSON body is answered, not thrown", () => {
  const h = service();
  const r = JSON.parse(h.ctx.doPost({ postData: { contents: "{not json" } }).text);
  assert.strictEqual(r.code, "BAD_REQUEST");
});

test("the open GET link does nothing (no bot run, no emergency stop)", () => {
  const h = service();
  for (const action of ["", "emergencyStop", "syncEspn", "pollSubMinute"]) {
    const r = JSON.parse(h.ctx.doGet({ parameter: { action, force: "1" } }).text);
    assert.strictEqual(r.ok, true);
  }
  assert.strictEqual(h.calls.length, 0);
});

test("running the Gmail bot or the emergency stop needs a commissioner", () => {
  const h = service();
  for (const action of ["runGmailBot", "emergencyStop"]) {
    assert.strictEqual(post(h, { action }).code, "NOT_SIGNED_IN", action);
    assert.strictEqual(post(h, { action, idToken: token("uid-player") }).code, "NOT_COMMISSIONER", action);
  }
});
