import assert from "node:assert/strict";
import fs from "node:fs";

const composer = fs.readFileSync(new URL("../components/Composer.tsx", import.meta.url), "utf8");

assert.doesNotMatch(composer, /<ModelSwitcher/);
assert.doesNotMatch(composer, /<EffortSwitcher/);
assert.doesNotMatch(composer, /composer-modebar--approval/);
assert.doesNotMatch(composer, /composer\.modeYolo/);
assert.doesNotMatch(composer, /composer\.tokenEconomyOnDesc/);
assert.match(composer, /onSend/);
assert.match(composer, /onCancel/);
assert.match(composer, /imageInputEnabled/);

console.log("student composer contract passed");
