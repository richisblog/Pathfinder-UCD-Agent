import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const railURL = new URL("../components/TodoRail.tsx", import.meta.url);
const styles = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");

assert.ok(fs.existsSync(railURL), "TodoRail should exist");
assert.match(app, /import \{ TodoRail \}/);
assert.doesNotMatch(app, /import \{ TodoPanel \}/);

const footerIndex = app.indexOf('<footer className="footer"');
const railIndex = app.indexOf("<TodoRail");
const chatCloseIndex = app.indexOf("</section>", footerIndex);
assert.ok(footerIndex > 0 && railIndex > chatCloseIndex, "TodoRail should be outside the conversation section");

const rail = fs.readFileSync(railURL, "utf8");
assert.match(rail, /data-testid="todo-rail"/);
assert.match(rail, /shouldOpenTodoPanelByDefault/);
assert.match(rail, /todoPanel:openStates/);
assert.match(rail, /todo-rail--collapsed/);
assert.match(app, /snapshot=\{consultationSnapshot\}/, "App should pass the full consultation snapshot to the rail");
for (const kind of ["todos", "known", "unknown"]) {
  assert.match(
    rail,
    new RegExp(`todo-rail__section--${kind}`),
    `TodoRail should render a stable ${kind} section`,
  );
}
assert.match(
  styles,
  /\.todo-rail__sections\s*\{[\s\S]*grid-template-rows:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
  "the open rail should reserve an independent row for each section",
);
assert.match(
  styles,
  /\.todo-rail__section-body\s*\{[\s\S]*overflow-y:\s*auto/,
  "each consultation section should scroll independently",
);
assert.match(styles, /\.todo-rail\s*\{[\s\S]*?width:\s*286px/, "the expanded rail should remain 286px wide");
assert.match(styles, /\.todo-rail--collapsed\s*\{[\s\S]*?width:\s*52px/, "the collapsed rail should remain 52px wide");
assert.doesNotMatch(
  styles,
  /\.todo-rail\s*\{[^}]*width:\s*min\(320px,\s*calc\(100vw\s*-\s*72px\)\)|\.todo-rail--collapsed\s*\{[^}]*width:\s*48px/,
  "responsive overlay behavior should not change the rail widths",
);

console.log("todo rail layout contract passed");
