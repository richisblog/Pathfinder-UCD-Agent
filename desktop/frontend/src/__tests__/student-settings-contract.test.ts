import assert from "node:assert/strict";
import fs from "node:fs";

const settings = fs.readFileSync(new URL("../components/SettingsPanel.tsx", import.meta.url), "utf8");
const match = settings.match(/const SETTINGS_TABS: SettingsTab\[\] = \[([^\]]+)\]/);
assert.ok(match, "settings tabs should be declared explicitly");
assert.equal(match[1].replace(/\s/g, ""), '"general","models","bots","memory","shortcuts","appearance"');
assert.doesNotMatch(match[1], /mcp|skills|hooks|permissions|sandbox|network|updates/);
assert.match(settings, /tab === "models"[\s\S]+ModelsSection/);
assert.match(settings, /app\.SetProviderKey/);
assert.match(settings, /app\.ClearProviderKey/);
assert.match(settings, /tab === "bots"[\s\S]+ScheduleBridgeStatus/);
const general = settings.slice(settings.indexOf("function GeneralSection"), settings.indexOf("function summarizeSoundStatus"));
assert.doesNotMatch(general, /settings\.defaultToolApprovalMode|settings\.autoPlan|settings\.memoryCompiler/);

console.log("student settings contract passed");
