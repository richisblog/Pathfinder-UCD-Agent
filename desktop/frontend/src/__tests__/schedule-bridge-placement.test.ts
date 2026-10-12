import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const statusURL = new URL("../components/ScheduleBridgeStatus.tsx", import.meta.url);

assert.ok(fs.existsSync(statusURL), "compact Schedule Bridge status should exist");
assert.match(app, /import \{ ScheduleBridgeStatus \}/);
assert.doesNotMatch(app, /<ScheduleBridgeBanner/);

const status = fs.readFileSync(statusURL, "utf8");
const css = fs.readFileSync(new URL("../components/ScheduleBridgeBanner.css", import.meta.url), "utf8");
assert.match(status, /schedule-bridge-status/);
assert.match(status, /ScheduleBridgeIssuePairingCode/);
assert.match(status, /ScheduleBridgeOpenBrowser/);
assert.match(status, /mode === "extension"/);
assert.match(status, /import \{ AnchoredPopover \}/, "pairing panel should use the shared page-level popover");
assert.match(status, /<AnchoredPopover/);
assert.match(status, /anchorRef=/);
assert.match(status, /aria-expanded=/);
assert.doesNotMatch(status, /<details/, "pairing panel should not remain inside sidebar details overflow");

const popoverRule = css.match(/\.schedule-bridge-status__popover\s*\{([^}]+)\}/)?.[1] ?? "";
assert.ok(popoverRule, "pairing popover style should exist");
assert.doesNotMatch(popoverRule, /position:\s*absolute/);
assert.match(popoverRule, /100vw/, "pairing popover should clamp its width to the viewport");

const statusMounts = [...app.matchAll(/<ScheduleBridgeStatus/g)].map((match) => match.index);
assert.equal(statusMounts.length, 1, "course connection should mount exactly once in the desktop sidebar");
const projectTreeMount = app.indexOf("<ProjectTree");
const footerNavMount = app.indexOf('<nav className="sidebar__nav', projectTreeMount);
assert.ok(
  projectTreeMount > 0 && statusMounts[0] > projectTreeMount && footerNavMount > statusMounts[0],
  "course connection should render after projects and directly before footer navigation",
);

console.log("schedule bridge placement contract passed");
