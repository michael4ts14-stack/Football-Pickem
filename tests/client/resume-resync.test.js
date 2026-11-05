"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "../../public/js/firestore.js"), "utf8");
const a = src.indexOf("// ---------- Coming back to the app ----------");
const b = src.indexOf("// ---------- End coming back ----------");
assert.ok(a !== -1 && b !== -1, "resume block exists");

function load({ getFails = false, viewing = "" } = {}) {
  const log = [];
  const ctx = {
    Date, setTimeout, Promise, console, VIEWING_ARCHIVE_KEY: viewing,
    returnToLiveWeek: () => { log.push("left archive"); ctx.VIEWING_ARCHIVE_KEY = ""; },
    applyRemoteCloudData: (d) => log.push("applied week " + d.currentWeek),
    showAppToast: (m) => log.push("toast"),
    document: { addEventListener: () => {} }, window: { addEventListener: () => {} },
    fsDb: {
      disableNetwork: () => { log.push("off"); return Promise.resolve(); },
      enableNetwork: () => { log.push("on"); return Promise.resolve(); },
      collection: () => ({ doc: () => ({ get: (o) => { log.push("get " + o.source); return getFails ? Promise.reject(new Error("x")) : Promise.resolve({ exists: true, data: () => ({ currentWeek: 10 }) }); } }) }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(src.slice(a, b), ctx);
  return { ctx, log };
}

test("a short switch away does nothing", async () => {
  const { ctx, log } = load();
  await ctx.onAppResumed(10 * 1000);
  assert.deepStrictEqual(log, []);
});

test("after a longer absence the app reconnects and applies the server's data", async () => {
  const { ctx, log } = load();
  assert.strictEqual(await ctx.onAppResumed(5 * 60 * 1000), true);
  assert.deepStrictEqual(log, ["off", "on", "get server", "applied week 10"]);
});

test("a past week left open returns to the live week after a long absence", async () => {
  const { ctx, log } = load({ viewing: "week_9" });
  await ctx.onAppResumed(45 * 60 * 1000);
  assert.strictEqual(log[0], "left archive");
  assert.ok(log.includes("applied week 10"));
});

test("a past week stays open after a short absence, without reloading it", async () => {
  const { ctx, log } = load({ viewing: "week_9" });
  await ctx.onAppResumed(5 * 60 * 1000);
  assert.deepStrictEqual(log.filter((l) => l !== "off" && l !== "on" && l !== "get server"), ["applied week 10"]);
  assert.strictEqual(ctx.VIEWING_ARCHIVE_KEY, "week_9");
});

test("if the server can't be reached the player is told", async () => {
  const { ctx, log } = load({ getFails: true });
  assert.strictEqual(await ctx.onAppResumed(5 * 60 * 1000), false);
  assert.ok(log.includes("toast"));
});
