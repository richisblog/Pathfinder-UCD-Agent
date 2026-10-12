# Pathfinder Progress-Aware Academic Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PROGRA-inspired inference-time progress awareness to Pathfinder's academic tool loop while preserving the DeepSeek-Reasonix desktop frontend, then replace the stale upstream READMEs with polished bilingual product documentation.

**Architecture:** A focused `internal/campus/progress` package derives bounded transient context from the current request, canonical Todo state, and campus tool history. A generic Agent turn-context hook injects that block without coupling core agent code to campus logic. The campus native registry supplies a read-only `todo_write` implementation and an identical-success result cache, while the existing Reasonix frontend renders Todo and tool events unchanged.

**Tech Stack:** Go 1.25+, React 19/TypeScript, Wails v2, Go `testing`, Markdown.

## Global Constraints

- Preserve the DeepSeek-Reasonix desktop layout and existing uncommitted work.
- Do not restore shell, file writer, or unrelated coding-agent tools.
- Do not add a second model call for progress generation.
- Do not expose the transient progress block or hidden reasoning in the frontend.
- Do not claim to reproduce PROGRA's SFT/RL training or benchmark gains.
- Keep campus tools read-only and local-data grounded.
- Rewrite both `README.md` and `README.zh-CN.md` with matching structure and truthful claims.

## File Structure

- `internal/campus/progress/{policy,snapshot,context}.go`: classification and bounded progress reconstruction.
- `internal/agent/agent.go`: generic turn-context hook and configured read-only progress gate.
- `internal/agent/preview.go`: hide transient progress markup from user-visible history.
- `internal/campus/native/progress_tool.go`: campus-owned read-only `todo_write`.
- `internal/campus/native/cache.go`: canonical identical-success query cache.
- `internal/campus/native/tools.go`: tool registration, data-tool names, and academic system prompt.
- `internal/evidence/evidence.go`: successful named-tool lookup.
- `internal/boot/boot.go`: campus-only progress wiring.
- `README.md`, `README.zh-CN.md`: bilingual Pathfinder documentation.

---

### Task 1: Progress Policy And Snapshot

**Files:**
- Create: `internal/campus/progress/policy.go`
- Create: `internal/campus/progress/snapshot.go`
- Create: `internal/campus/progress/context.go`
- Test: `internal/campus/progress/progress_test.go`

**Interfaces:**
- Consumes: current input, `[]provider.Message`, `[]evidence.TodoItem`.
- Produces: `ManagedConsultation(input string, todos []evidence.TodoItem) bool` and `BuildContext(input string, history []provider.Message, todos []evidence.TodoItem) string`.

- [ ] **Step 1: Write failing tests**

```go
func TestManagedConsultationClassification(t *testing.T) {
    if ManagedConsultation("你好", nil) { t.Fatal("greeting should stay direct") }
    if !ManagedConsultation("比较 CS 和 Data Science 转专业要求并给我下学期计划", nil) {
        t.Fatal("multi-step academic planning should be managed")
    }
}

func TestBuildContextIncludesTodoAndObservation(t *testing.T) {
    history := []provider.Message{
        {Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{ID: "c1", Name: "compare_change_major_requirements", Arguments: `{"majors":["CS","Data Science"]}`}}},
        {Role: provider.RoleTool, ToolCallID: "c1", Name: "compare_change_major_requirements", Content: `{"ok":true,"summary":"requirements found"}`},
    }
    todos := []evidence.TodoItem{{Content: "核验转专业要求", Status: "in_progress"}}
    got := BuildContext("继续", history, todos)
    for _, want := range []string{"<consultation-progress>", "核验转专业要求", "compare_change_major_requirements", "requirements found"} {
        if !strings.Contains(got, want) { t.Fatalf("missing %q: %s", want, got) }
    }
}
```

- [ ] **Step 2: Verify RED**

Run: `go test ./internal/campus/progress -count=1`

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Implement bounded deterministic context**

Define `Snapshot` with `Goal`, `Todos`, `Observations`, and `NextAction`. Pair assistant tool calls with results, include only campus tools, normalize whitespace, cap each result excerpt at 320 runes, keep six observations, and cap the complete block at 2400 runes. Existing Todo state always makes a turn managed; otherwise use explicit comparison, planning, eligibility, multi-quarter, and multi-condition markers.

- [ ] **Step 4: Verify GREEN**

Run: `go test ./internal/campus/progress -count=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/campus/progress
git commit -m "feat(campus): add progress-aware consultation context"
```

---

### Task 2: Generic Agent Turn-Context Seam

