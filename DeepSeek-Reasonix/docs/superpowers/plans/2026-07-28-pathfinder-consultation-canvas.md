# Pathfinder Consultation Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a trusted consultation canvas to Pathfinder so chat remains the discussion surface while the right side persistently renders course and professor cards, a timetable, a major route, comparison tables, and a report from source-backed campus tool results.

**Architecture:** Add a strict, read-only `canvas_write` campus tool whose latest successful top-level call is the canonical canvas snapshot. The frontend resolves referenced tool-call IDs through the existing `ToolResultForTab` archive API, normalizes evidence into field-provenanced entities, and renders only a fixed component catalog. Reuse only fully audited MIT dependency trees: FullCalendar 6.1.19 for schedules, Cytoscape.js 3.33.1 for routes, and TanStack Table 8.21.3 for comparisons.

**Tech Stack:** Go, Wails, React 19, TypeScript 6, Vite 8, Zustand, existing CSS tokens/Lucide/Markdown, FullCalendar 6.1.19, Cytoscape.js 3.33.1, TanStack Table 8.21.3.

## Global Constraints

- New direct and transitive dependencies for this feature must be MIT; unknown, mixed, ISC, BSD, Apache-2.0, MPL, GPL-family, or commercial licenses fail the gate.
- Pin `@fullcalendar/react`, `@fullcalendar/core`, `@fullcalendar/timegrid`, and `@fullcalendar/daygrid` to exactly `6.1.19`; do not upgrade to FullCalendar 7.
- Pin `cytoscape` to exactly `3.33.1` and `@tanstack/react-table` to exactly `8.21.3`.
- Never install Schedule-X or React Flow: their required runtime trees contain non-MIT packages.
- `canvas_write` is read-only and plan-mode safe, accepts only schema version `1`, rejects unknown fields, and fully replaces the prior valid snapshot.
- Models may select fixed view kinds and source entities but may not provide HTML, JavaScript, CSS, SVG source, `className`, component names, handlers, remote images, or display URLs.
- Course/professor facts come only from successful top-level evidence tools in the same tab; missing facts stay missing and conflicting fields retain provenance.
- Professor email must display “邮箱未收录” unless a future approved official source explicitly returns a verified address; never infer it from a name.
- Canvas actions may change local browsing state or prefill the composer, but never auto-send chat or perform external writes.
- Preserve all unrelated dirty-worktree changes; stage only the files named in each task.

---

## File and Interface Map

### Backend

- `internal/campus/native/canvas_tool.go`: versioned canvas input types, strict decoding, semantic validation, tool contract.
- `internal/campus/native/canvas_tool_test.go`: valid/invalid schema and tool-safety coverage.
- `internal/campus/native/tools.go`: register `canvas_write`, describe evidence/refresh behavior in `SystemPromptAddon`, exclude it from `DataToolNames`.
- `internal/campus/native/tools_test.go`: registration, prompt, and data-tool exclusion tests.

### Frontend data layer

- `desktop/frontend/src/lib/canvasSnapshot.ts`: parse and select the latest valid canonical canvas snapshot.
- `desktop/frontend/src/lib/canvasEvidence.ts`: load archived tool data, parse supported result shapes, normalize entities, attach field-level provenance, and report missing sources.
- `desktop/frontend/src/lib/useController.ts`: treat `canvas_write` like `todo_write` for canonical argument retention and read-only presentation.
- `desktop/frontend/src/lib/tools.ts`: concise `canvas_write` subject/summary.
- `desktop/frontend/src/__tests__/canvas-snapshot.test.ts`: canonical selection and strict parser tests.
- `desktop/frontend/src/__tests__/canvas-evidence.test.ts`: entity normalization, merge priority, conflict, and email-policy tests.
- `desktop/frontend/src/__tests__/tool-data-archive.test.ts`: live/history retention for both canonical state tools.

### Frontend presentation

- `desktop/frontend/src/components/consultation-canvas/types.ts`: component-facing normalized entity and view-state types.
- `desktop/frontend/src/components/consultation-canvas/EvidenceDrawer.tsx`: field-to-source details and conflicts.
- `desktop/frontend/src/components/consultation-canvas/CourseCard.tsx`: fixed course card.
- `desktop/frontend/src/components/consultation-canvas/ProfessorCard.tsx`: fixed professor card with explicit email absence.
- `desktop/frontend/src/components/consultation-canvas/OverviewView.tsx`: fixed entity grid.
- `desktop/frontend/src/components/consultation-canvas/ComparisonView.tsx`: TanStack comparison table and mobile comparison cards.
- `desktop/frontend/src/components/consultation-canvas/ScheduleView.tsx`: FullCalendar time grid plus compact accessible list and conflict summary.
- `desktop/frontend/src/components/consultation-canvas/MajorRouteView.tsx`: Cytoscape route plus accessible linear list.
- `desktop/frontend/src/components/consultation-canvas/ReportView.tsx`: existing safe Markdown renderer plus evidence summary.
- `desktop/frontend/src/components/consultation-canvas/ConsultationCanvas.tsx`: shell, view tabs, source loading, errors, and composer-prefill callbacks.
- `desktop/frontend/src/App.tsx`: right-dock integration and composer insertion wiring.
- `desktop/frontend/src/store/layout.ts`: add `canvas` to `RightDockMode`.
- `desktop/frontend/src/styles.css`: canvas/card/table/calendar/route/responsive/focus/reduced-motion styling.
- `desktop/frontend/src/locales/en.ts`, `zh.ts`, `zh-TW.ts`: all user-visible strings.

### Dependency governance

- `desktop/frontend/scripts/check-consultation-licenses.mjs`: exact package/version/license/dependency whitelist check.
- `desktop/frontend/package.json`, `pnpm-lock.yaml`: pinned MIT-only dependencies and canvas test scripts.

