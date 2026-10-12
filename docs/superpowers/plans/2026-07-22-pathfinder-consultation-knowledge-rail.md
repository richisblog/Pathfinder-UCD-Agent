# Pathfinder Consultation Knowledge Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the right-side Todo-only rail with a synchronized To-dos / Known / Unknown consultation rail whose unknowns are recalculated from current facts, remaining work, user answers, and successful evidence.

**Architecture:** Extend the existing `todo_write` call into one full `ConsultationSnapshot` rather than deriving facts from rendered chat text. The evidence layer and Agent retain the full snapshot so host-driven Todo transitions and restored history cannot discard `known` or `unknown`; the React layer selects the latest valid top-level snapshot and renders three isolated sections.

**Tech Stack:** Go, JSON tool schemas, React 19, TypeScript 6, CSS, Node/tsx contract tests, Wails, macOS codesign and `hdiutil`.

## Global Constraints

- Consultation knowledge is scoped to the current chat and is never written automatically to long-term student memory.
- `known` may contain only explicit user facts or facts supported by successful tool evidence; failures, empty results, guesses, and general experience are excluded.
- `unknown` is a live list: recalculate it after relevant user answers, tool results, and Todo changes; resolved items move to `known` when relevant, and irrelevant gaps are removed.
- A snapshot contains at most 8 Todos, at most 10 known items, and at most 10 unknown items; only one Todo may be `in_progress`.
- Legacy `{"todos":[...]}` payloads remain valid and display empty Known and Unknown states.
- Failed, malformed, nested, or sub-agent `todo_write` calls never replace the canonical main-chat snapshot.
- UI and Agent-generated entries follow the selected English, Simplified Chinese, or Traditional Chinese interface language.
- Do not expose hidden reasoning, prompts, credentials, API keys, local paths, or raw database errors in the rail.
- Preserve all unrelated changes in the existing dirty worktree and stage only files named by the current task.

---

### Task 1: Define and validate the structured consultation snapshot

**Files:**
- Modify: `internal/evidence/evidence.go`
- Modify: `internal/evidence/evidence_test.go`
- Modify: `internal/campus/native/progress_tool.go`
- Modify: `internal/campus/native/progress_tool_test.go`

**Interfaces:**
- Produces: `evidence.ConsultationSnapshot` with `Todos []TodoItem`, `Known []string`, and `Unknown []string`.
- Produces: `evidence.ParseConsultationSnapshot(args json.RawMessage) ConsultationSnapshot`.
- Produces: `evidence.MarshalConsultationSnapshot(snapshot ConsultationSnapshot) ([]byte, error)`.
- Extends: `evidence.Receipt` with normalized `Known` and `Unknown` fields populated for `todo_write`.

- [ ] **Step 1: Add failing parser and validation tests**

Add focused tests that prove legacy parsing, whitespace normalization, and receipt extraction:

```go
func TestParseConsultationSnapshot(t *testing.T) {
	got := ParseConsultationSnapshot(json.RawMessage(`{
		"todos":[{"content":"Check prerequisites","status":"in_progress"}],
		"known":["  Student is planning Spring 2026  "],
		"unknown":["Completed prerequisites?"]
	}`))
	if got.Known[0] != "Student is planning Spring 2026" || got.Unknown[0] != "Completed prerequisites?" {
		t.Fatalf("snapshot = %#v", got)
	}
	legacy := ParseConsultationSnapshot(json.RawMessage(`{"todos":[{"content":"A","status":"pending"}]}`))
	if len(legacy.Todos) != 1 || len(legacy.Known) != 0 || len(legacy.Unknown) != 0 {
		t.Fatalf("legacy snapshot = %#v", legacy)
	}
}
```

Extend `TestCampusTodoWriteRejectsInvalidProgressShape` with empty knowledge strings and 11-item arrays, and extend the valid case to include both new arrays.

- [ ] **Step 2: Run the tests and confirm the new contract fails**