**Files:**
- Modify: `internal/agent/agent.go`
- Modify: `internal/agent/preview.go`
- Test: `internal/agent/turn_context_test.go`
- Test: `internal/agent/preview_test.go`

**Interfaces:**
- Produces: `type TurnContextBuilder func(input string, history []provider.Message, todos []evidence.TodoItem) string` and `agent.Options.TurnContextBuilder`.

- [ ] **Step 1: Write failing injection and stripping tests**

Use the existing scripted provider helper to run a user turn with a builder returning `<consultation-progress>next: query</consultation-progress>`. Assert the provider request contains the block and `StripTransientUserBlocks(storedUser.Content)` equals the original user input.

- [ ] **Step 2: Verify RED**

Run: `go test ./internal/agent -run 'TestRunInjectsTurnContext|TestStripTransientUserBlocks' -count=1`

Expected: FAIL because the option and transient tag are unsupported.

- [ ] **Step 3: Add the seam**

Add the function type to `agent.Options` and `Agent`. In `Run`, call it with `rawInput`, the pre-turn session snapshot, and `CanonicalTodoState()`, then prefix the non-empty block before language preferences. Extend `reTransientUserBlock` with `consultation-progress` so transcript previews and titles preserve only user-authored text.

- [ ] **Step 4: Verify GREEN**

Run: `go test ./internal/agent -run 'TestRunInjectsTurnContext|TestStripTransientUserBlocks' -count=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/agent/agent.go internal/agent/preview.go internal/agent/turn_context_test.go internal/agent/preview_test.go
git commit -m "feat(agent): support transient consultation progress"
```

---

### Task 3: Campus Todo, Duplicate Reuse, And Completion Gate

**Files:**
- Create: `internal/campus/native/progress_tool.go`
- Create: `internal/campus/native/cache.go`
- Modify: `internal/campus/native/tools.go`
- Modify: `internal/evidence/evidence.go`
- Modify: `internal/agent/agent.go`
- Test: `internal/campus/native/progress_tool_test.go`
- Test: `internal/evidence/evidence_test.go`
- Test: `internal/agent/loop_e2e_test.go`

**Interfaces:**
- Produces: campus tool `todo_write`; `DataToolNames(paths tools.Paths) []string`; `(*Ledger).HasSuccessfulNamedTool(names map[string]bool) bool`; `agent.Options.ProgressReadTools []string`.

- [ ] **Step 1: Write failing behavior tests**

Test that `Tools` contains a read-only `todo_write`, rejects two `in_progress` items, accepts a valid student-facing list, and caps lists at eight items. Test that the same campus query with reordered JSON keys returns the first result with a `reused` marker and invokes its runner only once. Test that final readiness blocks after a configured campus progress tool succeeds while Todo state is incomplete.

- [ ] **Step 2: Verify RED**

Run: `go test ./internal/campus/native ./internal/evidence ./internal/agent -run 'Todo|Duplicate|ProgressRead' -count=1`

Expected: FAIL because these behaviors do not exist.

- [ ] **Step 3: Implement campus Todo**

Validate non-empty content, statuses `pending|in_progress|completed`, at most one `in_progress`, and at most eight items. Return `consultation progress updated`. Keep `ReadOnly()` and `PlanModeSafe()` true; do not touch the filesystem or restore deleted coding tools.

- [ ] **Step 4: Implement successful-result reuse**

Canonicalize arguments by unmarshalling to `any` and re-marshalling with `encoding/json`. Key by tool name plus canonical JSON. Cache successes only and exclude `todo_write`. Return `[reused cached result for identical campus query]` followed by the original output.

- [ ] **Step 5: Implement configured read-progress gating**

Add `ProgressReadTools []string` to Agent options. Add a ledger query for successful named tools. In final readiness, treat those configured campus reads as progress so an unfinished Todo blocks premature completion; a missing-input question before any campus query remains allowed.

- [ ] **Step 6: Verify GREEN**

