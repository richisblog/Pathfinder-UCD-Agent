# Pathfinder Bilingual UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click Chinese/English sidebar toggle that also controls future Agent replies, localize the touched Pathfinder chat surfaces, and render the UC Davis pairing panel without sidebar clipping.

**Architecture:** Reuse the existing `LocaleProvider` and backend `SetDesktopLanguage` path as the single persisted preference and Agent-response-language path. Isolate toggle policy in a pure helper and render the button in both sidebar footer variants. Replace the in-sidebar absolute Schedule Bridge panel with the existing portaled `AnchoredPopover`, which already clamps to viewport edges and tracks its anchor.

**Tech Stack:** React 19, TypeScript 6, Wails v2, Go, existing dictionary-based i18n, JSDOM contract/component tests, CSS.

## Global Constraints

- The quick control has exactly two targets: Simplified Chinese (`zh`) and English (`en`).
- A click switches immediately and persists through `SetDesktopLanguage`.
- Existing chat messages remain unchanged; new Agent turns use the selected language.
- Code, paths, commands, and necessary proper nouns keep their original form.
- The Settings language selector remains available and stays synchronized.
- The Schedule Bridge panel must be portaled outside `.sidebar { overflow: hidden }`, clamped to viewport edges, and usable in expanded and collapsed sidebars.
- Existing unrelated dirty-worktree changes must be preserved.

---

### Task 1: Quick language toggle policy and UI

**Files:**
- Create: `desktop/frontend/src/lib/languageToggle.ts`
- Create: `desktop/frontend/src/components/LanguageToggleButton.tsx`
- Create: `desktop/frontend/src/__tests__/language-toggle.test.tsx`
- Modify: `desktop/frontend/src/App.tsx`
- Modify: `desktop/frontend/src/styles.css`
- Modify: `desktop/frontend/src/locales/en.ts`
- Modify: `desktop/frontend/src/locales/zh.ts`
- Modify: `desktop/frontend/src/locales/zh-TW.ts`
- Modify: `desktop/frontend/package.json`

**Interfaces:**
- Consumes: `Locale`, `useI18n()`, `app.SetDesktopLanguage(lang)`.
- Produces: `nextQuickLocale(locale: Locale): "zh" | "en"` and `LanguageToggleButton`.

- [ ] **Step 1: Write the failing toggle test**

Create a test that imports `nextQuickLocale`, asserts `zh -> en`, `en -> zh`, and `zh-TW -> zh`, renders `LanguageToggleButton` inside `LocaleProvider`, clicks it, and asserts that the rendered label and backend callback move together.

```tsx
assert.equal(nextQuickLocale("zh"), "en");
assert.equal(nextQuickLocale("en"), "zh");
assert.equal(nextQuickLocale("zh-TW"), "zh");
assert.match(button.textContent ?? "", /EN/);
button.click();
assert.deepEqual(savedLanguages, ["en"]);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx tsx src/__tests__/language-toggle.test.tsx`

Expected: FAIL because `languageToggle.ts` and `LanguageToggleButton.tsx` do not exist.

- [ ] **Step 3: Implement the pure policy and component**

```ts
export function nextQuickLocale(locale: Locale): "zh" | "en" {
  return locale === "zh" ? "en" : "zh";
}
```

The component reads `locale`, calls `setPref(next)` optimistically, awaits an injected `persistLanguage` callback defaulting to `app.SetDesktopLanguage`, and rolls back the UI preference if persistence rejects. It exposes localized `aria-label` and `title`, displays `中` or `EN`, and disables itself while saving.

- [ ] **Step 4: Mount the button in both sidebar footer variants**

Place `LanguageToggleButton` immediately before the settings button in the workbench utility row and immediately before the settings nav item in the classic/creation footer. Add compact styles matching existing utility buttons and a readable collapsed-sidebar state.

- [ ] **Step 5: Add dictionary keys and run GREEN**

Add:

```ts
"sidebar.languageSwitchToEnglish": "Switch interface and Agent replies to English",
"sidebar.languageSwitchToChinese": "将界面和 Agent 回复切换为中文",
```

with correct English, Simplified Chinese, and Traditional Chinese values. Add the focused test to `test` and `test:all`, then run it and `npm run typecheck`.

- [ ] **Step 6: Commit the task**

```bash
git add desktop/frontend/src/lib/languageToggle.ts desktop/frontend/src/components/LanguageToggleButton.tsx desktop/frontend/src/__tests__/language-toggle.test.tsx desktop/frontend/src/App.tsx desktop/frontend/src/styles.css desktop/frontend/src/locales/en.ts desktop/frontend/src/locales/zh.ts desktop/frontend/src/locales/zh-TW.ts desktop/frontend/package.json
git commit -m "feat: add Pathfinder language quick toggle"
```

---

### Task 2: Portaled Schedule Bridge pairing panel

**Files:**
- Modify: `desktop/frontend/src/components/ScheduleBridgeStatus.tsx`
- Modify: `desktop/frontend/src/components/ScheduleBridgeBanner.css`
- Modify: `desktop/frontend/src/__tests__/schedule-bridge-placement.test.ts`

**Interfaces:**
- Consumes: `AnchoredPopover`, `RefObject<HTMLElement>`, existing bridge state/actions.
- Produces: a summary button anchored to a page-level `.schedule-bridge-status__popover`.

- [ ] **Step 1: Strengthen the contract test and verify RED**

Require `ScheduleBridgeStatus.tsx` to import/render `AnchoredPopover`, use an anchor ref, and no longer nest `.schedule-bridge-status__popover` inside the clipping sidebar details body. Require the CSS popover to have responsive width and no `position: absolute` rule.

Run: `npx tsx src/__tests__/schedule-bridge-placement.test.ts`

Expected: FAIL because the current component uses an absolute child of `<details>`.

- [ ] **Step 2: Replace details popup state with AnchoredPopover**

Use a controlled `open` state and summary `<button aria-expanded={open}>`. Pass the summary ref to:

```tsx
<AnchoredPopover
  open={open}
  anchorRef={anchorRef}
  onClose={() => setOpen(false)}
  className="schedule-bridge-status__popover"
  align="start"
  placement="auto"
>
  {panelContent}
</AnchoredPopover>
```

Preserve pairing, refresh, consent, error, Escape, outside-click, and polling behavior.

- [ ] **Step 3: Make the floating panel responsive**

Give the portaled panel `width: min(420px, calc(100vw - 16px))`, `max-width`, `box-sizing: border-box`, and wrapping action buttons. Remove selectors that depend on `[open]` and replace them with `aria-expanded="true"` styling.

- [ ] **Step 4: Run focused bridge and anchor tests**

Run: `npx tsx src/__tests__/schedule-bridge-placement.test.ts && npx tsx src/__tests__/anchored-popover-scroll.test.tsx && npm run typecheck`

Expected: all PASS.

- [ ] **Step 5: Commit the task**

```bash
git add desktop/frontend/src/components/ScheduleBridgeStatus.tsx desktop/frontend/src/components/ScheduleBridgeBanner.css desktop/frontend/src/__tests__/schedule-bridge-placement.test.ts
git commit -m "fix: portal UC Davis pairing panel"
```

---

### Task 3: Localize touched chat surfaces and verify Agent language propagation

**Files:**
- Modify: `desktop/frontend/src/components/Composer.tsx`
- Modify: `desktop/frontend/src/locales/en.ts`
- Modify: `desktop/frontend/src/locales/zh.ts`
- Modify: `desktop/frontend/src/locales/zh-TW.ts`
- Create: `desktop/frontend/src/__tests__/pathfinder-bilingual-contract.test.ts`
- Modify: `desktop/frontend/package.json`
- Modify: `desktop/settings_app_test.go`

**Interfaces:**
- Consumes: `useT()`, `SetDesktopLanguage`, controller `Compose`.
- Produces: localized referenced-session menu and context-wrapper copy; regression evidence that live controllers receive the chosen response language.