---

### Task 1: Enforce the MIT-only dependency boundary

**Files:**
- Create: `desktop/frontend/scripts/check-consultation-licenses.mjs`
- Modify: `desktop/frontend/package.json`
- Modify: `desktop/frontend/pnpm-lock.yaml`
- Test: `desktop/frontend/src/__tests__/consultation-license-policy.test.ts`

**Interfaces:**
- Consumes: the pnpm installation under `desktop/frontend/node_modules`.
- Produces: `assertConsultationDependencyPolicy(rootDir: string): void` and a CLI that exits non-zero on an unexpected version, license, or production dependency.

- [ ] **Step 1: Write the failing license-policy test**

```ts
import { strict as assert } from "node:assert";
import { assertConsultationDependencyPolicy } from "../../scripts/check-consultation-licenses.mjs";

assert.doesNotThrow(() => assertConsultationDependencyPolicy(process.cwd()));
process.stdout.write("consultation dependency policy: PASS\n");
```

- [ ] **Step 2: Run the focused test and verify it fails before the checker exists**

Run: `cd desktop/frontend && pnpm exec tsx src/__tests__/consultation-license-policy.test.ts`

Expected: FAIL because `check-consultation-licenses.mjs` cannot be imported.

- [ ] **Step 3: Install exact candidate versions without range prefixes**

Run:

```bash
cd desktop/frontend
pnpm add --save-exact @fullcalendar/react@6.1.19 @fullcalendar/core@6.1.19 @fullcalendar/timegrid@6.1.19 @fullcalendar/daygrid@6.1.19 cytoscape@3.33.1 @tanstack/react-table@8.21.3
```

Expected: `package.json` records exact strings, not `^` or `~`.

- [ ] **Step 4: Implement the whitelist checker**

```js
import fs from "node:fs";
import path from "node:path";

const expected = new Map([
  ["@fullcalendar/react", { version: "6.1.19", deps: [] }],
  ["@fullcalendar/core", { version: "6.1.19", deps: ["preact"] }],
  ["@fullcalendar/timegrid", { version: "6.1.19", deps: ["@fullcalendar/daygrid"] }],
  ["@fullcalendar/daygrid", { version: "6.1.19", deps: [] }],
  ["cytoscape", { version: "3.33.1", deps: [] }],
  ["@tanstack/react-table", { version: "8.21.3", deps: ["@tanstack/table-core"] }],
  ["@tanstack/table-core", { version: "8.21.3", deps: [] }],
  ["preact", { version: "10.12.1", deps: [] }],
]);

function packageJSON(rootDir, name) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, "node_modules", name, "package.json"), "utf8"));
}

export function assertConsultationDependencyPolicy(rootDir) {
  for (const [name, rule] of expected) {
    const pkg = packageJSON(rootDir, name);
    if (pkg.version !== rule.version) throw new Error(`${name}: expected ${rule.version}, got ${pkg.version}`);
    if (pkg.license !== "MIT") throw new Error(`${name}: expected MIT, got ${String(pkg.license)}`);
    const actual = Object.keys(pkg.dependencies ?? {}).sort();
    const allowed = [...rule.deps].sort();
    if (JSON.stringify(actual) !== JSON.stringify(allowed)) {
      throw new Error(`${name}: unexpected runtime dependencies ${actual.join(", ")}`);
    }
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  assertConsultationDependencyPolicy(process.cwd());
  process.stdout.write("MIT-only consultation dependency tree verified\n");
}
```

- [ ] **Step 5: Add scripts to `package.json`**

Add:

```json
{
  "scripts": {
    "check:consultation-licenses": "node scripts/check-consultation-licenses.mjs",
    "test:consultation-canvas": "tsx src/__tests__/consultation-license-policy.test.ts"
  }
}
```

Preserve all existing scripts and later append focused canvas tests to `test:consultation-canvas`.

- [ ] **Step 6: Run the license gate and focused test**

Run: `cd desktop/frontend && pnpm run check:consultation-licenses && pnpm run test:consultation-canvas`

Expected: both PASS and the lockfile contains no FullCalendar 7, Schedule-X, React Flow, D3, or Temporal packages introduced by this feature.

- [ ] **Step 7: Commit only dependency-governance files**

```bash
git add desktop/frontend/package.json desktop/frontend/pnpm-lock.yaml desktop/frontend/scripts/check-consultation-licenses.mjs desktop/frontend/src/__tests__/consultation-license-policy.test.ts
git commit -m "build: enforce MIT-only canvas dependencies"
```

### Task 2: Add the strict `canvas_write` backend tool

**Files:**
- Create: `internal/campus/native/canvas_tool.go`
- Create: `internal/campus/native/canvas_tool_test.go`
- Modify: `internal/campus/native/tools.go`
- Modify: `internal/campus/native/tools_test.go`

**Interfaces:**
- Produces: `campusCanvasWrite`, `CanvasSnapshot`, `CanvasView`, `CanvasRoute`, `CanvasRouteNode`, and `CanvasRouteEdge` within package `native`.
- Tool contract: `Name() == "canvas_write"`, `ReadOnly() == true`, `PlanModeSafe() == true`, and successful output `consultation canvas updated`.

- [ ] **Step 1: Write tests for registration and a valid snapshot**

```go
func TestCanvasWriteAcceptsVersionOneOverview(t *testing.T) {
    canvas := campusCanvasWrite{}
    args := json.RawMessage(`{"version":1,"title":"Fall plan","active_view_id":"overview","views":[{"id":"overview","kind":"overview","title":"Overview","source_tool_call_ids":["course-1"],"entity_keys":["course:ECS 036A"]}]}`)
    got, err := canvas.Execute(context.Background(), args)
    if err != nil || got != "consultation canvas updated" {
        t.Fatalf("Execute = %q, %v", got, err)
    }
    if !canvas.ReadOnly() || !canvas.PlanModeSafe() || !json.Valid(canvas.Schema()) {
        t.Fatal("invalid canvas tool safety/schema contract")
    }
}
```

