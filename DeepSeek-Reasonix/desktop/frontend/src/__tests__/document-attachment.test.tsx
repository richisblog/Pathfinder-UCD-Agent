// Run: tsx src/__tests__/document-attachment.test.tsx

import { JSDOM } from "jsdom";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Composer } from "../components/Composer";
import { LocaleProvider } from "../lib/i18n";
import { ToastProvider } from "../lib/toast";
import type { AppBindings } from "../lib/bridge";
import type { CollaborationMode, DocumentExtractionView, TokenMode, ToolApprovalMode } from "../lib/types";

let passed = 0;
let failed = 0;

function ok(value: boolean, label: string) {
  if (value) {
    process.stdout.write(`  PASS  ${label}\n`);
    passed += 1;
  } else {
    process.stdout.write(`  FAIL  ${label}\n`);
    failed += 1;
  }
}

function eq(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) ok(true, label);
  else ok(false, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function flushTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function installDom() {
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
  globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  globalThis.Event = dom.window.Event;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  globalThis.InputEvent = dom.window.InputEvent;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.PointerEvent = dom.window.MouseEvent as unknown as typeof PointerEvent;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.File = dom.window.File;
  globalThis.FileReader = dom.window.FileReader;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.ResizeObserver = TestResizeObserver;
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value: () => {} });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { configurable: true, value: () => {} });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, media: "(prefers-reduced-motion: reduce)", onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }),
  });
  return dom;
}

function mockApp(methods: Partial<AppBindings>) {
  window.go = {
    main: {
      App: {
        Commands: async () => [],
        Models: async () => [],
        ModelsForTab: async () => [],
        ...methods,
      } as Partial<AppBindings> as AppBindings,
    },
  };
}

async function renderComposer(calls: { submit: string[] }) {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("missing root");
  const root = createRoot(rootEl);
  await act(async () => {
    root.render(
      <LocaleProvider>
        <ToastProvider>
          <Composer
            running={false}
            collaborationMode={"normal" as CollaborationMode}
            toolApprovalMode={"ask" as ToolApprovalMode}
            tokenMode={"full" as TokenMode}
            goal=""
            cwd="/repo"
            modelLabel="DeepSeek-R1"
            onSend={(_displayText, submitText) => { calls.submit.push(submitText ?? ""); }}
            onCancel={() => undefined}
            onCycleMode={() => {}}
            onSetMode={() => {}}
            onSetCollaborationMode={() => {}}
            onSetToolApprovalMode={() => {}}
            onToggleYoloApprovalMode={() => {}}
            onClearGoal={() => {}}
            onSwitchModel={() => {}}
            onSetEffort={() => {}}
            onSetTokenMode={() => {}}
            ready
          />
        </ToastProvider>
      </LocaleProvider>,
    );
    await flushTimers();
  });
  return root;
}

function documentInput(): HTMLInputElement {
  const input = document.querySelector("input[type=file]") as HTMLInputElement | null;
  if (!input) throw new Error("document file input did not render");
  return input;
}

function chooseDocument(file: File) {
  const input = documentInput();
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function waitFor(label: string, predicate: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await act(async () => { await flushTimers(); });
    if (predicate()) return;
  }
  throw new Error(`timed out waiting for ${label}`);
}

function extraction(overrides: Partial<DocumentExtractionView> = {}): DocumentExtractionView {
  return { format: "PDF", pages: 1, bytes: 12, characters: 42, truncated: false, status: "ready", ...overrides };
}

console.log("\ndocument attachment");

