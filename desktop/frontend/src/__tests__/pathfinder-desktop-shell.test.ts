import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const status = fs.readFileSync(new URL("../components/ScheduleBridgeStatus.tsx", import.meta.url), "utf8");
const en = fs.readFileSync(new URL("../locales/en.ts", import.meta.url), "utf8");
const zh = fs.readFileSync(new URL("../locales/zh.ts", import.meta.url), "utf8");
const zhTW = fs.readFileSync(new URL("../locales/zh-TW.ts", import.meta.url), "utf8");

assert.match(app, /pathfinder-wordmark\.svg/);
assert.match(app, /<ScheduleBridgeStatus/);
assert.match(app, /<TodoRail/);
assert.doesNotMatch(app, /<ScheduleBridgeBanner/);
assert.doesNotMatch(app, /alt="Reasonix"/);

assert.match(status, /useT\(\)/);
assert.doesNotMatch(status, />连接 UC Davis 实时课程</);

const requiredLocaleKeys = [
  "scheduleBridge.connect",
  "scheduleBridge.connected",
  "scheduleBridge.starting",
  "scheduleBridge.pair",
  "scheduleBridge.openBuilder",
  "studentMemory.transcript",
  "studentMemory.resume",
  "studentMemory.timetable",
  "studentMemory.courseSchedule",
  "studentMemory.academicStyle",
  "studentMemory.major",
  "studentMemory.college",
  "studentMemory.preferences",
];
for (const key of requiredLocaleKeys) {
  for (const [name, source] of [["en", en], ["zh", zh], ["zh-TW", zhTW]] as const) {
    assert.match(source, new RegExp(`"${key}"`), `${name} should define ${key}`);
  }
}

console.log("Pathfinder desktop shell contract passed");