- [ ] **Step 2: Write table tests for every rejection rule**

Include explicit cases for: unknown top-level/view/route/node/edge fields, version other than `1`, blank or >80-character title, zero or >6 views, unsafe/duplicate IDs, missing active view, >12 sources, overview >24 entities, comparison outside 2–12 or mixed entity prefix, route >40 nodes/>80 edges, missing edge endpoints, self-loop, invalid node/edge enums, and report >12,000 characters.

- [ ] **Step 3: Run backend tests and verify failure**

Run: `go test ./internal/campus/native -run 'Canvas|ToolsExpose|SystemPrompt|DataToolNames'`

Expected: FAIL because `campusCanvasWrite` is undefined or not registered.

- [ ] **Step 4: Implement strict decoding and semantic validation**

Use `json.Decoder.DisallowUnknownFields()` and reject trailing JSON:

```go
func decodeCanvasSnapshot(args json.RawMessage) (CanvasSnapshot, error) {
    var input CanvasSnapshot
    dec := json.NewDecoder(bytes.NewReader(args))
    dec.DisallowUnknownFields()
    if err := dec.Decode(&input); err != nil {
        return input, fmt.Errorf("invalid args: %w", err)
    }
    if dec.Decode(&struct{}{}) != io.EOF {
        return input, fmt.Errorf("invalid args: trailing JSON")
    }
    return input, validateCanvasSnapshot(input)
}
```

Define view-specific optional fields but reject fields that do not belong to that `kind` during semantic validation. Validate Unicode rune counts with `utf8.RuneCountInString`, not byte length.

- [ ] **Step 5: Register the tool and update the prompt contract**

In `Tools`, append `campusCanvasWrite{}` immediately after `campusTodoWrite{}`. Add a `Consultation canvas` prompt section that instructs the agent to call `canvas_write` only after successful evidence tools, reference exact successful top-level tool IDs, use fixed view kinds, preserve missing data, and never supply style/code or infer professor email. Keep `canvas_write` out of `DataToolNames` because it is UI state, not evidence.

- [ ] **Step 6: Run and pass backend tests**

Run: `gofmt -w internal/campus/native/canvas_tool.go internal/campus/native/canvas_tool_test.go internal/campus/native/tools.go internal/campus/native/tools_test.go && go test ./internal/campus/native`

Expected: PASS.

- [ ] **Step 7: Commit backend tool files**

```bash
git add internal/campus/native/canvas_tool.go internal/campus/native/canvas_tool_test.go internal/campus/native/tools.go internal/campus/native/tools_test.go
git commit -m "feat: add consultation canvas tool contract"
```

### Task 3: Preserve and parse the canonical frontend canvas snapshot

**Files:**
- Create: `desktop/frontend/src/lib/canvasSnapshot.ts`
- Create: `desktop/frontend/src/__tests__/canvas-snapshot.test.ts`
- Modify: `desktop/frontend/src/lib/useController.ts`
- Modify: `desktop/frontend/src/lib/tools.ts`
- Modify: `desktop/frontend/src/__tests__/tool-data-archive.test.ts`
- Modify: `desktop/frontend/package.json`

**Interfaces:**
- Produces the discriminated view union and selectors below:

```ts
type CanvasViewBase = { id: string; title: string; source_tool_call_ids: string[] };
export type CanvasRouteNode = { id: string; kind: "course" | "milestone"; entity_key?: string; label: string; term?: string; status: "planned" | "completed" | "blocked" | "optional"; source_tool_call_ids: string[] };
export type CanvasRouteEdge = { from: string; to: string; relation: "prerequisite" | "required" | "recommended" | "sequence" };
export type CanvasRoute = { nodes: CanvasRouteNode[]; edges: CanvasRouteEdge[] };
export type CanvasOverviewView = CanvasViewBase & { kind: "overview"; entity_keys: string[] };
export type CanvasScheduleView = CanvasViewBase & { kind: "schedule" };
export type CanvasMajorRouteView = CanvasViewBase & { kind: "major_route"; route: CanvasRoute };
export type CanvasComparisonView = CanvasViewBase & { kind: "comparison"; entity_type: "course" | "professor" | "major"; entity_keys: string[] };
export type CanvasReportView = CanvasViewBase & { kind: "report"; markdown: string };
export type CanvasView = CanvasOverviewView | CanvasScheduleView | CanvasMajorRouteView | CanvasComparisonView | CanvasReportView;
export type CanvasSnapshot = { version: 1; title: string; active_view_id: string; views: CanvasView[] };
export function parseCanvasSnapshot(args: string): CanvasSnapshot | null;
export function latestCanvasSnapshot(items: Item[]): { toolId: string; snapshot: CanvasSnapshot } | null;
```

- `useController` preserves full args for the latest successful top-level `todo_write` and latest successful top-level `canvas_write` independently.

- [ ] **Step 1: Write strict parser and selection tests**

```ts
const valid = JSON.stringify({
  version: 1,
  title: "Fall plan",
  active_view_id: "overview",
  views: [{ id: "overview", kind: "overview", title: "Overview", source_tool_call_ids: ["course-1"], entity_keys: ["course:ECS 036A"] }],
});

eq(latestCanvasSnapshot([
  tool("canvas-old", "canvas_write", valid, "done"),
  { ...tool("nested", "canvas_write", valid, "done"), parentId: "agent" },
  tool("failed", "canvas_write", valid, "error"),
])?.toolId, "canvas-old", "ignores nested and failed snapshots");
```

