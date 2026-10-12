import assert from "node:assert/strict";

import { scheduleBridgeBannerMode } from "../lib/scheduleBridge";

assert.equal(scheduleBridgeBannerMode(null, false), "starting");
assert.equal(scheduleBridgeBannerMode({ running: true, connected: false, paired: false }, false), "extension");
assert.equal(scheduleBridgeBannerMode({ running: true, connected: true, paired: true }, false), "connected-private");
assert.equal(scheduleBridgeBannerMode({ running: true, connected: true, paired: true }, true), "connected-consented");

console.log("schedule bridge banner tests passed");
