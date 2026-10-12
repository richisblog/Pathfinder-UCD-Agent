import assert from "node:assert/strict";
import fs from "node:fs";

const bridge = fs.readFileSync(new URL("../lib/bridge.ts", import.meta.url), "utf8");
const status = fs.readFileSync(new URL("../components/ScheduleBridgeStatus.tsx", import.meta.url), "utf8");
const en = fs.readFileSync(new URL("../locales/en.ts", import.meta.url), "utf8");
const zh = fs.readFileSync(new URL("../locales/zh.ts", import.meta.url), "utf8");
const zhTW = fs.readFileSync(new URL("../locales/zh-TW.ts", import.meta.url), "utf8");

assert.match(bridge, /SaveScheduleCalendar\(sessionID: string\): Promise<string>/);
assert.match(status, /mode === "connected-consented"/);
assert.match(status, /scheduleBridge\.saveCalendar/);
assert.match(status, /app\.SaveScheduleCalendar\(sessionId\)/);
assert.match(status, /Calendar(?:Days|Icon|Clock)/);
for (const source of [en, zh, zhTW]) {
  assert.match(source, /"scheduleBridge\.saveCalendar"/);
  assert.match(source, /"scheduleBridge\.calendarSaved"/);
}

console.log("schedule bridge calendar export contract passed");