Also assert rejection of unknown keys, unsafe IDs, invalid active view, illegal view-specific fields, HTML/style keys, invalid entity prefixes, and oversized collections.

- [ ] **Step 2: Extend archive tests before changing the reducer**

Add live and history cases containing alternating `todo_write` and `canvas_write` calls. Assert the latest successful top-level call of each tool keeps full parseable args, earlier calls truncate to <=205 characters, and a later failed call does not steal canonical status.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `cd desktop/frontend && pnpm exec tsx src/__tests__/canvas-snapshot.test.ts && pnpm exec tsx src/__tests__/tool-data-archive.test.ts`

Expected: parser test fails; archive test shows `canvas_write` args truncated.

- [ ] **Step 4: Implement parser and generalize canonical retention**

Replace the single-index helper with independent canonical indices:

```ts
const CANONICAL_STATE_TOOLS = new Set(["todo_write", "canvas_write"]);

function latestCanonicalStateToolIndexes(items: Item[]): Set<number> {
  const found = new Set<string>();
  const indexes = new Set<number>();
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind !== "tool" || item.parentId || item.status !== "done" || item.error) continue;
    if (!CANONICAL_STATE_TOOLS.has(item.name) || found.has(item.name)) continue;
    found.add(item.name);
    indexes.add(index);
  }
  return indexes;
}
```

Add `canvas_write` to `isReadOnlyTool`, `subjectOf`, and `summarize` without exposing raw JSON.

- [ ] **Step 5: Append tests to the canvas test script and run them**

Set `test:consultation-canvas` to run license policy, snapshot, archive, and later canvas tests. Run: `cd desktop/frontend && pnpm run test:consultation-canvas && pnpm run typecheck`.

Expected: PASS.

- [ ] **Step 6: Commit snapshot files**

```bash
git add desktop/frontend/src/lib/canvasSnapshot.ts desktop/frontend/src/lib/useController.ts desktop/frontend/src/lib/tools.ts desktop/frontend/src/__tests__/canvas-snapshot.test.ts desktop/frontend/src/__tests__/tool-data-archive.test.ts desktop/frontend/package.json
git commit -m "feat: retain canonical consultation canvas snapshots"
```

### Task 4: Load source results and normalize evidence-backed entities

**Files:**
- Create: `desktop/frontend/src/lib/canvasEvidence.ts`
- Create: `desktop/frontend/src/__tests__/canvas-evidence.test.ts`
- Create: `desktop/frontend/src/components/consultation-canvas/types.ts`
- Modify: `desktop/frontend/package.json`

**Interfaces:**
- Consumes: `app.ToolResultForTab(tabId, toolId)` returning `{ args: string; output: string } | null`.
- Produces:

```ts
export type EvidenceField<T> = { value?: T; sourceToolId?: string; conflict?: { value: T; sourceToolId: string }[] };
export type CourseEntity = { kind: "course"; key: string; code: EvidenceField<string>; title: EvidenceField<string>; units: EvidenceField<string>; rating: EvidenceField<number>; difficulty: EvidenceField<number>; reviewCount: EvidenceField<number>; prerequisites: EvidenceField<string>; ge: EvidenceField<string> };
export type ProfessorEntity = { kind: "professor"; key: string; name: EvidenceField<string>; department: EvidenceField<string>; school: EvidenceField<string>; email: EvidenceField<string>; rating: EvidenceField<number>; difficulty: EvidenceField<number>; ratingCount: EvidenceField<number>; wouldTakeAgain: EvidenceField<number>; rmpURL: EvidenceField<string> };
export type MajorEntity = { kind: "major"; key: string; name: EvidenceField<string>; degreeType: EvidenceField<string>; college: EvidenceField<string>; requirements: EvidenceField<string>; applicationThreshold: EvidenceField<string> };
export type CanvasSourceStatus = { toolId: string; state: "ready" | "unavailable" | "invalid"; error?: string };
export type CanvasEvidence = { courses: Map<string, CourseEntity>; professors: Map<string, ProfessorEntity>; majors: Map<string, MajorEntity>; scheduleRows: unknown[]; sources: CanvasSourceStatus[] };
export type ToolResultLoader = (tabId: string, toolId: string) => Promise<{ args: string; output: string } | null>;
export async function loadCanvasEvidence(tabId: string, sourceIds: string[], load?: ToolResultLoader): Promise<CanvasEvidence>;
```

- [ ] **Step 1: Write fixture-driven normalizer tests**

Use outputs matching real tool shapes:

```ts
const courseOutput = JSON.stringify({ table: "courses", total_matches: 1, rows: [{
  course_code: "ECS 036A", title: "Programming and Problem Solving", units: "4",
  avg_rating: 4.2, avg_difficulty: 3.1, num_reviews: 84,
  prerequisites: "ECS 032A or equivalent", general_education: "SE",
}] });
```

Assert stable keys, numeric parsing without treating missing values as zero, RMP professor fields, `professors_for_course` rows, field-source IDs, source de-duplication, rejected malformed JSON, rejected `javascript:` RMP URLs, and source-unavailable errors.

- [ ] **Step 2: Add the professor-email invariant test**

```ts
const professor = evidence.professors.get("professor:123");
eq(professor?.email.value, undefined, "RMP and schedule results never synthesize professor email");
ok(!JSON.stringify(professor).includes("@ucdavis.edu"), "no inferred campus address");
```

- [ ] **Step 3: Run the normalizer test and verify failure**

Run: `cd desktop/frontend && pnpm exec tsx src/__tests__/canvas-evidence.test.ts`

Expected: FAIL because `canvasEvidence.ts` does not exist.

