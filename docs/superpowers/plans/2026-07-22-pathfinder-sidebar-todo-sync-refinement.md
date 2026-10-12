# Pathfinder Sidebar and Todo Sync Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the UC Davis control to the sidebar footer, enlarge the unclipped Pathfinder logo, and keep the right todo rail synchronized with the chat's latest live todo state.

**Architecture:** Extract selection of the latest valid todo snapshot into a pure helper used by `App`, and make the rail's completed-to-incomplete transition explicit and testable. Keep layout changes declarative in `App.tsx` and existing CSS so the bridge remains the same functional component with a new mount position.

**Tech Stack:** React 19, TypeScript, Node/tsx contract tests, Wails 2.12, CSS, Go 1.26.4, macOS `hdiutil`.

## Global Constraints

- The right todo rail and chat transcript use the same latest top-level `todo_write` arguments.
- Valid running updates take precedence immediately; failed or malformed updates fall back to the last valid snapshot.
- Manual collapse survives ordinary incomplete-to-incomplete updates.
- The UC Davis control remains directly above sidebar utility navigation and opens upward.
- The Pathfinder P symbol must not be clipped by negative margins.
- The final deliverable is a verified macOS arm64 DMG copied to the repository `dist/` directory and the Desktop.

---

### Task 1: Live todo snapshot selection and rail transitions

**Files:**
- Create: `desktop/frontend/src/lib/todoSnapshot.ts`
- Modify: `desktop/frontend/src/App.tsx:1424-1458`
- Modify: `desktop/frontend/src/components/TodoRail.tsx:44-63`
- Test: `desktop/frontend/src/__tests__/todo-snapshot.test.ts`
- Test: `desktop/frontend/src/__tests__/todo-rail-state.test.ts`

**Interfaces:**
- Consumes: `Item[]` from `useController`, `Todo[]` and `parseTodos()` from `tools`.
- Produces: `latestTodoSnapshot(items: Item[]): Todo[]` and `shouldReopenTodoRail(previousAllDone: boolean, nextAllDone: boolean): boolean`.

- [ ] **Step 1: Write failing todo snapshot tests**

Cover a valid running update overriding an older completed write, a completed update remaining canonical, and malformed/failed updates falling back to the previous valid write.

- [ ] **Step 2: Run snapshot tests and verify RED**

Run: `npx tsx src/__tests__/todo-snapshot.test.ts`

Expected: FAIL because `latestTodoSnapshot` does not exist.

- [ ] **Step 3: Implement the pure snapshot selector and wire App to it**

Create a backwards scan over top-level `todo_write` items. Return the first non-empty parsed list whose status is `running`, or whose status is `done` without an error. Skip errored, stopped, nested, or malformed entries. Replace App's completed-only `todoEntry` scan with this helper.

- [ ] **Step 4: Run snapshot tests and verify GREEN**

Run: `npx tsx src/__tests__/todo-snapshot.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing rail transition tests**

Assert that completed-to-incomplete returns `true`, while incomplete-to-incomplete and incomplete-to-completed return `false`.

- [ ] **Step 6: Run rail transition tests and verify RED**

Run: `npx tsx src/__tests__/todo-rail-state.test.ts`

Expected: FAIL because `shouldReopenTodoRail` does not exist.

- [ ] **Step 7: Implement the transition and update the TodoRail effect**

On a completed-to-incomplete transition, save `open=true` for the scoped batch and reopen the rail. On incomplete-to-completed, save `open=false` and collapse. Leave open state unchanged for ordinary incomplete updates so manual collapse is preserved.

- [ ] **Step 8: Run both todo tests and typecheck**

Run: `npx tsx src/__tests__/todo-snapshot.test.ts && npx tsx src/__tests__/todo-rail-state.test.ts && npm run typecheck`

Expected: all commands exit 0.

---

### Task 2: Sidebar placement and Pathfinder sizing

**Files:**
- Modify: `desktop/frontend/src/App.tsx:2829-3045`
- Modify: `desktop/frontend/src/styles.css:20837-20860,23775-23805,25774-25787`
- Modify: `desktop/frontend/src/components/ScheduleBridgeBanner.css:68-173`
- Test: `desktop/frontend/src/__tests__/schedule-bridge-placement.test.ts`
- Test: `desktop/frontend/src/__tests__/pathfinder-branding.test.ts`

**Interfaces:**
- Consumes: existing `ScheduleBridgeStatus` and `pathfinder-wordmark.svg`.
- Produces: `.sidebar__connection-slot` footer placement and enlarged normal/workbench/creation wordmark rules.

- [ ] **Step 1: Strengthen layout and branding contracts, then verify RED**

Require exactly one bridge mount in `App`, ordered after `ProjectTree` and before sidebar navigation. Require non-negative wordmark margins and enlarged normal/workbench dimensions.

Run: `npx tsx src/__tests__/schedule-bridge-placement.test.ts && npx tsx src/__tests__/pathfinder-branding.test.ts`

Expected: FAIL because the bridge is currently above the brand and workbench logo has a negative margin.

- [ ] **Step 2: Move the bridge and enlarge the logo**

Remove the top-level bridge mount. Add a `sidebar__connection-slot` immediately after the projects section and before the conditional footer navigation. Set normal logo to `160px × 40px`, workbench to `150px × 34px`, creation to `150px × 36px`, and all left margins to `0`.

- [ ] **Step 3: Run layout contracts and typecheck**

Run: `npx tsx src/__tests__/schedule-bridge-placement.test.ts && npx tsx src/__tests__/pathfinder-branding.test.ts && npm run typecheck`

Expected: all commands exit 0.

---

### Task 3: Regression verification, desktop inspection, and DMG rebuild

**Files:**
- Generated: `desktop/frontend/dist/**`
- Generated: `desktop/build/bin/pathfinder-ucd.app`
- Generated: `dist/PathfinderUCD-darwin-arm64.dmg`
- Generated: `/Users/richis/Desktop/PathfinderUCD.dmg`

**Interfaces:**
- Consumes: tested frontend and existing Go/Wails packaging environment.
- Produces: mountable, ad-hoc signed Apple Silicon Pathfinder installer.

- [ ] **Step 1: Run complete frontend verification**

Run: `npm run test:all && npm run build && git diff --check`

Expected: test suite and production build exit 0 with no whitespace errors.

- [ ] **Step 2: Inspect the local production UI**

Open the local preview and verify the bridge is in the sidebar footer, the full enlarged Pathfinder wordmark is visible, and live todo status/count changes render in the right rail.

- [ ] **Step 3: Build the Wails application**

Run from `desktop/` with the cached Go and Wails paths:

```bash
export PATH="/Users/richis/.cache/codex-runtimes/go1.26.4/bin:/Users/richis/go/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
wails build -clean -platform darwin/arm64 -ldflags "-X main.version=v0.0.0-local -X main.channel=local"
```

Expected: `desktop/build/bin/pathfinder-ucd.app` is produced.

- [ ] **Step 4: Package and verify the DMG**

Copy the app to a non-FileProvider temporary directory, remove copied extended attributes, ad-hoc sign it, add an Applications symlink, create the DMG with `hdiutil`, and copy the byte-identical result to the Desktop.

Verify with `hdiutil verify`, mount read-only, run `codesign --verify --deep --strict`, confirm `CFBundleName=Pathfinder UCD`, confirm Mach-O arm64, and compare SHA-256 hashes.

- [ ] **Step 5: Commit only task-owned source and test files if requested**

Do not stage unrelated pre-existing working-tree changes. Report the generated DMG paths and checksum.
