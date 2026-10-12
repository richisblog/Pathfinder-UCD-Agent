# Pathfinder Desktop Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the existing DeepSeek-Reasonix Wails/React desktop frontend in place as a focused Pathfinder academic assistant with Pathfinder branding, ChatGPT-like navigation, structured student memory, unobtrusive live-course connection controls, and a right-side consultation plan.

**Architecture:** Keep `desktop/frontend/src/App.tsx` as the Wails desktop entry surface and preserve all existing controller/session contracts. Add focused frontend components for branding, compact bridge status, structured student memory, and the right plan rail; reuse existing conversation, memory document, bot, history, trash, and Schedule Bridge APIs. Store structured student fields inside a delimited block in the writable user memory document so the existing memory loader automatically supplies them to the agent.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Wails desktop bridge, lucide-react, existing CSS/token system, tsx/jsdom tests, built-in image generation plus local chroma-key removal.

## Global Constraints

- Modify the existing DeepSeek-Reasonix desktop frontend under `desktop/frontend/src`; do not create a website or alternate browser application.
- Preserve current uncommitted Pathfinder and Schedule Bridge work.
- Keep backend provider, model, MCP, skill, hook, sandbox, and permission settings compatible even when hidden from student-facing navigation.
- Keep UC Davis authentication inside Chrome and use the existing Schedule Bridge Wails methods.
- Keep the canonical `todo_write` payload and current session/batch dismissal semantics as the task source of truth.
- Add no new npm dependency.
- Keep English, Simplified Chinese, and Traditional Chinese locale contracts synchronized.

---

### Task 1: Pathfinder brand assets and shell contract

**Files:**
- Create: `desktop/frontend/src/assets/pathfinder-logo.png`
- Create: `desktop/frontend/src/assets/pathfinder-symbol.svg`
- Create: `desktop/frontend/src/assets/pathfinder-wordmark.svg`
- Modify: `desktop/frontend/src/App.tsx`
- Modify: `desktop/frontend/src/components/StartupSplash.tsx`
- Modify: `desktop/frontend/src/components/OnboardingOverlay.tsx`
- Modify: `desktop/frontend/src/styles.css`
- Test: `desktop/frontend/src/__tests__/pathfinder-branding.test.ts`

**Interfaces:**
- Consumes: existing image imports and desktop shell CSS classes.
- Produces: `pathfinder-symbol.svg`, `pathfinder-wordmark.svg`, and visible desktop-shell text `Pathfinder`.

- [ ] **Step 1: Write the failing branding contract test**

```ts
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const symbol = fs.readFileSync(new URL("../assets/pathfinder-symbol.svg", import.meta.url), "utf8");

assert.match(app, /pathfinder-wordmark\.svg/);
assert.doesNotMatch(app, /alt="Reasonix"/);
assert.match(symbol, /<svg/);
assert.match(symbol, /graduation-cap/);
```

- [ ] **Step 2: Run the branding test and confirm red**

Run: `cd desktop/frontend && npx tsx src/__tests__/pathfinder-branding.test.ts`

Expected: FAIL because the Pathfinder asset does not exist and `App.tsx` still imports the Reasonix wordmark.

- [ ] **Step 3: Generate and extract the transparent Pathfinder logo**

Use the built-in image generator with a flat `#00ff00` background. Request a simple capital `P` monogram with a graduation cap integrated into the upper bowl, navy/indigo academic palette, no words, no shadows, no gradients, crisp vector-friendly edges, and generous padding. Copy the selected source into `desktop/frontend/src/assets/pathfinder-logo-chroma.png`, run the installed `remove_chroma_key.py` helper to produce `pathfinder-logo.png`, validate alpha and transparent corners, then remove only the chroma intermediate after the final file is verified.

- [ ] **Step 4: Add deterministic SVG symbol and wordmark assets**

Create an SVG with `role="img"`, a `graduation-cap` group id, a bold `P` path, and no background rectangle. Create a wordmark SVG containing the symbol plus outlined/path-rendered or SVG text `Pathfinder` using the existing neutral foreground color strategy.

- [ ] **Step 5: Replace visible desktop-shell Reasonix branding**