Run:

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/evidence ./internal/campus/native -run 'TestParseConsultationSnapshot|TestCampusTodoWrite' -count=1
```

Expected: FAIL because `ConsultationSnapshot`, parser support, and knowledge validation do not exist.

- [ ] **Step 3: Implement the shared snapshot parser and marshaler**

Add the shared type and normalize only non-empty trimmed strings:

```go
type ConsultationSnapshot struct {
	Todos   []TodoItem `json:"todos"`
	Known   []string   `json:"known,omitempty"`
	Unknown []string   `json:"unknown,omitempty"`
}

func ParseConsultationSnapshot(args json.RawMessage) ConsultationSnapshot {
	var snapshot ConsultationSnapshot
	if json.Unmarshal(args, &snapshot) != nil {
		return ConsultationSnapshot{}
	}
	snapshot.Todos = normalizeTodos(snapshot.Todos)
	snapshot.Known = normalizeConsultationStrings(snapshot.Known)
	snapshot.Unknown = normalizeConsultationStrings(snapshot.Unknown)
	return snapshot
}

func MarshalConsultationSnapshot(snapshot ConsultationSnapshot) ([]byte, error) {
	snapshot.Todos = normalizeTodos(snapshot.Todos)
	snapshot.Known = normalizeConsultationStrings(snapshot.Known)
	snapshot.Unknown = normalizeConsultationStrings(snapshot.Unknown)
	return json.Marshal(snapshot)
}
```

Populate `Receipt.Known` and `Receipt.Unknown` from this parser alongside `Receipt.Todos` so all downstream consumers share one interpretation.

- [ ] **Step 4: Extend the campus tool schema and runtime validation**

Add optional arrays to `campusTodoWrite.Schema()`:

```json
"known":{"type":"array","maxItems":10,"items":{"type":"string","minLength":1}},
"unknown":{"type":"array","maxItems":10,"items":{"type":"string","minLength":1}}
```

Decode the raw payload into `evidence.ConsultationSnapshot` for validation before normalization, reject more than 10 entries, and reject values whose trimmed form is empty. Use `evidence.ParseConsultationSnapshot` only after validation when a normalized snapshot is needed. Keep `todos` required and keep the existing active-item rule.

- [ ] **Step 5: Run backend tests and commit the structured payload**

Run the command from Step 2. Expected: PASS.

Commit only these files:

```bash
git add internal/evidence/evidence.go internal/evidence/evidence_test.go internal/campus/native/progress_tool.go internal/campus/native/progress_tool_test.go
git commit -m "feat: add structured consultation snapshots"
```

---

### Task 2: Preserve Known and Unknown through Agent and history state transitions

**Files:**
- Modify: `internal/agent/agent.go`
- Modify: `internal/agent/canonical_todo_test.go`
- Modify: `internal/agent/complete_step_e2e_test.go`
- Modify: `desktop/app.go`
- Modify: `desktop/history_todo_test.go`

**Interfaces:**
- Consumes: `evidence.ConsultationSnapshot`, `ParseConsultationSnapshot`, and `MarshalConsultationSnapshot` from Task 1.
- Produces: Agent canonical state that advances Todo status without clearing `Known` or `Unknown`.
- Produces: restored history arguments containing all three snapshot arrays after synthesized `complete_step` transitions.

- [ ] **Step 1: Add failing preservation tests**

Create a successful `todo_write` with one known and one unknown item, execute/record a matching `complete_step`, and assert the emitted `host-advance-*` event contains both arrays unchanged while the matching Todo becomes completed.

Add a desktop history test with this shape:

```go
args := `{"todos":[{"content":"Check course","status":"in_progress"}],"known":["Student chose ECS 150"],"unknown":["Instructor not confirmed"]}`
// Feed a successful todo_write and complete_step into historyTodoArgsWithCompleteSteps.
// Assert the rewritten args preserve known/unknown and mark the Todo completed.
```

- [ ] **Step 2: Run preservation tests and verify failure**

Run:

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/agent ./desktop -run 'Test.*Consultation.*Preserv|Test.*Knowledge.*HostAdvance|Test.*History.*Knowledge' -count=1
```

