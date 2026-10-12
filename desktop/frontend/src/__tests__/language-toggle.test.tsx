// Run: npx tsx src/__tests__/language-toggle.test.tsx

import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { LanguageToggleButton } from "../components/LanguageToggleButton";
import { LocaleProvider } from "../lib/i18n";
import { nextQuickLocale } from "../lib/languageToggle";

assert.equal(nextQuickLocale("zh"), "en");
assert.equal(nextQuickLocale("en"), "zh");
assert.equal(nextQuickLocale("zh-TW"), "zh");

const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.MouseEvent = dom.window.MouseEvent;

const savedLanguages: string[] = [];
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("missing root");
const root = createRoot(rootElement);

await act(async () => {
  root.render(
    <LocaleProvider>
      <LanguageToggleButton
        persistLanguage={async (language) => {
          savedLanguages.push(language);
        }}
      />
    </LocaleProvider>,
  );
});

const button = document.querySelector<HTMLButtonElement>(".sidebar__language-button");
assert.ok(button, "language button should render");
assert.equal(button.textContent?.trim(), "EN", "English UI should display the current language label");
assert.match(button.getAttribute("aria-label") ?? "", /中文|Chinese/i);

await act(async () => {
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});

assert.deepEqual(savedLanguages, ["zh"]);
assert.equal(button.textContent?.trim(), "中", "button should update immediately after switching to Chinese");
assert.equal(document.documentElement.lang, "zh-CN");

await act(async () => {
  root.unmount();
});
dom.window.close();

console.log("language toggle tests passed");