Import `./assets/pathfinder-wordmark.svg` in `App.tsx`, set `alt="Pathfinder"`, and update startup/onboarding visible brand labels. Do not rename backend namespaces or compatibility storage keys in this task.

- [ ] **Step 6: Run focused and production checks**

Run:

```bash
cd desktop/frontend
npx tsx src/__tests__/pathfinder-branding.test.ts
npm run typecheck
```

Expected: both commands PASS.

---

### Task 2: ChatGPT-like conversation sidebar interactions

**Files:**
- Modify: `desktop/frontend/src/App.tsx`
- Modify: `desktop/frontend/src/components/ProjectTree.tsx`
- Modify: `desktop/frontend/src/components/ContextMenu.tsx`
- Modify: `desktop/frontend/src/styles.css`
- Modify: `desktop/frontend/src/locales/en.ts`
- Modify: `desktop/frontend/src/locales/zh.ts`
- Modify: `desktop/frontend/src/locales/zh-TW.ts`
- Test: `desktop/frontend/src/__tests__/pathfinder-sidebar.test.tsx`

**Interfaces:**
- Consumes: existing topic open, rename, delete/trash, history, search, and keyboard navigation callbacks.
- Produces: conversation row overflow/context actions with `rename`, `archive`, and `delete` commands while normal click opens the topic.

- [ ] **Step 1: Write failing sidebar behavior tests**

Test source contracts and rendered interaction helpers: new chat and search appear before the conversation list; a row normal-click callback remains open-only; right-click prevents the native menu and opens the row menu; menu items expose localized Rename, Archive, and Delete labels; Delete calls the existing trash/confirm path.

- [ ] **Step 2: Run the focused test and confirm red**

Run: `cd desktop/frontend && npx tsx src/__tests__/pathfinder-sidebar.test.tsx`

Expected: FAIL because the current row action/menu contract does not expose the complete academic sidebar behavior.

- [ ] **Step 3: Implement the sidebar hierarchy**

Keep the brand, then New chat, then Search, then the grouped conversation tree. Remove the creation-layout “features” block from the upper sidebar. Keep active-row selection and the existing recency grouping.

- [ ] **Step 4: Implement pointer and keyboard actions**

Use normal click to open, double-click to start inline rename, and `onContextMenu` to open a focused menu. Ensure Escape closes and returns focus, Enter activates, ArrowUp/ArrowDown move selection, and the overflow button exposes the same actions without requiring right-click.

- [ ] **Step 5: Route archive/delete safely**

Use existing session/topic trash APIs for Delete and the existing archive/history mechanism for Archive. If the runtime has no distinct archive API, label the recoverable trash action as Archive and keep Delete behind confirmation; do not add a permanent filesystem delete.

- [ ] **Step 6: Add synchronized locale copy and styling**

Add `sidebar.rename`, `sidebar.archive`, `sidebar.delete`, and confirmation copy to all three locale files. Use compact 36–40 px rows, hover-revealed overflow, clear active background, and no coding-project iconography.

- [ ] **Step 7: Verify**

Run:

```bash
cd desktop/frontend
npx tsx src/__tests__/pathfinder-sidebar.test.tsx
npm run typecheck
```

Expected: PASS.

---

### Task 3: Compact Schedule Bridge and connection utility area

**Files:**
- Create: `desktop/frontend/src/components/ScheduleBridgeStatus.tsx`
- Modify: `desktop/frontend/src/components/ScheduleBridgeBanner.tsx`
- Modify: `desktop/frontend/src/components/ScheduleBridgeBanner.css`
- Modify: `desktop/frontend/src/App.tsx`
- Modify: `desktop/frontend/src/lib/scheduleBridge.ts`
- Test: `desktop/frontend/src/__tests__/schedule-bridge-placement.test.tsx`

**Interfaces:**
- Consumes: `ScheduleBridgeStatus`, `ScheduleBridgeIssuePairingCode`, `ScheduleBridgeOpenBrowser`, `ScheduleBridgePersonalConsent`, and `ScheduleBridgeSetPersonalConsent` from `app`.
- Produces: `<ScheduleBridgeStatus sessionId compact />` for the lower-left utility area and `<ScheduleBridgeBanner contextual />` only for request-scoped recovery surfaces.

- [ ] **Step 1: Write the failing placement test**

