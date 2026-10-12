import assert from "node:assert/strict";

import { scheduleBridgeSessionIdForTab } from "../lib/scheduleBridgeSession";

assert.equal(
  scheduleBridgeSessionIdForTab({
    sessionPath: "/Users/student/.reasonix/sessions/019f8fa957d4.jsonl",
  }),
  "019f8fa957d4",
  "consent must use the same branch ID as the Go tool context",
);

assert.equal(
  scheduleBridgeSessionIdForTab({
    sessionPath: String.raw`C:\Users\student\.reasonix\sessions\session-a.jsonl`,
  }),
  "session-a",
  "Windows session paths must produce the same branch ID",
);

assert.equal(scheduleBridgeSessionIdForTab({ sessionPath: "" }), "");

console.log("schedule bridge session identity tests passed");