- [ ] **Step 4: Implement source loading with same-tab IDs and caching**

Accept source IDs only from the validated snapshot. Deduplicate before loading. Return one `CanvasSourceStatus` per ID with `loading | ready | unavailable | invalid`. Do not scan other tabs and do not retry more than once. Parse the optional `[reused cached result ...]` prefix before JSON.

- [ ] **Step 5: Implement field-specific normalization and merging**

Normalize course codes with uppercase and collapsed whitespace. Use `numeric_id` as the professor key; if absent, create a source-scoped non-mergeable key rather than merging by name. Apply the spec priority table per field, record lower-priority conflicts, and never read email from schedule/RMP records even if an unexpected raw field appears.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `cd desktop/frontend && pnpm exec tsx src/__tests__/canvas-evidence.test.ts && pnpm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit evidence files**

```bash
git add desktop/frontend/src/lib/canvasEvidence.ts desktop/frontend/src/components/consultation-canvas/types.ts desktop/frontend/src/__tests__/canvas-evidence.test.ts desktop/frontend/package.json
git commit -m "feat: normalize source-backed canvas evidence"
```

### Task 5: Build fixed course and professor cards

**Files:**
- Create: `desktop/frontend/src/components/consultation-canvas/EvidenceDrawer.tsx`
- Create: `desktop/frontend/src/components/consultation-canvas/CourseCard.tsx`
- Create: `desktop/frontend/src/components/consultation-canvas/ProfessorCard.tsx`
- Create: `desktop/frontend/src/components/consultation-canvas/OverviewView.tsx`
- Create: `desktop/frontend/src/__tests__/consultation-cards.test.tsx`
- Modify: `desktop/frontend/src/styles.css`
- Modify: `desktop/frontend/src/locales/en.ts`
- Modify: `desktop/frontend/src/locales/zh.ts`
- Modify: `desktop/frontend/src/locales/zh-TW.ts`
- Modify: `desktop/frontend/package.json`

**Interfaces:**
- Produces `CourseCard`, `ProfessorCard`, and `OverviewView`.
- Each card accepts a normalized entity, `onCompare(key)`, `onPrefill(text)`, and `onNavigateToRoute?(key)`; no arbitrary children/style props.

- [ ] **Step 1: Write JSDOM card contract tests**

Render a complete and an incomplete entity. Assert course name/code, units, rating, difficulty, count, prerequisites, GE, source button, and fixed action names. Assert professor name, department, rating, difficulty, would-take-again, rating count, and literal localized “邮箱未收录”; assert no `mailto:` exists without verified email.

- [ ] **Step 2: Run the card test and verify failure**

Run: `cd desktop/frontend && pnpm exec tsx src/__tests__/consultation-cards.test.tsx`

Expected: FAIL because card modules do not exist.

- [ ] **Step 3: Implement shared metric and missing-value presentation**

Use semantic `<article>`, `<dl>`, `<dt>`, and `<dd>`. Render unknown as localized text, never numeric zero. Derive rating tone in the component from fixed thresholds and include the numeric label so color is never the sole signal.

- [ ] **Step 4: Implement the evidence drawer**

Display each visible field, its source tool ID, unavailable state, and conflicts. It must contain text only; never render source output as HTML. External RMP links require `https:` and `rel="noreferrer noopener"`.

- [ ] **Step 5: Implement fixed card actions**

`onPrefill` receives a localized plain-text question and does not submit it. “加入比较” passes only the entity key. “查看先修路线” calls the route callback if present, otherwise prefills a question. Do not add email-copy UI when email is absent.

- [ ] **Step 6: Add responsive/focus/reduced-motion styles and translations**

Use existing CSS variables and Lucide icons. Add visible `:focus-visible`, a two-column grid above 720px and one column below, and disable nonessential transitions under `prefers-reduced-motion: reduce`.

- [ ] **Step 7: Run cards, CSS checks, and typecheck**

Run: `cd desktop/frontend && pnpm exec tsx src/__tests__/consultation-cards.test.tsx && pnpm run check:css && pnpm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit card files**

```bash
git add desktop/frontend/src/components/consultation-canvas desktop/frontend/src/__tests__/consultation-cards.test.tsx desktop/frontend/src/styles.css desktop/frontend/src/locales/en.ts desktop/frontend/src/locales/zh.ts desktop/frontend/src/locales/zh-TW.ts desktop/frontend/package.json
git commit -m "feat: add fixed consultation entity cards"
```

### Task 6: Add the consultation canvas shell, overview, and report

**Files:**
- Create: `desktop/frontend/src/components/consultation-canvas/ReportView.tsx`
- Create: `desktop/frontend/src/components/consultation-canvas/ConsultationCanvas.tsx`
- Create: `desktop/frontend/src/__tests__/consultation-canvas-shell.test.tsx`
- Modify: `desktop/frontend/src/App.tsx`
- Modify: `desktop/frontend/src/store/layout.ts`
- Modify: `desktop/frontend/src/styles.css`
- Modify: `desktop/frontend/src/locales/en.ts`
- Modify: `desktop/frontend/src/locales/zh.ts`
- Modify: `desktop/frontend/src/locales/zh-TW.ts`
- Modify: `desktop/frontend/package.json`

**Interfaces:**
- `ConsultationCanvas` consumes `{ tabId, items, onPrefill, onLocateTool }`.
- It calls `latestCanvasSnapshot(items)`, loads unique source IDs, selects the snapshot's active view initially, and renders a fixed switch by `view.kind`.

- [ ] **Step 1: Write shell behavior tests**

Assert empty state before any snapshot, correct title/active tab after a valid snapshot, view tabs only for declared views, last valid snapshot surviving a later invalid/failed call, per-source unavailable count, report Markdown rendered through the existing `Markdown` component, and view errors isolated by an error boundary.