Assert that `App.tsx` does not render `ScheduleBridgeBanner` between Transcript and Composer, renders `ScheduleBridgeStatus` inside the sidebar footer above Settings, and the compact status does not show “打开 Schedule Builder” unless the mode requires pairing/browser/login action.

- [ ] **Step 2: Run the placement test and confirm red**

Run: `cd desktop/frontend && npx tsx src/__tests__/schedule-bridge-placement.test.tsx`

Expected: FAIL because the banner is currently mounted in the main chat column.

- [ ] **Step 3: Extract reusable bridge state/actions**

Move polling, pairing, consent, error, and action handlers into `ScheduleBridgeStatus.tsx` or a local hook used by both components. Keep the 3-second refresh behavior and clear pairing when connected.

- [ ] **Step 4: Mount the compact sidebar control**

Render one-line connection status above the message-channel/settings rows. Clicking it opens a popover/dialog with pairing code and consent controls. Show Open Schedule Builder only in states that require the browser or login.

- [ ] **Step 5: Remove persistent main-column banner**

Delete the unconditional chat-layout mount. Retain the existing banner component for future/request-scoped status cards and ensure no global banner consumes composer width or transcript height.

- [ ] **Step 6: Verify**

Run:

```bash
cd desktop/frontend
npx tsx src/__tests__/schedule-bridge-placement.test.tsx
npx tsx src/__tests__/schedule-bridge-banner.test.ts
npm run typecheck
```

Expected: PASS.

---

### Task 4: Right-side consultation plan rail

**Files:**
- Create: `desktop/frontend/src/components/TodoRail.tsx`
- Modify: `desktop/frontend/src/components/TodoPanel.tsx`
- Modify: `desktop/frontend/src/App.tsx`
- Modify: `desktop/frontend/src/styles.css`
- Modify: `desktop/frontend/src/lib/todoVisibility.ts`
- Test: `desktop/frontend/src/__tests__/todo-rail-layout.test.tsx`

**Interfaces:**
- Consumes: `stateKey: string`, `todos: Todo[]`, `onDismiss: () => void` and existing todo visibility helpers.
- Produces: `TodoRail` with persisted collapsed state and `data-testid="todo-rail"` outside the main conversation column.

- [ ] **Step 1: Write the failing rail layout test**

Assert that the App shell places `TodoRail` after the chat main element, that the old `TodoPanel` does not render above Composer, and that incomplete todo batches open by default while completed batches collapse.

- [ ] **Step 2: Run the test and confirm red**

Run: `cd desktop/frontend && npx tsx src/__tests__/todo-rail-layout.test.tsx`

Expected: FAIL because TodoPanel is currently in the main chat flow.

- [ ] **Step 3: Implement `TodoRail`**

Reuse todo status normalization and batch-scoped localStorage behavior. Render a 280 px desktop rail with title, completion badge, items, collapse button, and all-done dismissal. Keep the active item scrolled into view.

- [ ] **Step 4: Update App shell placement and responsive behavior**

Remove the old inline `TodoPanel` mount and add the rail as a sibling of the conversation column. Below the existing comfortable-width breakpoint, render it as a right overlay drawer with a header reopen button. Never reduce chat below `CHAT_MIN_WIDTH`.

- [ ] **Step 5: Verify visibility and layout**

Run:

```bash
cd desktop/frontend
npx tsx src/__tests__/todo-rail-layout.test.tsx
npm run test:todo-visibility
npm run typecheck
```

Expected: PASS.

---

### Task 5: Structured student memory editor

**Files:**
- Create: `desktop/frontend/src/lib/studentMemory.ts`
- Create: `desktop/frontend/src/components/StudentMemoryPanel.tsx`
- Modify: `desktop/frontend/src/components/MemoryPanel.tsx`
- Modify: `desktop/frontend/src/components/SettingsPanel.tsx`
- Modify: `desktop/frontend/src/styles.css`
- Modify: `desktop/frontend/src/locales/en.ts`
- Modify: `desktop/frontend/src/locales/zh.ts`
- Modify: `desktop/frontend/src/locales/zh-TW.ts`
- Test: `desktop/frontend/src/__tests__/student-memory.test.tsx`

