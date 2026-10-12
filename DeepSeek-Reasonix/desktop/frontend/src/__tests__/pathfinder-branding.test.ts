import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const splash = fs.readFileSync(new URL("../components/StartupSplash.tsx", import.meta.url), "utf8");
const welcome = fs.readFileSync(new URL("../components/Welcome.tsx", import.meta.url), "utf8");
const zh = fs.readFileSync(new URL("../locales/zh.ts", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const symbolURL = new URL("../assets/pathfinder-symbol.svg", import.meta.url);
const wordmarkURL = new URL("../assets/pathfinder-wordmark.svg", import.meta.url);

assert.ok(fs.existsSync(symbolURL), "Pathfinder symbol asset should exist");
assert.ok(fs.existsSync(wordmarkURL), "Pathfinder wordmark asset should exist");

const symbol = fs.readFileSync(symbolURL, "utf8");
const wordmark = fs.readFileSync(wordmarkURL, "utf8");

assert.match(app, /pathfinder-wordmark\.svg/);
assert.doesNotMatch(app, /alt="Reasonix"/);
assert.doesNotMatch(splash, />Reasonix</);
assert.match(welcome, /pathfinder-wordmark\.svg/);
assert.doesNotMatch(welcome, /alt="Reasonix"/);
assert.match(zh, /"sidebar\.navigation": "Pathfinder 导航"/);
assert.match(zh, /"composer\.placeholder": "向 Pathfinder 咨询课程、规划或学业问题…"/);
assert.match(html, /<title>Pathfinder<\/title>/);
assert.match(symbol, /<svg/);
assert.match(symbol, /id="graduation-cap"/);
assert.match(wordmark, /Pathfinder/);

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
}

const normalSidebarLogo = ruleBody(".sidebar__brand-logo");
assert.match(normalSidebarLogo, /width:\s*160px/);
assert.match(normalSidebarLogo, /height:\s*40px/);
assert.match(normalSidebarLogo, /margin-left:\s*0/);

const workbenchSidebarLogo = ruleBody(".sidebar--workbench .sidebar__brand-logo--workbench");
assert.match(workbenchSidebarLogo, /width:\s*150px/);
assert.match(workbenchSidebarLogo, /height:\s*34px/);
assert.match(workbenchSidebarLogo, /margin-left:\s*0/);

console.log("pathfinder branding contract passed");