Expected: FAIL because current synthetic and history payloads marshal only `todos`.

- [ ] **Step 3: Store the complete canonical snapshot in Agent**

Keep existing Todo APIs compatible, but guard all three fields with `todoMu`:

```go
todoState   []evidence.TodoItem
todoKnown   []string
todoUnknown []string
```

Add internal helpers:

```go
func (a *Agent) setConsultationState(snapshot evidence.ConsultationSnapshot)
func (a *Agent) canonicalConsultationState() evidence.ConsultationSnapshot
func (a *Agent) recordConsultationState(snapshot evidence.ConsultationSnapshot)
func (a *Agent) emitConsultationState(snapshot evidence.ConsultationSnapshot, itemIndex int)
```

Model `todo_write` success calls `setConsultationState` using the receipt fields. Host plan seeding calls the legacy `setTodoState`, which intentionally clears knowledge because it starts a new state. `advanceCanonicalTodo` updates a cloned full snapshot and passes it to the record and emit helpers.

- [ ] **Step 4: Preserve snapshot fields while rebuilding and serializing history**

In `rebuildTodoState`, retain the latest successful full `todo_write` snapshot and apply later `complete_step` changes only to `snapshot.Todos`.

In `desktop/app.go`, replace Todo-only history reconstruction with `evidence.ParseConsultationSnapshot` and `evidence.MarshalConsultationSnapshot`. A successful empty Todo list remains an explicit clear, while non-empty legacy payloads still work.

- [ ] **Step 5: Run preservation and existing canonical Todo tests**

Run:

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/agent ./desktop -run 'Test.*Consultation.*Preserv|Test.*Knowledge.*HostAdvance|Test.*History.*Knowledge|Test.*CanonicalTodo|Test.*CompleteStep' -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit canonical-state preservation**

```bash
git add internal/agent/agent.go internal/agent/canonical_todo_test.go internal/agent/complete_step_e2e_test.go desktop/app.go desktop/history_todo_test.go
git commit -m "fix: preserve consultation knowledge during progress updates"
```

---

### Task 3: Teach the academic Agent to maintain live knowledge gaps

**Files:**
- Modify: `internal/campus/native/progress_tool.go`
- Modify: `internal/campus/native/tools.go`
- Modify: `internal/campus/native/tools_test.go`

**Interfaces:**
- Consumes: expanded `todo_write` schema from Task 1.
- Produces: explicit Agent rules for full-snapshot refreshes, evidence provenance, language matching, and Unknown-to-Known migration.

- [ ] **Step 1: Add failing prompt-contract assertions**

Extend the existing `SystemPromptAddon` contract test to require phrases expressing these rules:

```go
for _, want := range []string{
	"known and unknown",
	"full todo_write snapshot",
	"successful tool evidence",
	"remove it from unknown",
	"match the student's language",
} {
	if !strings.Contains(strings.ToLower(SystemPromptAddon), want) {
		t.Errorf("SystemPromptAddon missing %q", want)
	}
}
```

- [ ] **Step 2: Run the prompt-contract test and verify failure**

Run:

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/campus/native -run 'Test.*SystemPrompt|TestToolsUseCampusNativeInstructions' -count=1
```

Expected: FAIL on the new instructions.

- [ ] **Step 3: Add concise consultation-state instructions**

Update `SystemPromptAddon` so the Agent:

- sends `todos`, `known`, and `unknown` together after every material update;
- derives Unknown from the latest Known, unfinished Todos, user answers, and successful evidence;
- moves a resolved unknown into Known only when grounded and relevant;
- removes gaps that no longer affect the answer;
- represents login/pairing/data-access blockers as concise unknown conditions rather than known facts;
- never includes raw errors or internal details;
- writes all visible entries in the student's selected response language.

Also update `campusTodoWrite.Description()` to tell the model that the payload is the full visible consultation state.

- [ ] **Step 4: Run native campus tests and commit the behavior contract**

Run:

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/campus/native -count=1
```

