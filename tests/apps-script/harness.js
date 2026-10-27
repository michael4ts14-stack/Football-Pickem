// Loads apps-script/Code.js into a Node VM with stubbed Google Apps Script services
// so trigger functions can be exercised offline. Usage: const h = loadBot({ cloud, fetchHandler })
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CODE_PATH = path.join(__dirname, "..", "..", "apps-script", "Code.js");

function makeResponse(code, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body || {});
  return { getResponseCode: () => code, getContentText: () => text };
}

function makeProps(initial) {
  const store = Object.assign({}, initial || {});
  return {
    store,
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); },
    deleteProperty: (k) => { delete store[k]; },
  };
}

function loadBot(opts) {
  opts = opts || {};
  const calls = [];
  const logs = [];
  const scriptProps = makeProps(opts.scriptProps);
  const userProps = makeProps(opts.userProps);
  let lockHeld = !!opts.lockHeld;
  const sleeps = [];

  // Default Firestore/ESPN behaviour: GET shared_state returns opts.cloud, PATCH returns 200.
  function defaultFetch(url, params) {
    params = params || {};
    const method = (params.method || "get").toLowerCase();
    if (url.indexOf("firestore.googleapis.com") !== -1) {
      if (method === "get") {
        const docPath = url.split("/documents/")[1].split("?")[0];
        const doc = (opts.docs || {})[docPath] || (docPath === "pickem_v14/shared_state" ? opts.cloud : null);
        if (!doc) return makeResponse(404, { error: { code: 404, status: "NOT_FOUND" } });
        return makeResponse(200, { fields: ctx.toFirestoreValue(doc).mapValue.fields });
      }
      return makeResponse(opts.patchStatus || 200, opts.patchStatus && opts.patchStatus !== 200
        ? { error: { code: opts.patchStatus, message: "Missing or insufficient permissions.", status: "PERMISSION_DENIED" } }
        : {});
    }
    if (url.indexOf("espn.com") !== -1) {
      return makeResponse(opts.espnStatus || 200, opts.espnBody || { events: [] });
    }
    return makeResponse(200, "");
  }

  const fetchHandler = opts.fetchHandler || defaultFetch;
  const UrlFetchApp = {
    fetch: (url, params) => { calls.push({ url, params: params || {} }); return fetchHandler(url, params || {}); },
    fetchAll: (reqs) => reqs.map((r) => { calls.push({ url: r.url, params: r }); return fetchHandler(r.url, r); }),
  };

  const ctx = {
    console,
    JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, parseInt, parseFloat, isFinite, encodeURIComponent,
    Logger: { log: (m) => logs.push(String(m)) },
    UrlFetchApp,
    PropertiesService: { getScriptProperties: () => scriptProps, getUserProperties: () => userProps },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { if (lockHeld) return false; lockHeld = true; return true; },
        waitLock: () => { if (lockHeld) throw new Error("Lock timeout"); lockHeld = true; },
        releaseLock: () => { lockHeld = false; },
        hasLock: () => lockHeld,
      }),
    },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    Utilities: {
      sleep: (ms) => sleeps.push(ms),
      formatDate: (d, tz, fmt) => {
        const day = opts.isoDay || 2; // default Tuesday
        if (fmt === "u") return String(day);
        if (fmt === "H") return String(opts.hour || 12);
        if (fmt === "yyyyMMdd") return "20261027";
        return d.toISOString();
      },
      base64Encode: (s) => Buffer.from(String(s)).toString("base64"),
      parseCsv: (t) => t.split(/\r?\n/).filter(Boolean).map((l) => l.split(",")),
      unzip: () => [],
      newBlob: () => ({}),
    },
    Session: { getActiveUser: () => ({ getEmail: () => "michael4ts14@gmail.com" }) },
    GmailApp: { search: () => opts.threads || [] },
    MailApp: { sendEmail: () => {}, getRemainingDailyQuota: () => 100 },
    ScriptApp: { getOAuthToken: () => "test-oauth-token", getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {} }) }) }) },
    ContentService: {
      createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }),
      MimeType: { JSON: "json" },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(CODE_PATH, "utf8"), ctx, { filename: "Code.js" });

  return {
    ctx, calls, logs, scriptProps, userProps, sleeps,
    patches: () => calls.filter((c) => (c.params.method || "").toLowerCase() === "patch"),
    patchBody: (c) => ctx.fromFirestoreValue({ mapValue: JSON.parse(c.params.payload) }),
    setLockHeld: (v) => { lockHeld = v; },
  };
}

// Fake GmailMessage / GmailThread builders
function fakeMessage(m) {
  return {
    getId: () => m.id,
    getSubject: () => m.subject || "",
    getPlainBody: () => m.body || "",
    getBody: () => m.html || m.body || "",
    getAttachments: () => m.attachments || [],
    getFrom: () => m.from || "Separated At Turf <separatedatturf@gmail.com>",
  };
}
function fakeThread(msgs) { return { getMessages: () => msgs.map(fakeMessage) }; }

module.exports = { loadBot, fakeThread, makeResponse };