- [ ] **Step 2: Run the shell test and verify failure**

Run: `cd desktop/frontend && pnpm exec tsx src/__tests__/consultation-canvas-shell.test.tsx`

Expected: FAIL because the shell does not exist.

- [ ] **Step 3: Implement the shell and fixed renderer registry**

Use an exhaustive switch:

```tsx
switch (view.kind) {
  case "overview": return <OverviewView {...props} />;
  case "comparison": return <ComparisonView {...props} />;
  case "schedule": return <ScheduleView {...props} />;
  case "major_route": return <MajorRouteView {...props} />;
  case "report": return <ReportView {...props} />;
}
```

During this task, comparison/schedule/route may render a localized “view is being prepared” boundary component, which is replaced in Tasks 7–9 before final acceptance. Do not accept a component name from JSON.

- [ ] **Step 4: Integrate the right-dock canvas mode**

Add `"canvas"` to `RightDockMode`. Add a Canvas tab before Files/Changes. When `rightDockMode === "canvas"`, render `ConsultationCanvas`; keep Context/Files/Changes behavior intact. If a valid canvas first appears while the dock is closed, show a non-blocking badge rather than forcibly opening the panel.

- [ ] **Step 5: Wire prefill without auto-send**

Use the existing `ComposerInsertRequest` path:

```ts
const prefillFromCanvas = useCallback((text: string) => {
  setComposerInsertRequest({ id: Date.now(), text, mode: "replace" });
}, []);
```

Pass it to the canvas. “定位到对话” scrolls to the canonical `canvas_write` item ID using the existing transcript item navigation mechanism; if no reusable mechanism exists, add one focused helper rather than DOM-querying arbitrary selectors.

- [ ] **Step 6: Add narrow-width overlay behavior**

At the existing workspace-panel breakpoint, make canvas mode a fixed drawer with an explicit close button and preserved selected view. Do not squeeze the transcript below its minimum width. Keep `aria-modal` false because chat remains interactive.

- [ ] **Step 7: Run shell, existing layout, localization, CSS, and type checks**

Run:

```bash
cd desktop/frontend
pnpm exec tsx src/__tests__/consultation-canvas-shell.test.tsx
pnpm exec tsx src/__tests__/workspace-layout.test.ts
pnpm exec tsx src/__tests__/pathfinder-bilingual-contract.test.ts
pnpm run check:css
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit the shell integration**

```bash
git add desktop/frontend/src/components/consultation-canvas/ConsultationCanvas.tsx desktop/frontend/src/components/consultation-canvas/ReportView.tsx desktop/frontend/src/__tests__/consultation-canvas-shell.test.tsx desktop/frontend/src/App.tsx desktop/frontend/src/store/layout.ts desktop/frontend/src/styles.css desktop/frontend/src/locales/en.ts desktop/frontend/src/locales/zh.ts desktop/frontend/src/locales/zh-TW.ts desktop/frontend/package.json
git commit -m "feat: integrate consultation canvas dock"
```

### Task 7: Implement the course, professor, and major comparison view

**Files:**
- Create: `desktop/frontend/src/components/consultation-canvas/ComparisonView.tsx`
- Create: `desktop/frontend/src/__tests__/consultation-comparison.test.tsx`
- Modify: `desktop/frontend/src/components/consultation-canvas/ConsultationCanvas.tsx`
- Modify: `desktop/frontend/src/styles.css`
- Modify: `desktop/frontend/src/locales/en.ts`
- Modify: `desktop/frontend/src/locales/zh.ts`
- Modify: `desktop/frontend/src/locales/zh-TW.ts`
- Modify: `desktop/frontend/package.json`

**Interfaces:**
- Consumes `CanvasComparisonView`, `CanvasEvidence`, and local `selectedEntityKeys`.
- Produces a TanStack table on desktop and field-by-field comparison cards below the mobile breakpoint.

- [ ] **Step 1: Write comparison tests**

Assert course columns `course/units/rating/difficulty/reviews/prerequisites/GE`; professor columns `professor/department/rating/difficulty/would-take-again/ratings/email`; missing values sort after known numeric values; zero remains a real value; table sort is local state; mobile markup contains equivalent labels; and entity keys not found in evidence produce an unavailable row rather than disappearing.

- [ ] **Step 2: Run the test and verify failure**

Run: `cd desktop/frontend && pnpm exec tsx src/__tests__/consultation-comparison.test.tsx`

Expected: FAIL because `ComparisonView` does not exist.

- [ ] **Step 3: Implement typed column factories**

Use `createColumnHelper<CourseEntity>()` and separate professor/major factories. Accessors return `number | null` and use an explicit sorting function so `null` is last in both directions. Render provenance conflicts with an icon and accessible label.

- [ ] **Step 4: Implement local comparison selection**

Initialize from `view.entity_keys`. Card “加入比较” may add an entity key locally without mutating snapshot JSON. Display a “not saved to report” hint for local additions and a prefill action to ask the agent to persist the selection through a new `canvas_write`.

- [ ] **Step 5: Run focused tests and MIT gate**

Run: `cd desktop/frontend && pnpm exec tsx src/__tests__/consultation-comparison.test.tsx && pnpm run check:consultation-licenses && pnpm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit comparison files**

```bash
git add desktop/frontend/src/components/consultation-canvas/ComparisonView.tsx desktop/frontend/src/components/consultation-canvas/ConsultationCanvas.tsx desktop/frontend/src/__tests__/consultation-comparison.test.tsx desktop/frontend/src/styles.css desktop/frontend/src/locales/en.ts desktop/frontend/src/locales/zh.ts desktop/frontend/src/locales/zh-TW.ts desktop/frontend/package.json
git commit -m "feat: add consultation comparison tables"
```