Expected: PASS.

Commit:

```bash
git add internal/campus/native/tools.go internal/campus/native/tools_test.go internal/campus/native/progress_tool.go
git commit -m "feat: maintain live academic knowledge gaps"
```

---

### Task 4: Parse one canonical consultation snapshot in the frontend

**Files:**
- Modify: `desktop/frontend/src/lib/tools.ts`
- Modify: `desktop/frontend/src/lib/todoSnapshot.ts`
- Modify: `desktop/frontend/src/lib/todoVisibility.ts`
- Modify: `desktop/frontend/src/__tests__/todo-snapshot.test.ts`
- Modify: `desktop/frontend/scripts/test-todo-visibility.mjs`

**Interfaces:**
- Produces: TypeScript `ConsultationSnapshot { todos: Todo[]; known: string[]; unknown: string[] }`.
- Produces: `parseConsultationSnapshot(args: string): ConsultationSnapshot`.
- Changes: `latestTodoSnapshot(items)` to return a full `ConsultationSnapshot`.
- Produces: `consultationDismissalKey(snapshot)` so a materially updated snapshot can reappear after an older one was dismissed.

- [ ] **Step 1: Add failing snapshot-selection tests**

Cover a live top-level payload with all three arrays, a failed later update that falls back to the previous full snapshot, a nested update that is ignored, and a legacy payload that becomes `{ todos, known: [], unknown: [] }`.

```ts
assert.deepEqual(latestTodoSnapshot([todoTool("live", "running", {
  todos: live,
  known: ["Student prefers a light workload"],
  unknown: ["Completed prerequisites are not confirmed"],
})]), {
  todos: live,
  known: ["Student prefers a light workload"],
  unknown: ["Completed prerequisites are not confirmed"],
});
```

Add visibility assertions proving two snapshots with identical Todos but different knowledge produce different dismissal keys, while their Todo batch key remains stable.

- [ ] **Step 2: Run focused frontend tests and verify failure**

Run:

```bash
cd desktop/frontend
/opt/homebrew/bin/pnpm exec tsx src/__tests__/todo-snapshot.test.ts
/opt/homebrew/bin/pnpm run test:todo-visibility
```

Expected: FAIL because the parser and selector currently return only `Todo[]`.

- [ ] **Step 3: Implement defensive parsing and snapshot selection**

Add:

```ts
export interface ConsultationSnapshot {
  todos: Todo[];
  known: string[];
  unknown: string[];
}

export function parseConsultationSnapshot(args: string): ConsultationSnapshot {
  try {
    const value = JSON.parse(args) as Partial<ConsultationSnapshot>;
    return {
      todos: Array.isArray(value.todos) ? value.todos : [],
      known: stringList(value.known),
      unknown: stringList(value.unknown),
    };
  } catch {
    return { todos: [], known: [], unknown: [] };
  }
}
```

`latestTodoSnapshot` accepts a valid running call immediately, accepts a successful done call, ignores nested/failed/malformed calls, and returns an empty snapshot only when no valid call exists.

- [ ] **Step 4: Include knowledge in dismissal identity without changing batch identity**

Implement `consultationDismissalKey(snapshot)` from normalized Todos, Known, and Unknown. Continue using Todo content/level only for `todoBatchKey` so status and knowledge refreshes do not remount the rail or discard manual collapse state.

- [ ] **Step 5: Run focused tests and commit frontend state parsing**

Run the commands from Step 2. Expected: PASS.

Commit:

```bash
git add desktop/frontend/src/lib/tools.ts desktop/frontend/src/lib/todoSnapshot.ts desktop/frontend/src/lib/todoVisibility.ts desktop/frontend/src/__tests__/todo-snapshot.test.ts desktop/frontend/scripts/test-todo-visibility.mjs
git commit -m "feat: synchronize consultation snapshots in the frontend"
```

---

### Task 5: Render the three-section bilingual rail