{
  const dom = installDom();
  const saved = deferred<string>();
  const inspected = deferred<DocumentExtractionView>();
  const saveCalls: string[] = [];
  const inspectCalls: string[] = [];
  const calls = { submit: [] as string[] };
  mockApp({
    SavePastedFile: async (name) => { saveCalls.push(name); return saved.promise; },
    InspectDocument: async (path) => { inspectCalls.push(path); return inspected.promise; },
  });
  const root = await renderComposer(calls);

  const addButton = Array.from(document.querySelectorAll("button")).find((button) => button.getAttribute("aria-label") === "Add document") as HTMLButtonElement | undefined;
  ok(Boolean(addButton), "Add document button has an accessible name");
  const input = documentInput();
  ok(input.multiple, "document picker accepts multiple files");
  ok([".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yaml", ".yml", ".xml", ".html", ".htm", ".rtf", ".docx", ".pdf"].every((extension) => input.accept.includes(extension)), "document picker accepts supported document types");
  let pickerClicks = 0;
  input.addEventListener("click", () => { pickerClicks += 1; });
  await act(async () => { addButton?.click(); await flushTimers(); });
  eq(pickerClicks, 1, "Add document opens the hidden picker");

  await act(async () => { chooseDocument(new File(["plan"], "plan.pdf", { type: "application/pdf" })); await flushTimers(); });
  await waitFor("SavePastedFile", () => saveCalls.length === 1);
  ok((document.querySelector(".composer__btn--send") as HTMLButtonElement).disabled, "Send is disabled while the file is saving");
  await act(async () => { saved.resolve(".reasonix/attachments/plan.pdf"); await flushTimers(); });
  await waitFor("InspectDocument", () => inspectCalls.length === 1);
  eq(inspectCalls[0], ".reasonix/attachments/plan.pdf", "InspectDocument receives the stored document path");
  ok((document.querySelector(".composer__btn--send") as HTMLButtonElement).disabled, "Send is disabled while document extraction is pending");
  await act(async () => { inspected.resolve(extraction()); await flushTimers(); });
  await waitFor("ready status", () => document.body.textContent?.includes("PDF · 1 page · 42 characters") === true);
  ok(document.body.textContent?.includes("PDF · 1 page · 42 characters") === true, "ready extraction reports format, pages, and characters");
  await act(async () => { (document.querySelector(".composer__btn--send") as HTMLButtonElement).click(); await flushTimers(); });
  eq(calls.submit[0], "@.reasonix/attachments/plan.pdf", "Send includes the stored document reference in submitText");

  await act(async () => { root.unmount(); });
  dom.window.close();
}

for (const [result, expected, label] of [
  [extraction({ status: "truncated", truncated: true }), "Document text was truncated", "truncated documents show the localized truncation status"],
  [extraction({ status: "ocr_required" }), "OCR required", "OCR-required documents show the localized warning"],
  [extraction({ status: "failed" }), "Document extraction failed", "failed documents show a failure state"],
] as const) {
  const dom = installDom();
  mockApp({ SavePastedFile: async () => ".reasonix/attachments/plan.pdf", InspectDocument: async () => result });
  const root = await renderComposer({ submit: [] });
  await act(async () => { chooseDocument(new File(["plan"], "plan.pdf", { type: "application/pdf" })); await flushTimers(); });
  await waitFor(label, () => document.body.textContent?.includes(expected) === true);
  ok(document.body.textContent?.includes(expected) === true, label);
  if (result.status === "failed") {
    const itemText = document.querySelector(".composer-context__item")?.textContent?.toLowerCase() ?? "";
    ok(!itemText.includes("processed") && !itemText.includes("ready"), "failed documents never claim to be processed or ready");
  }
  await act(async () => { root.unmount(); });
  dom.window.close();
}

for (const status of ["unsupported", "unexpected_result"]) {
  const dom = installDom();
  mockApp({ SavePastedFile: async () => ".reasonix/attachments/plan.pdf", InspectDocument: async () => extraction({ status }) });
  const root = await renderComposer({ submit: [] });
  await act(async () => { chooseDocument(new File(["plan"], "plan.pdf", { type: "application/pdf" })); await flushTimers(); });
  await waitFor(`${status} failure state`, () => document.body.textContent?.includes("Document extraction failed") === true);
  const itemText = document.querySelector(".composer-context__item")?.textContent ?? "";
  ok(itemText.includes("Document extraction failed") && !itemText.includes("Ready"), `${status} documents never claim to be ready`);
  await act(async () => { root.unmount(); });
  dom.window.close();
}

if (failed > 0) {
  process.stderr.write(`\n${failed} document attachment test(s) failed\n`);
  process.exit(1);
}
process.stdout.write(`\n${passed} document attachment test(s) passed\n`);