- [ ] **Step 1: Write bilingual contract failures**

Add a source contract that rejects the identified hard-coded visible Chinese strings in Composer and checks that each replacement translation key exists. Extend the Go language test to switch `zh`, then `en`, and assert the same live controller composes the corresponding `<response-language>` instruction after each switch.

Run: `npx tsx src/__tests__/pathfinder-bilingual-contract.test.ts` and `go test ./desktop -run TestSetDesktopLanguagePersistsResponseLanguageAndUpdatesLiveTabs -count=1`

Expected: frontend contract FAIL on current hard-coded strings; the backend regression may already pass and documents the existing required path.

- [ ] **Step 2: Move user-visible Composer strings to dictionaries**

Add concrete keys for loading/empty/search/no-match/back/session-turn/remove-reference and referenced-session context headings, warnings, roles, and failure text. Use `t(...)` in rendered UI and pass a `Translator` into the pure context-building helpers instead of using module-level Chinese constants.

- [ ] **Step 3: Keep dictionaries type-identical**

Add matching values to `en.ts`, `zh.ts`, and `zh-TW.ts`; keep the existing `DictKey` type enforcement intact. Do not translate search keywords or comments.

- [ ] **Step 4: Run frontend and backend focused tests**

Run: `npx tsx src/__tests__/pathfinder-bilingual-contract.test.ts && npm run typecheck && go test ./desktop -run TestSetDesktopLanguagePersistsResponseLanguageAndUpdatesLiveTabs -count=1`

Expected: all PASS.

- [ ] **Step 5: Commit the task**

```bash
git add desktop/frontend/src/components/Composer.tsx desktop/frontend/src/locales/en.ts desktop/frontend/src/locales/zh.ts desktop/frontend/src/locales/zh-TW.ts desktop/frontend/src/__tests__/pathfinder-bilingual-contract.test.ts desktop/frontend/package.json desktop/settings_app_test.go
git commit -m "feat: localize Pathfinder chat language surfaces"
```

---

### Task 4: Full verification and DMG replacement

**Files:**
- Use: `desktop/scripts/package-local-dmg.sh`
- Output: `dist/PathfinderUCD-darwin-arm64.dmg`
- Output: `/Users/richis/Desktop/PathfinderUCD.dmg`

**Interfaces:**
- Consumes: verified frontend and Wails build tree.
- Produces: signed arm64 app inside verified DMG copies.

- [ ] **Step 1: Run the complete frontend suite and production build**

```bash
cd desktop/frontend
npm run test:all
npm run build
git diff --check
```

Expected: exit 0, zero failed tests, successful Vite production build, no whitespace errors.

- [ ] **Step 2: Run backend language tests**

```bash
go test ./desktop ./internal/config ./internal/control
```

Expected: exit 0.

- [ ] **Step 3: Build Wails for Apple Silicon**

```bash
export PATH="/Users/richis/.cache/codex-runtimes/go1.26.4/bin:/Users/richis/go/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd desktop
wails build -clean -platform darwin/arm64 -ldflags "-X main.version=v0.0.0-local -X main.channel=local"
```

If Wails self-signing encounters FileProvider extended attributes after packaging, retain the generated app and continue with the existing clean-copy packaging script.

- [ ] **Step 4: Create and verify both DMG copies**

```bash
cd desktop
./scripts/package-local-dmg.sh
hdiutil verify ../dist/PathfinderUCD-darwin-arm64.dmg
cmp -s ../dist/PathfinderUCD-darwin-arm64.dmg /Users/richis/Desktop/PathfinderUCD.dmg
shasum -a 256 ../dist/PathfinderUCD-darwin-arm64.dmg
```

Expected: valid image, identical copies, printed SHA-256.

- [ ] **Step 5: Inspect final worktree without disturbing unrelated changes**

```bash
git status --short
git diff --stat
```

Report the exact DMG paths, checksum, test evidence, and retained dirty-worktree state.