**Files:**
- Modify: `desktop/frontend/src/App.tsx`
- Modify: `desktop/frontend/src/components/TodoRail.tsx`
- Modify: `desktop/frontend/src/styles.css`
- Modify: `desktop/frontend/src/locales/en.ts`
- Modify: `desktop/frontend/src/locales/zh.ts`
- Modify: `desktop/frontend/src/locales/zh-TW.ts`
- Modify: `desktop/frontend/src/__tests__/todo-rail-layout.test.ts`
- Modify: `desktop/frontend/src/__tests__/todo-rail-state.test.ts`
- Modify: `desktop/frontend/src/__tests__/pathfinder-bilingual-contract.test.ts`
- Modify: `desktop/frontend/package.json`

**Interfaces:**
- Consumes: `ConsultationSnapshot` and `consultationDismissalKey` from Task 4.
- Changes: `TodoRail` props to `{ stateKey, snapshot, onDismiss }`.
- Produces: three titled, counted, independently scrollable rail regions with localized empty states.

- [ ] **Step 1: Add failing UI contract tests**

Require the rail source to render `todo-rail__section--todos`, `todo-rail__section--known`, and `todo-rail__section--unknown`; require `App.tsx` to pass `snapshot={consultationSnapshot}`; require all three locale files to define:

```text
todo.knownTitle
todo.unknownTitle
todo.knownEmpty
todo.unknownEmpty
```

Add a state assertion that completion still collapses the rail but does not remove the snapshot, and that reopening exposes Known and Unknown.

- [ ] **Step 2: Run UI contract tests and verify failure**

Run:

```bash
cd desktop/frontend
/opt/homebrew/bin/pnpm exec tsx src/__tests__/todo-rail-layout.test.ts
/opt/homebrew/bin/pnpm exec tsx src/__tests__/todo-rail-state.test.ts
/opt/homebrew/bin/pnpm exec tsx src/__tests__/pathfinder-bilingual-contract.test.ts
```

Expected: FAIL because only the Todo list is rendered.

- [ ] **Step 3: Wire the full snapshot through App**

Replace the Todo-only memo with:

```ts
const consultationSnapshot = useMemo(() => latestTodoSnapshot(state.items), [state.items]);
const todos = consultationSnapshot.todos;
const todoKey = useMemo(
  () => consultationDismissalKey(consultationSnapshot),
  [consultationSnapshot],
);
```

Keep session scoping and incomplete-Todo visibility behavior, and pass the complete snapshot to `TodoRail`.

- [ ] **Step 4: Render isolated sections with stable semantics**

Refactor `TodoRail` so its open body is:

```tsx
<div className="todo-rail__sections">
  <RailSection kind="todos" title={t("todo.title")} count={`${done}/${todos.length}`}>
    {/* existing status-aware Todo list */}
  </RailSection>
  <RailSection kind="known" title={t("todo.knownTitle")} count={known.length}>
    {/* bullet list or localized empty state */}
  </RailSection>
  <RailSection kind="unknown" title={t("todo.unknownTitle")} count={unknown.length}>
    {/* question-mark list or localized empty state */}
  </RailSection>
</div>
```

Keep scroll-to-current behavior inside the Todo section. Do not parse chat content or tool output in this component.

- [ ] **Step 5: Add the three-section layout and bilingual copy**

Use a vertical CSS grid with three `minmax(0, 1fr)` rows and `overflow-y: auto` inside each section. Preserve the existing 286px width, overlay behavior below 1080px, collapsed 52px width, and reduced-motion rule.

Translations:

```text
English: Known / Unknown / No confirmed information yet / No important unknowns right now
简体中文: 已知内容 / 未知内容 / 暂无已确认内容 / 暂无影响结论的未知项
繁體中文: 已知內容 / 未知內容 / 暫無已確認內容 / 暫無影響結論的未知項
```

- [ ] **Step 6: Register and run the consultation rail tests**

Add a `test:consultation-rail` package script containing the snapshot, layout, state, and visibility tests, then include it in `test:pathfinder`.