**Interfaces:**
- Consumes: `MemoryView.docs`, the writable `scope === "user"` document, `onSaveDoc(path, body)`, existing facts/archives, `onForget(name)`, and localized strings.
- Produces:

```ts
export type StudentMemoryFieldId =
  | "transcript"
  | "resume"
  | "timetable"
  | "courseSchedule"
  | "academicStyle"
  | "major"
  | "college"
  | "preferences";

export type StudentMemoryProfile = Record<StudentMemoryFieldId, string>;

export function parseStudentMemory(body: string): StudentMemoryProfile;
export function writeStudentMemory(body: string, profile: StudentMemoryProfile): string;
```

- [ ] **Step 1: Write failing parser/serializer tests**

Cover empty documents, round-trip of all eight categories, preservation of unrelated user-memory text, replacement of an existing delimited block, and deletion by saving an empty field. Use markers `<!-- pathfinder-student-memory:start -->` and `<!-- pathfinder-student-memory:end -->`.

- [ ] **Step 2: Run parser tests and confirm red**

Run: `cd desktop/frontend && npx tsx src/__tests__/student-memory.test.tsx`

Expected: FAIL because `studentMemory.ts` does not exist.

- [ ] **Step 3: Implement deterministic parser and serializer**

Serialize a single Markdown section headed `## Pathfinder Student Profile`, with stable `### <field-id>` subheads. Preserve all content outside the markers byte-for-byte except for one separating newline. Reject nested/duplicate marker ambiguity by replacing from the first start marker through the next end marker.

- [ ] **Step 4: Build the structured editor**

Render eight cards: Transcript/grades, Résumé/experience, Personal timetable, Course schedule, Academic/writing style, Major, College/school, and Preferences/constraints. Each card has view, edit, save, cancel, empty, busy, and field-level error states. Save the full updated profile through the existing `onSaveDoc` callback.

- [ ] **Step 5: Preserve prior memories below the profile**

Keep a secondary “Prior memories” section powered by existing facts/archives and confirmed forget behavior. Remove developer-facing raw-doc and skill-suggestion controls from the normal student view; expose raw memory only through an advanced disclosure if required for recovery.

- [ ] **Step 6: Verify automatic agent availability**

Add a source contract assertion that the profile writes to the existing user memory doc path rather than localStorage. This proves the existing memory hierarchy loads it into new agent sessions without frontend prompt injection.

- [ ] **Step 7: Run focused checks**

Run:

```bash
cd desktop/frontend
npx tsx src/__tests__/student-memory.test.tsx
npm run typecheck
```

Expected: PASS.

---

### Task 6: Student-focused settings and composer

**Files:**
- Modify: `desktop/frontend/src/components/SettingsPanel.tsx`
- Modify: `desktop/frontend/src/components/Composer.tsx`
- Modify: `desktop/frontend/src/App.tsx`
- Modify: `desktop/frontend/src/lib/composerProfile.ts`
- Modify: `desktop/frontend/src/locales/en.ts`
- Modify: `desktop/frontend/src/locales/zh.ts`
- Modify: `desktop/frontend/src/locales/zh-TW.ts`
- Modify: `desktop/frontend/src/styles.css`
- Test: `desktop/frontend/src/__tests__/student-settings-contract.test.ts`
- Test: `desktop/frontend/src/__tests__/student-composer-contract.test.ts`

**Interfaces:**
- Consumes: existing General, Bots/OpenClaw, Memory, Shortcuts, Appearance settings sections and composer send/attachment/cancel callbacks.
- Produces: settings navigation `general | connections | memory | shortcuts | appearance` and a composer with no visible coding-agent controls.

- [ ] **Step 1: Write failing settings/composer contract tests**

Assert exactly five visible settings destinations; verify hidden `models`, `mcp`, `skills`, `hooks`, `permissions`, `sandbox`, `network`, and `updates` tabs are absent from `SETTINGS_TABS`; verify the composer does not render model switcher, effort switcher, token economy, or Ask/Auto/YOLO controls.

- [ ] **Step 2: Run the tests and confirm red**

Run:

```bash
cd desktop/frontend
npx tsx src/__tests__/student-settings-contract.test.ts
npx tsx src/__tests__/student-composer-contract.test.ts
```

Expected: at least one test FAIL against the current partially simplified UI.

- [ ] **Step 3: Consolidate Connections**