### Task 8: Implement the FullCalendar timetable and conflict model

**Files:**
- Create: `desktop/frontend/src/components/consultation-canvas/ScheduleView.tsx`
- Create: `desktop/frontend/src/lib/canvasSchedule.ts`
- Create: `desktop/frontend/src/__tests__/consultation-schedule.test.tsx`
- Modify: `desktop/frontend/src/components/consultation-canvas/ConsultationCanvas.tsx`
- Modify: `desktop/frontend/src/styles.css`
- Modify: `desktop/frontend/src/locales/en.ts`
- Modify: `desktop/frontend/src/locales/zh.ts`
- Modify: `desktop/frontend/src/locales/zh-TW.ts`
- Modify: `desktop/frontend/package.json`

**Interfaces:**
- Produces `normalizeScheduleMeetings(evidence): ScheduleEvent[]` and `findScheduleConflicts(events): ScheduleConflict[]`.
- `ScheduleEvent` includes stable ID, course/section/title, start/end, days, location, instructors, enrollment fields already present in source, and source ID.

- [ ] **Step 1: Write schedule normalization/conflict tests**

Cover multiple meeting days, missing end time, malformed time, overlapping sections, back-to-back non-overlap, stable course color hash, empty successful schedule, unavailable source, and absence of professor email. Assert conflict pairs are emitted once in chronological order.

- [ ] **Step 2: Write component contract tests**

Assert desktop `timeGridWeek`, narrow `timeGridDay`/list fallback, conflict summary text, event details from source, no editable/drag-and-drop controls, and “讨论调整” prefills but does not submit.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `cd desktop/frontend && pnpm exec tsx src/__tests__/consultation-schedule.test.tsx`

Expected: FAIL because normalization and view modules do not exist.

- [ ] **Step 4: Implement schedule normalization and conflict detection**

Parse only the known live-schedule shapes already used by the extension. Do not invent dates from human term names; map recurring weekdays onto a fixed representative week solely for the calendar coordinate system and label the view by term. Keep original day/time text for the accessible list.

- [ ] **Step 5: Implement FullCalendar 6.1.19 rendering**

Use `timeGridPlugin`, `editable={false}`, `eventStartEditable={false}`, `eventDurationEditable={false}`, fixed slot bounds derived from source events with sane campus-day clamps, custom event content from trusted React nodes, and deterministic local colors. Do not use remote FullCalendar plugins or premium scheduler packages.

- [ ] **Step 6: Implement accessible compact list and responsive behavior**

Render a semantic day-grouped list beneath or instead of the grid at narrow widths. Preserve event details and conflict badges in the list. Announce conflicts in a summary region, not via color alone.

- [ ] **Step 7: Run schedule, license, CSS, and type checks**

Run: `cd desktop/frontend && pnpm exec tsx src/__tests__/consultation-schedule.test.tsx && pnpm run check:consultation-licenses && pnpm run check:css && pnpm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit schedule files**

```bash
git add desktop/frontend/src/components/consultation-canvas/ScheduleView.tsx desktop/frontend/src/components/consultation-canvas/ConsultationCanvas.tsx desktop/frontend/src/lib/canvasSchedule.ts desktop/frontend/src/__tests__/consultation-schedule.test.tsx desktop/frontend/src/styles.css desktop/frontend/src/locales/en.ts desktop/frontend/src/locales/zh.ts desktop/frontend/src/locales/zh-TW.ts desktop/frontend/package.json
git commit -m "feat: add consultation timetable canvas"
```

### Task 9: Implement the Cytoscape major-route view

**Files:**
- Create: `desktop/frontend/src/components/consultation-canvas/MajorRouteView.tsx`
- Create: `desktop/frontend/src/lib/canvasRoute.ts`
- Create: `desktop/frontend/src/__tests__/consultation-major-route.test.tsx`
- Modify: `desktop/frontend/src/components/consultation-canvas/ConsultationCanvas.tsx`
- Modify: `desktop/frontend/src/styles.css`
- Modify: `desktop/frontend/src/locales/en.ts`
- Modify: `desktop/frontend/src/locales/zh.ts`
- Modify: `desktop/frontend/src/locales/zh-TW.ts`
- Modify: `desktop/frontend/package.json`

**Interfaces:**
- Produces `toCytoscapeElements(view, evidence): ElementDefinition[]` and `linearizeRoute(view): RouteGroup[]`.
- `MajorRouteView` owns one Cytoscape instance, destroys it on unmount/snapshot change, and exposes selected-node details as React DOM outside the canvas.

- [ ] **Step 1: Write route transformation tests**

Assert every snapshot node/edge maps once, missing course evidence produces a visibly unavailable node, official relations and `recommended` suggestions have distinct classes, status maps only to fixed classes, invalid endpoints never reach Cytoscape, linear list groups by term/order, and no snapshot label becomes HTML.

- [ ] **Step 2: Write lifecycle/accessibility tests**

Inject a fake Cytoscape factory. Assert one instance per view, `fit()` after initial layout, node selection updates a React details panel, cleanup calls `destroy()`, keyboard-accessible linear list mirrors all nodes, and a cyclic graph shows a warning without crashing.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `cd desktop/frontend && pnpm exec tsx src/__tests__/consultation-major-route.test.tsx`

Expected: FAIL because route modules do not exist.

- [ ] **Step 4: Implement trusted element transformation**

Map only `id`, trusted text label, fixed `kind/status/relation` class names, source-backed course metrics, and snapshot topology. Do not pass arbitrary snapshot objects into Cytoscape data or style. Prefix edge IDs deterministically as `edge:<from>:<to>:<index>`.

- [ ] **Step 5: Implement Cytoscape lifecycle and fixed stylesheet**

Create Cytoscape through a ref/effect, use the built-in breadth-first layout for deterministic prerequisite direction, disable graph editing, and allow pan/zoom/selection only. Cytoscape style values live in TypeScript constants owned by the app; none come from `canvas_write`.

- [ ] **Step 6: Implement the linear route fallback**

Render all nodes in semantic ordered groups, relation labels, statuses, evidence availability, and the same selection/details behavior. The list must remain visible to screen readers even when the graph is displayed.

- [ ] **Step 7: Run route, license, CSS, and type checks**

Run: `cd desktop/frontend && pnpm exec tsx src/__tests__/consultation-major-route.test.tsx && pnpm run check:consultation-licenses && pnpm run check:css && pnpm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit route files**

