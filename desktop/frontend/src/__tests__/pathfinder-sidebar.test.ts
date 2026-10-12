import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const tree = fs.readFileSync(new URL("../components/ProjectTree.tsx", import.meta.url), "utf8");

assert.doesNotMatch(app, /sidebar-feature-zone/);
assert.match(app, /searchExpanded=\{true\}/);
assert.doesNotMatch(app, /sidebar__navitem--search/);

assert.match(tree, /onContextMenu=\{isSessionNode \? undefined : openTopicMenu\}/);
assert.match(tree, /event\.key === "ContextMenu"/);
assert.match(tree, /event\.shiftKey && event\.key === "F10"/);
assert.match(tree, /projectTree\.renameTopic/);
assert.match(tree, /history\.moveToTrash/);
assert.match(tree, /onDoubleClick/);

console.log("pathfinder sidebar contract passed");