Run:

```bash
cd desktop/frontend
/opt/homebrew/bin/pnpm run test:consultation-rail
/opt/homebrew/bin/pnpm run test:pathfinder
/opt/homebrew/bin/pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the three-section UI**

```bash
git add desktop/frontend/src/App.tsx desktop/frontend/src/components/TodoRail.tsx desktop/frontend/src/styles.css desktop/frontend/src/locales/en.ts desktop/frontend/src/locales/zh.ts desktop/frontend/src/locales/zh-TW.ts desktop/frontend/src/__tests__/todo-rail-layout.test.ts desktop/frontend/src/__tests__/todo-rail-state.test.ts desktop/frontend/src/__tests__/pathfinder-bilingual-contract.test.ts desktop/frontend/package.json
git commit -m "feat: add known and unknown consultation rail"
```

---

### Task 6: Regression verification and macOS DMG packaging

**Files:**
- Modify only if a discovered packaging regression requires it: `desktop/scripts/package-local-dmg.sh`
- Generated: `dist/PathfinderUCD-darwin-arm64.dmg`
- Generated: `/Users/richis/Desktop/PathfinderUCD.dmg`

**Interfaces:**
- Consumes: all implementation tasks.
- Produces: a signed arm64 Pathfinder UCD app in a verified DMG with runtime databases staged.

- [ ] **Step 1: Run focused Go regression tests**

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/evidence ./internal/campus/native ./internal/agent ./desktop -run 'Test.*Consultation|TestCampusTodoWrite|Test.*Knowledge|Test.*CanonicalTodo|Test.*CompleteStep' -count=1
```

Expected: PASS. If unrelated deleted `internal/tool/builtin` sources prevent a broader package build, record the exact pre-existing compile failure and do not restore user-deleted files.

- [ ] **Step 2: Run the frontend suite and production build**

```bash
cd desktop/frontend
/opt/homebrew/bin/pnpm run test:all
/opt/homebrew/bin/pnpm run test:pathfinder
/opt/homebrew/bin/pnpm run build
```

Expected: all tests, TypeScript checks, CSS checks, and Vite production build PASS.

- [ ] **Step 3: Build the Wails arm64 application**

```bash
cd desktop
PATH="/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin:/Users/richis/go/bin:/opt/homebrew/bin:/usr/bin:/bin" /Users/richis/go/bin/wails build -platform darwin/arm64 -clean
```

Expected: `desktop/build/bin/pathfinder-ucd.app` is produced. If the synced Documents directory adds Finder metadata and Wails self-signing fails, run `xattr -cr desktop/build/bin/pathfinder-ucd.app`, then `codesign --force --deep -s - desktop/build/bin/pathfinder-ucd.app` and verify it with `codesign --verify --deep --strict`.

- [ ] **Step 4: Package and verify the DMG**

From the repository root:

```bash
zsh desktop/scripts/package-local-dmg.sh
```

Expected: the script verifies codesigning, arm64 executable type, database staging, DMG mountability, and identical copies at `dist/PathfinderUCD-darwin-arm64.dmg` and `/Users/richis/Desktop/PathfinderUCD.dmg`, then prints a SHA-256 checksum.

- [ ] **Step 5: Perform a clean mounted-app smoke check**

Open the mounted app and verify:

1. A managed academic request opens the three-section rail.
2. A user answer removes a resolved Unknown and adds a relevant Known item.
3. A successful tool result updates Known; a failed tool result never appears as a fact.
4. Todo progress matches the transcript and does not erase Known or Unknown.
5. Switching the UI language changes headings, empty states, and subsequent Agent entries.
6. Reopening the chat restores the same snapshot; another chat does not inherit it.

- [ ] **Step 6: Record delivery details**

Report the two DMG paths, SHA-256 checksum, codesign result, focused test results, frontend build result, and any unrelated pre-existing repository failures. Do not stage generated DMGs or unrelated dirty-worktree files unless explicitly requested.