Run: `go test ./internal/campus/native ./internal/evidence ./internal/agent -run 'Todo|Duplicate|ProgressRead' -count=1`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add internal/campus/native internal/evidence/evidence.go internal/evidence/evidence_test.go internal/agent/agent.go internal/agent/loop_e2e_test.go
git commit -m "feat(campus): enforce efficient consultation progress"
```

---

### Task 4: Academic Prompt And Boot Wiring

**Files:**
- Modify: `internal/campus/native/tools.go`
- Modify: `internal/boot/boot.go`
- Test: `internal/campus/native/tools_test.go`
- Test: closest existing `internal/boot/*_test.go` for Agent options.

**Interfaces:**
- Consumes: `progress.BuildContext`, `native.DataToolNames`.
- Produces: campus-only `TurnContextBuilder` and `ProgressReadTools` wiring.

- [ ] **Step 1: Write failing contract tests**

Assert the prompt contains role, direct/managed classification, progress interpretation, Todo semantics, tool priorities, missing-input behavior, duplicate/failure rules, completion criteria, evidence safety, and student-friendly style. Assert it omits obsolete copy-paste-file instructions. Assert boot supplies the progress builder and campus tool names when campus data is available.

- [ ] **Step 2: Verify RED**

Run: `go test ./internal/campus/native ./internal/boot -run 'SystemPrompt|CampusProgress' -count=1`

Expected: FAIL against the terse addon and unwired options.

- [ ] **Step 3: Replace prompt and wire boot**

Write the approved stable academic contract. Construct an optional `agent.TurnContextBuilder` and `[]string` progress tool list immediately after campus availability is resolved, then pass them into executor options. Leave both empty outside campus mode.

- [ ] **Step 4: Verify GREEN**

Run: `go test ./internal/campus/native ./internal/boot -run 'SystemPrompt|CampusProgress' -count=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/campus/native/tools.go internal/campus/native/tools_test.go internal/boot/boot.go internal/boot/*test.go
git commit -m "feat(campus): wire progress-aware academic planning"
```

---

### Task 5: Mature Bilingual Open-Source README

**Files:**
- Rewrite: `README.md`
- Rewrite: `README.zh-CN.md`

**Interfaces:**
- Documents only commands, paths, capabilities, and limits verified from Tasks 1–4 and repository sources.

- [ ] **Step 1: Build a documentation evidence checklist**

Verify app name, Go version, frontend scripts, desktop build command, environment variables, campus database filenames, data tools, package output, license, and current screenshot assets using `rg`, `go.mod`, `package.json`, and build scripts.

- [ ] **Step 2: Rewrite English README**

Use this order: hero/language links; overview; why Pathfinder; capabilities; progress-aware workflow; architecture; quick start; provider configuration; campus data; development; testing; packaging; security/privacy; troubleshooting; roadmap; research inspiration; contributing; license.

- [ ] **Step 3: Rewrite Chinese README with matching structure**

Translate prose naturally. Keep commands, variables, paths, tool names, and claims identical to English.

- [ ] **Step 4: Validate documentation**

Run: `rg -n "terminal coding agent|npm i -g reasonix|Discord|PayPal|微信支付|TBD|TODO" README.md README.zh-CN.md`

Expected: no matches. Check every relative Markdown link exists and every documented command maps to a repository script or Make target.

- [ ] **Step 5: Commit**

```bash
git add README.md README.zh-CN.md
git commit -m "docs: present Pathfinder as a mature open-source project"
```

---

### Task 6: Full Verification And Desktop Smoke Test

**Files:**
- Modify only files required to fix failures introduced by Tasks 1–5.

**Interfaces:**
- Produces authoritative evidence for every success criterion in the approved spec.

- [ ] **Step 1: Format and run targeted Go tests**

Run: `gofmt -w internal/campus/progress internal/campus/native internal/agent internal/evidence internal/boot`

Run: `go test ./internal/campus/progress ./internal/campus/native ./internal/evidence ./internal/agent ./internal/boot -count=1`

Expected: PASS.

- [ ] **Step 2: Run broader regression tests**

Run: `go test ./internal/campus/... ./internal/control/... ./desktop/... -count=1`

Expected: PASS, or record exact pre-existing unrelated failures before changing scope.

- [ ] **Step 3: Build the preserved Reasonix frontend**

Run from `desktop/frontend`: `npm run build`

Expected: TypeScript and Vite build succeed.

- [ ] **Step 4: Build and launch desktop**

Use the verified repository desktop build script. Confirm through the accessibility tree that the window still renders Reasonix navigation, transcript, composer, and task/tool surfaces.

- [ ] **Step 5: Run a representative consultation smoke test**

Ask a multi-step change-of-major question. Confirm Todo creation, aggregate tool selection, visible progress updates, no duplicate identical query, grounded response, and a correct pause when a student-owned value is missing.

- [ ] **Step 6: Audit spec and README claims**

Prepare a requirement-to-evidence checklist. Do not claim a criterion without a passing test, build output, source inspection, or runtime observation.

- [ ] **Step 7: Commit verification-only fixes if needed**

List the files changed while resolving verification findings with `git status --short`, stage each of those exact paths explicitly, review `git diff --cached`, then commit them with `git commit -m "fix(campus): resolve progress-aware verification findings"`. Skip this step when verification required no fixes.