Rename the visible Bots destination to Connections, keep OpenClaw/message-channel management, and add the Schedule Bridge status component at the top. Do not delete hidden provider/config sections or their Wails APIs.

- [ ] **Step 4: Remove remaining coding controls from the visible composer**

Keep attachments, text input, academic plan/goal state only when student-facing, send/cancel, and accessibility labels. Remove unused imports/state/menu branches left by the current partial control removal so TypeScript has no dead destructuring or dangling markup.

- [ ] **Step 5: Verify**

Run:

```bash
cd desktop/frontend
npx tsx src/__tests__/student-settings-contract.test.ts
npx tsx src/__tests__/student-composer-contract.test.ts
npm run typecheck
```

Expected: PASS.

---

### Task 7: Integrated desktop layout, locales, and visual smoke check

**Files:**
- Modify: `desktop/frontend/src/App.tsx`
- Modify: `desktop/frontend/src/styles.css`
- Modify: `desktop/frontend/src/locales/en.ts`
- Modify: `desktop/frontend/src/locales/zh.ts`
- Modify: `desktop/frontend/src/locales/zh-TW.ts`
- Test: `desktop/frontend/src/__tests__/pathfinder-desktop-shell.test.tsx`

**Interfaces:**
- Consumes: outputs from Tasks 1–6.
- Produces: one coherent three-column Pathfinder desktop shell with responsive sidebar and task drawer.

- [ ] **Step 1: Write the integrated shell test**

Assert the rendered order and labels: Pathfinder sidebar, conversation main, optional task rail; lower-left live-course row, message connections, Settings; no persistent bridge banner in chat; no visible Reasonix alt/wordmark; no missing locale keys in any supported language.

- [ ] **Step 2: Run the shell test and confirm red**

Run: `cd desktop/frontend && npx tsx src/__tests__/pathfinder-desktop-shell.test.tsx`

Expected: FAIL until integration is complete.

- [ ] **Step 3: Finish CSS layout and responsive states**

Use existing CSS variables and theme tokens. Ensure the left sidebar is 260–300 px expanded, chat remains flexible, the task rail is 260–300 px, and secondary surfaces collapse/overlay before chat drops below 400 px. Preserve macOS titlebar drag regions and Windows/Linux window controls.

- [ ] **Step 4: Synchronize locale keys**

Run a key comparison across `en.ts`, `zh.ts`, and `zh-TW.ts`; add all Pathfinder brand, connection, plan, memory-field, sidebar-menu, confirmation, empty, and error strings to all three.

- [ ] **Step 5: Run the complete frontend verification**

Run:

```bash
cd desktop/frontend
npm run test:all
npm run build
```

Expected: TypeScript test config, all frontend tests, CSS checks, production typecheck, and Vite build PASS.

- [ ] **Step 6: Launch and inspect the actual Wails desktop client**

Use the repository desktop development/build command, open Pathfinder UCD, and verify at desktop window size and a narrow size: brand clarity, sidebar actions, settings navigation, all memory cards, lower-left bridge interaction, right task rail, transcript scrolling, composer send/cancel, focus order, and absence of persistent chat banner.

- [ ] **Step 7: Run repository-focused verification**

Run:

```bash
go test ./desktop/... -count=1
git diff --check
```

Expected: desktop tests PASS and the working diff has no whitespace errors. If unrelated deleted coding-tool tests fail, record the exact pre-existing failure separately and still require all changed frontend/desktop tests to pass.

---

## Plan self-review

- **Spec coverage:** Branding, sidebar interactions, compact Schedule Bridge placement, right task rail, reduced settings, eight structured memory categories, prior memories, composer simplification, responsive layout, accessibility, error states, localization, frontend build, and Wails smoke verification each map to a numbered task.
- **Scope:** Every deliverable modifies the existing Wails/React desktop frontend; no website or alternate application is introduced.
- **Type consistency:** `StudentMemoryFieldId`, `StudentMemoryProfile`, `parseStudentMemory`, `writeStudentMemory`, `ScheduleBridgeStatus`, and `TodoRail` names are defined once and consumed consistently.
- **Compatibility:** Hidden developer settings and backend APIs remain intact; Schedule Bridge and canonical todo contracts are reused.
