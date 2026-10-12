import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import { TodoRail, shouldReopenTodoRail } from "../components/TodoRail";
import { LocaleProvider } from "../lib/i18n";
import type { ConsultationSnapshot } from "../lib/todoSnapshot";

assert.equal(
  shouldReopenTodoRail(true, false),
  true,
  "a completed batch becoming incomplete again should reopen the rail",
);
assert.equal(
  shouldReopenTodoRail(false, false),
  false,
  "ordinary incomplete status updates should preserve manual collapse",
);
assert.equal(
  shouldReopenTodoRail(false, true),
  false,
  "completion should collapse rather than reopen the rail",
);
assert.equal(
  shouldReopenTodoRail(true, true),
  false,
  "an unchanged completed batch should stay collapsed",
);

const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
  url: "http://localhost",
});
for (const [name, value] of [
  ["window", dom.window],
  ["document", dom.window.document],
  ["navigator", dom.window.navigator],
  ["localStorage", dom.window.localStorage],
  ["IS_REACT_ACT_ENVIRONMENT", true],
] as const) {
  Object.defineProperty(globalThis, name, { configurable: true, value });
}
Object.defineProperty(dom.window.Element.prototype, "scrollIntoView", {
  configurable: true,
  value() {},
});

const activeSnapshot: ConsultationSnapshot = {
  todos: [{ content: "Build course plan", status: "in_progress" }],
  known: ["Student prefers morning classes"],
  unknown: ["Prerequisites need confirmation"],
};
const completedSnapshot: ConsultationSnapshot = {
  ...activeSnapshot,
  todos: [{ content: "Build course plan", status: "completed" }],
};
const container = dom.window.document.getElementById("root");
assert.ok(container);
const root = createRoot(container);
const renderRail = (snapshot: ConsultationSnapshot) => createElement(
  LocaleProvider,
  null,
  createElement(TodoRail, { stateKey: "consultation-state", snapshot, onDismiss() {} }),
);

await act(async () => root.render(renderRail(activeSnapshot)));
assert.match(container.textContent ?? "", /Student prefers morning classes/);
assert.match(container.textContent ?? "", /Prerequisites need confirmation/);
assert.equal(
  container.querySelector(".todo-rail__item .sr-only")?.textContent,
  "In progress",
  "Todo status should have a localized accessible label",
);

await act(async () => root.render(renderRail(completedSnapshot)));
assert.ok(container.querySelector(".todo-rail--collapsed"), "completion should collapse the rail");
assert.doesNotMatch(container.textContent ?? "", /Student prefers morning classes/);

const expand = container.querySelector<HTMLButtonElement>(".todo-rail__collapse");
assert.ok(expand);
await act(async () => expand.click());
assert.match(
  container.textContent ?? "",
  /Student prefers morning classes/,
  "reopening after completion should expose the retained Known snapshot",
);
assert.match(
  container.textContent ?? "",
  /Prerequisites need confirmation/,
  "reopening after completion should expose the retained Unknown snapshot",
);

await act(async () => root.unmount());

console.log("todo rail transition contract passed");
