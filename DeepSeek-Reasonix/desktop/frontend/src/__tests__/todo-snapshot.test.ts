import assert from "node:assert/strict";

import * as todoSnapshot from "../lib/todoSnapshot";
import type { Item } from "../lib/useController";

const { latestTodoSnapshot, parseConsultationSnapshot } = todoSnapshot as typeof todoSnapshot & {
  parseConsultationSnapshot: (args: string) => unknown;
};

function todoTool(
  id: string,
  status: "running" | "done" | "error" | "stopped",
  snapshotOrTodos: unknown,
  overrides: Partial<Extract<Item, { kind: "tool" }>> = {},
): Extract<Item, { kind: "tool" }> {
  return {
    kind: "tool",
    id,
    name: "todo_write",
    args: typeof snapshotOrTodos === "string"
      ? snapshotOrTodos
      : JSON.stringify(Array.isArray(snapshotOrTodos) ? { todos: snapshotOrTodos } : snapshotOrTodos),
    readOnly: true,
    status,
    ...overrides,
  };
}

const completed = [{ content: "Review transcript", status: "completed" }];
const live = [
  { content: "Review transcript", status: "completed" },
  { content: "Build course plan", status: "in_progress", activeForm: "Building course plan" },
];
const liveKnown = ["Student prefers a light workload"];
const liveUnknown = ["Completed prerequisites are not confirmed"];

assert.deepEqual(
  latestTodoSnapshot([todoTool("old", "done", completed), todoTool("live", "running", {
    todos: live,
    known: liveKnown,
    unknown: liveUnknown,
  })]),
  { todos: live, known: liveKnown, unknown: liveUnknown },
  "a valid running full snapshot should immediately override the older completed snapshot",
);

assert.deepEqual(
  latestTodoSnapshot([todoTool("old", "done", completed), todoTool("new", "done", {
    todos: live,
    known: liveKnown,
    unknown: liveUnknown,
  })]),
  { todos: live, known: liveKnown, unknown: liveUnknown },
  "the latest successful completed full snapshot should remain canonical",
);

assert.deepEqual(
  latestTodoSnapshot([
    todoTool("old", "done", completed),
    todoTool("failed", "done", { todos: live, known: liveKnown, unknown: liveUnknown }, { error: "rejected" }),
    todoTool("malformed", "running", "{not-json"),
  ]),
  { todos: completed, known: [], unknown: [] },
  "malformed and failed updates should fall back to the last valid snapshot",
);

assert.deepEqual(
  latestTodoSnapshot([
    todoTool("old", "done", completed),
    todoTool("failed-running", "running", { todos: live, known: liveKnown, unknown: liveUnknown }, { error: "rejected" }),
  ]),
  { todos: completed, known: [], unknown: [] },
  "a running todo_write with an error should fall back to the last valid snapshot",
);

assert.deepEqual(
  latestTodoSnapshot([
    todoTool("old", "done", completed),
    todoTool("nested", "running", { todos: live, known: liveKnown, unknown: liveUnknown }, { parentId: "agent-1" }),
  ]),
  { todos: completed, known: [], unknown: [] },
  "nested sub-agent todo writes should not replace the conversation todo rail",
);

for (const [label, invalidSnapshot] of [
  ["null todo", { todos: [null] }],
  ["primitive todo", { todos: [7] }],
  ["missing todo content", { todos: [{ status: "pending" }] }],
  ["blank todo content", { todos: [{ content: "  ", status: "pending" }] }],
  ["invalid todo status", { todos: [{ content: "Review transcript", status: "blocked" }] }],
  ["invalid active form", { todos: [{ content: "Review transcript", status: "pending", activeForm: 7 }] }],
  ["invalid todo level", { todos: [{ content: "Review transcript", status: "pending", level: Number.NaN }] }],
  ["non-finite todo level", '{"todos":[{"content":"Review transcript","status":"pending","level":1e999}]}'],
] as const) {
  assert.deepEqual(
    latestTodoSnapshot([todoTool("old", "done", completed), todoTool(`invalid-${label}`, "running", invalidSnapshot)]),
    { todos: completed, known: [], unknown: [] },
    `${label} should fall back to the prior valid snapshot`,
  );
}

for (const [label, field, invalidValue] of [
  ["null known", "known", null],
  ["non-array known", "known", "confirmed"],
  ["non-string known entry", "known", [7]],
  ["blank known entry", "known", ["  "]],
  ["too many known entries", "known", Array.from({ length: 11 }, (_, index) => `known-${index}`)],
  ["null unknown", "unknown", null],
  ["non-array unknown", "unknown", "question"],
  ["non-string unknown entry", "unknown", [null]],
  ["blank unknown entry", "unknown", ["\t"]],
  ["too many unknown entries", "unknown", Array.from({ length: 11 }, (_, index) => `unknown-${index}`)],
] as const) {
  assert.deepEqual(
    latestTodoSnapshot([
      todoTool("old", "done", completed),
      todoTool(`invalid-${label}`, "running", { todos: live, [field]: invalidValue }),
    ]),
    { todos: completed, known: [], unknown: [] },
    `${label} should fall back to the prior valid snapshot`,
  );
}

assert.deepEqual(
  parseConsultationSnapshot(JSON.stringify({ todos: live })),
  { todos: live, known: [], unknown: [] },
  "legacy todo-only payloads retain their todos and receive empty knowledge lists",
);

assert.deepEqual(
  parseConsultationSnapshot(JSON.stringify({
    todos: "not-a-list",
    known: ["confirmed", 7, null],
    unknown: "not-a-list",
  })),
  { todos: [], known: ["confirmed"], unknown: [] },
  "malformed snapshot fields are defensively normalized",
);

console.log("todo snapshot synchronization contract passed");
