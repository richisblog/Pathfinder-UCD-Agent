# Pathfinder API Key Settings Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a visible bilingual Models & API settings entry that exposes the existing provider API-key update and clear workflow, then ship it in a new arm64 DMG.

**Architecture:** Restore navigation to the existing `ModelsSection` instead of duplicating credential UI. Keep `SetProviderKey` and `ClearProviderKey` as the only mutation boundary, and restore the command-palette shortcut to the same page.

**Tech Stack:** React, TypeScript, existing Node/tsx contract tests, Wails v2, macOS codesign and hdiutil.

## Global Constraints

- Visible label is `模型与 API`, `模型與 API`, and `Models & API` for the supported languages.
- Do not restore MCP, Skills, hooks, permissions, sandbox, network, updates, or other coding-specific settings tabs.
- Continue using password inputs and the existing credential bridge; never return saved key values to the frontend.
- Rebuild through the existing academic-data allowlist packaging pipeline.

---

### Task 1: Restore Models & API navigation and command access

**Files:**
- Modify: `desktop/frontend/src/__tests__/student-settings-contract.test.ts`
- Modify: `desktop/frontend/src/__tests__/pathfinder-bilingual-contract.test.ts`
- Modify: `desktop/frontend/src/components/SettingsPanel.tsx`
- Modify: `desktop/frontend/src/App.tsx`
- Modify: `desktop/frontend/src/locales/en.ts`
- Modify: `desktop/frontend/src/locales/zh.ts`
- Modify: `desktop/frontend/src/locales/zh-TW.ts`

**Interfaces:**
- Consumes: existing `ModelsSection`, `KeyField`, `app.SetProviderKey`, and `app.ClearProviderKey`.
- Produces: visible `models` settings navigation and `cmd-models` command-palette entry.

- [ ] **Step 1: Change the settings contract to require Models & API**

Update the tab assertion to require exactly:

```ts
assert.equal(match[1].replace(/\s/g, ""), '"general","models","bots","memory","shortcuts","appearance"');
assert.doesNotMatch(match[1], /mcp|skills|hooks|permissions|sandbox|network|updates/);
assert.match(settings, /tab === "models"[\s\S]+ModelsSection/);
assert.match(settings, /app\.SetProviderKey/);
assert.match(settings, /app\.ClearProviderKey/);
```

Add bilingual contract assertions for the three exact `settings.tab.models` labels and an App contract assertion that `cmd-models` calls `setSettingsTarget("models")`.

- [ ] **Step 2: Run the focused contracts and verify RED**

Run:

```bash
pnpm exec tsx src/__tests__/student-settings-contract.test.ts
pnpm exec tsx src/__tests__/pathfinder-bilingual-contract.test.ts
```

Expected: FAIL because the models tab and command are absent and labels still say only Models/模型.

- [ ] **Step 3: Restore the visible settings entry**

Change the tab declaration to:

```ts
const SETTINGS_TABS: SettingsTab[] = ["general", "models", "bots", "memory", "shortcuts", "appearance"];
```

Retain the existing `tab === "models"` rendering and provider key components unchanged.

- [ ] **Step 4: Restore the command-palette entry**

Restore the `Cpu` icon import and add:

```tsx
{ id: "cmd-models", group: t("palette.group.commands"), title: t("settings.tab.models"), icon: <Cpu size={15} />, compact: true, keywords: ["model", "api", "key", "模型", "密钥"], run: () => setSettingsTarget("models") },
```

- [ ] **Step 5: Update bilingual labels**

Set `settings.tab.models` to `Models & API`, `模型与 API`, and `模型與 API` in English, Simplified Chinese, and Traditional Chinese.

- [ ] **Step 6: Run focused contracts and verify GREEN**

Run the two focused commands from Step 2.

Expected: both PASS.

- [ ] **Step 7: Run the complete frontend test suite**

Run: `pnpm test` from `desktop/frontend`.

Expected: PASS with zero failures.

### Task 2: Rebuild and audit the DMG

**Files:**
- Output: `dist/PathfinderUCD-darwin-arm64.dmg`
- Output: `/Users/richis/Desktop/PathfinderUCD.dmg`

**Interfaces:**
- Consumes: restored frontend and `desktop/scripts/package-local-dmg.sh`.
- Produces: signed arm64 Pathfinder DMG containing only allowlisted academic data and empty chat state.

- [ ] **Step 1: Build the Wails app**

Run from `desktop`:

```bash
PATH="/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin:/Users/richis/go/bin:$PATH" wails build -platform darwin/arm64 -clean
```

Expected: build exits 0 and produces `desktop/build/bin/pathfinder-ucd.app`.

- [ ] **Step 2: Package the DMG**

Run from the repository root:

```bash
PATHFINDER_DATA_SOURCE="$PWD/desktop/PathfinderUCD.app/Contents/Resources/data" zsh desktop/scripts/package-local-dmg.sh
```

Expected: signature and data verification succeed and the script prints a SHA-256 hash.

- [ ] **Step 3: Independently audit the mounted DMG**

Mount the image and verify the application is arm64, the signature is valid, the SQLite list is exactly `changemajor.db courses.db majors.db rmp.db ucdavis_calendar.db`, each database reports integrity `ok`, the chat directory is empty, and no user/backup/WAL file exists.

- [ ] **Step 4: Inspect final changes without disturbing unrelated work**

Run `git diff --check` for the modified frontend files and report the existing full-worktree test debt separately from this focused fix.