```bash
git add desktop/frontend/src/components/consultation-canvas/MajorRouteView.tsx desktop/frontend/src/components/consultation-canvas/ConsultationCanvas.tsx desktop/frontend/src/lib/canvasRoute.ts desktop/frontend/src/__tests__/consultation-major-route.test.tsx desktop/frontend/src/styles.css desktop/frontend/src/locales/en.ts desktop/frontend/src/locales/zh.ts desktop/frontend/src/locales/zh-TW.ts desktop/frontend/package.json
git commit -m "feat: add consultation major route canvas"
```

### Task 10: Complete integration, regression, and desktop verification

**Files:**
- Create: `desktop/frontend/src/__tests__/consultation-canvas-integration.test.tsx`
- Modify: `desktop/frontend/package.json`
- Modify: any canvas file above only when a failing acceptance test proves a defect
- Test: `internal/campus/native/...`
- Test: `desktop/frontend/src/__tests__/...`

**Interfaces:**
- Produces the final accepted consultation canvas across new/live/history/multi-tab/narrow/dark-mode paths.

- [ ] **Step 1: Write an end-to-end component fixture covering all five views**

Construct one transcript with successful course, professor, live schedule, and major tools followed by `canvas_write`. Stub `ToolResultForTab` by tab/tool ID. Assert overview cards, comparison, schedule, route, and report each render after tab selection; assert source failures remain localized.

- [ ] **Step 2: Add history and tab-isolation acceptance cases**

Assert restored archived tool data reconstructs the canvas, each tab loads only its own IDs, switching tabs preserves local selected view, and a deleted source shows unavailable fields rather than stale facts.

- [ ] **Step 3: Add user-action acceptance cases**

Assert course/professor “继续咨询”, schedule “讨论调整”, and comparison persistence actions replace/prefill the composer without invoking send; external RMP links are only HTTPS; no course-selection, email, calendar, or network write occurs.

- [ ] **Step 4: Run focused canvas suite**

Run: `cd desktop/frontend && pnpm run test:consultation-canvas`

Expected: PASS and includes license, archive, parser, evidence, cards, shell, comparison, schedule, route, and integration tests.

- [ ] **Step 5: Run backend and relevant Pathfinder regression suites**

Run:

```bash
go test ./internal/campus/native ./internal/campus/tools
cd desktop/frontend
pnpm run test:pathfinder
pnpm run test:all
pnpm run build
pnpm run check:consultation-licenses
```

Expected: all commands PASS. If an unrelated dirty-worktree test already fails, record the exact pre-existing failure and still require every canvas-specific test, typecheck, CSS check, and production build to pass.

- [ ] **Step 6: Perform Wails desktop smoke test**

Launch the existing desktop development command documented by the repository. Manually verify: new session empty canvas, tool-populated canvas, historical restoration, two-tab isolation, right-dock resize, narrow overlay, dark/light theme, keyboard tab/controls, reduced motion, source failure, and professor email absence. Capture exact observations in the implementation handoff.

- [ ] **Step 7: Inspect the final diff against the design specification**

Run:

```bash
git diff --check
git status --short
rg -n "Schedule-X|@schedule-x|React Flow|@xyflow|d3-|temporal-polyfill|className.*canvas_write|dangerouslySetInnerHTML" desktop/frontend/package.json desktop/frontend/pnpm-lock.yaml desktop/frontend/src internal/campus/native
```

Expected: no forbidden dependency; no arbitrary generated style/code path; `dangerouslySetInnerHTML` absent from new canvas code; only intended files changed by this feature.

- [ ] **Step 8: Commit acceptance coverage and final corrections**

```bash
git add desktop/frontend/src/__tests__/consultation-canvas-integration.test.tsx desktop/frontend/package.json
git add desktop/frontend/src/components/consultation-canvas desktop/frontend/src/lib/canvasSnapshot.ts desktop/frontend/src/lib/canvasEvidence.ts desktop/frontend/src/lib/canvasSchedule.ts desktop/frontend/src/lib/canvasRoute.ts
git commit -m "test: verify consultation canvas end to end"
```

## Completion Evidence

The feature is complete only when all of the following are evidenced, not inferred:

- `canvas_write` strict Go tests pass and the tool is registered as read-only/plan-safe but excluded from evidence tool names.
- The reducer and history tests prove independent canonical retention for `todo_write` and `canvas_write`.
- Archive-loader tests prove same-tab source recovery and localized missing-source behavior.
- Entity tests prove course/professor fields and field-level provenance, including the no-inferred-email invariant.
- Render tests prove fixed cards and all five view kinds.
- FullCalendar, Cytoscape, and TanStack implementations pass their focused behavior/accessibility tests.
- The exact installed production dependency delta passes the MIT-only checker.
- Pathfinder regression suites, TypeScript, CSS validators, production build, and Wails smoke test pass.
- Final diff audit finds no Schedule-X, React Flow, D3, Temporal, generated HTML/JS/CSS, or hidden external write path added by this feature.
