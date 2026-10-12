# Pathfinder Data Packaging and Term Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package only Pathfinder's required academic evidence, start every installation with empty user/chat state, and convert human-readable UC Davis terms to Schedule Builder's six-digit codes.

**Architecture:** A small Go normalizer owns the term-code contract before requests cross the browser bridge. A reusable shell staging helper owns an explicit academic-resource allowlist, while the DMG builder invokes it before signing and audits the mounted image afterward. The writable `pathfinder.db` remains outside the bundle in the per-user application-data directory.

**Tech Stack:** Go 1.x, modernc SQLite, zsh, sqlite3 CLI, Wails v2, macOS `codesign` and `hdiutil`.

## Global Constraints

- Package exactly `rmp.db`, `courses.db`, `majors.db`, `changemajor.db`, and `ucdavis_calendar.db`.
- Never package `app.db`, `users.db`, chat transcripts, `*.bak`, `*-wal`, `*-shm`, or `.DS_Store`.
- Preserve an empty `Contents/Resources/data/chat` directory.
- Keep user state in the runtime-created per-user `pathfinder.db`.
- Treat bare Summer terms as ambiguous; do not guess a Summer suffix.
- Retain the extension's six-digit term validation.

---

### Task 1: Normalize UC Davis term names before the browser bridge

**Files:**
- Create: `internal/campus/native/term_code.go`
- Create: `internal/campus/native/term_code_test.go`
- Modify: `internal/campus/native/live_schedule_tool.go`
- Modify: `internal/campus/native/live_schedule_tool_test.go`

**Interfaces:**
- Produces: `normalizeUCDTerm(input string) (string, error)` returning a validated six-digit term code.
- Consumes: `liveScheduleTool.Execute`, which sends only normalized terms to `livebridge.Client.Search`.

- [ ] **Step 1: Write the failing table-driven normalizer tests**

Cover direct codes and every supplied suffix:

```go
func TestNormalizeUCDTerm(t *testing.T) {
    tests := map[string]string{
        "202601": "202601",
        "Winter Quarter 2026": "202601",
        "Spring Semester 2026": "202602",
        "Spring Qtr 2026": "202603",
        "Summer Session 1 2026": "202605",
        "Summer Special Session 2026": "202606",
        "Sum Ses 2 2026": "202607",
        "Summer Quarter 2026": "202608",
        "Fall Semester 2026": "202609",
        "2026-fall": "202610",
        "2026年秋季学期": "202610",
        "2026年夏季第二期": "202607",
    }
    for input, want := range tests {
        got, err := normalizeUCDTerm(input)
        if err != nil || got != want { t.Fatalf("%q => %q, %v; want %q", input, got, err, want) }
    }
}
```

Add rejection cases for `Summer 2026`, `2026 夏季`, `202604`, `202611`, and malformed years.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `go test ./internal/campus/native -run 'TestNormalizeUCDTerm'`

Expected: compilation fails because `normalizeUCDTerm` does not exist.

- [ ] **Step 3: Implement the minimal term normalizer**

Implement a focused parser with the suffix map:

```go
var ucdTermSuffixes = map[string]string{
    "winter quarter": "01", "spring semester": "02", "spring quarter": "03",
    "summer session 1": "05", "summer special session": "06",
    "summer session 2": "07", "summer quarter": "08",
    "fall semester": "09", "fall quarter": "10",
}
```

Normalize documented English abbreviations, slugs, and Chinese aliases to those canonical keys; extract exactly one four-digit year; reject ambiguous Summer and unsupported six-digit suffixes.

- [ ] **Step 4: Write a failing bridge-boundary test**

Change the existing live-schedule test to call with `2026-fall` and require `client.request.Term == "202610"`. Add a test proving ambiguous Summer returns an error and leaves `client.request.ID` empty.

- [ ] **Step 5: Run the bridge tests and verify RED**

Run: `go test ./internal/campus/native -run 'TestLiveScheduleTool'`

Expected: the request still contains `2026-fall`.

- [ ] **Step 6: Wire normalization into the tool and clarify its schema**

In `Execute`, replace raw trimming with:

```go
term, err := normalizeUCDTerm(args.Term)
if err != nil {
    return "", fmt.Errorf("invalid live schedule args: %w", err)
}
args.Term = term
```

Update the schema description to say that `term` accepts a six-digit code or human-readable UC Davis term and that Summer must name the session type.

- [ ] **Step 7: Run all native campus tests**

Run: `go test ./internal/campus/native`

Expected: PASS.

### Task 2: Replace raw SQLite failures with resource-specific errors

**Files:**
- Modify: `internal/campus/tools/runner.go`
- Modify: `internal/campus/tools/runner_test.go`

**Interfaces:**
- Produces: preflight validation inside `Runner.RunTool` for the database or text directory required by each tool.
- Consumes: existing `Runner.paths` and tool-name dispatch.

- [ ] **Step 1: Write failing missing-resource tests**

Add tests that call `query_course_db`, `query_rmp_table`, and `query_ucdavis_calendar` with an empty temporary data root and assert errors contain the missing filename plus `Pathfinder academic data is missing`. Also assert an unknown tool still reports `unknown tool`.

- [ ] **Step 2: Run the tests and verify RED**

Run: `go test ./internal/campus/tools -run 'TestRunnerReportsMissingAcademicData'`

Expected: errors contain raw SQLite open failures instead of resource names.

- [ ] **Step 3: Add per-tool resource preflight**

Add a helper returning required paths by tool family and call it before dispatch:

```go
func (r *Runner) requireAcademicData(name string) error {
    // Map professor tools to rmp.db, course tools to courses.db,
    // major tools to majors.db/changemajor.db, calendar to ucdavis_calendar.db,
    // and text search to TextDir.
}
```

Return `Pathfinder academic data is missing: <filename>` for absent files.

- [ ] **Step 4: Run campus tool tests**

Run: `go test ./internal/campus/tools`

Expected: PASS.

### Task 3: Stage an exact runtime-data allowlist with empty chat state

**Files:**
- Create: `desktop/scripts/stage-runtime-data.sh`
- Create: `desktop/scripts/stage-runtime-data_test.sh`
- Modify: `desktop/scripts/package-local-dmg.sh`
- Modify: `desktop/package_dmg.sh`

**Interfaces:**
- Produces: `stage-runtime-data.sh <source-data-root> <app-bundle>`.
- Consumes: `PATHFINDER_DATA_SOURCE`, defaulting to `desktop/PathfinderUCD.app/Contents/Resources/data` for the current workspace asset set.

- [ ] **Step 1: Write the failing staging integration test**

The test creates a temporary source tree containing five valid SQLite databases, two policy files, and forbidden `app.db`, `users.db`, `.bak`, `-wal`, `-shm`, and `.DS_Store` files. It invokes `stage-runtime-data.sh` and asserts:

```zsh
expected=(changemajor.db courses.db majors.db rmp.db ucdavis_calendar.db)
actual=("$app/Contents/Resources/data/sqlite"/*.db(N:t))
[[ "${(j: :)actual}" == "${(j: :)expected}" ]]
[[ -d "$app/Contents/Resources/data/chat" ]]
[[ -z "$(find "$app/Contents/Resources/data/chat" -mindepth 1 -print -quit)" ]]
```

- [ ] **Step 2: Run the staging test and verify RED**

Run: `zsh desktop/scripts/stage-runtime-data_test.sh`

Expected: FAIL because the staging helper does not exist.

- [ ] **Step 3: Implement whitelist staging and integrity checks**

The helper recreates only `data/sqlite`, `data/txt`, and empty `data/chat`; copies the five named databases; copies only top-level `*.txt` and `*.md`; runs `PRAGMA integrity_check` on every staged database; verifies the exact database name set; and rejects forbidden files.

- [ ] **Step 4: Run the staging test and verify GREEN**

Run: `zsh desktop/scripts/stage-runtime-data_test.sh`

Expected: PASS.

- [ ] **Step 5: Integrate staging before signing**

In `package-local-dmg.sh`, copy the Wails app, call the helper with the configured academic-data source, then sign. After mounting, call the same verifier against the mounted app before copying the DMG to `dist` and Desktop.

Replace `desktop/package_dmg.sh` with a compatibility wrapper that executes `scripts/package-local-dmg.sh`, avoiding its current absolute source path and broad `rsync`.

- [ ] **Step 6: Re-run the staging test**

Run: `zsh desktop/scripts/stage-runtime-data_test.sh`

Expected: PASS.

### Task 4: Strengthen the agent contract against unsupported guesses

**Files:**
- Modify: `internal/campus/native/tools.go`
- Modify: `internal/campus/native/tools_test.go`

**Interfaces:**
- Produces: system-prompt rules for human-readable term conversion and evidence failure behavior.

- [ ] **Step 1: Write a failing prompt-contract test**

Assert `SystemPromptAddon` tells the agent that ambiguous Summer terms require clarification and that failed/empty campus queries never justify invented campus facts.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `go test ./internal/campus/native -run 'TestSystemPromptRejectsUnsupportedCampusGuesses'`

Expected: FAIL because the explicit wording is absent.

- [ ] **Step 3: Add the minimal prompt rules**

Add two concise bullets under Tool planning / Safety and evidence. Do not expose implementation details or term suffix tables in the prompt; the tool performs conversion.

- [ ] **Step 4: Run native campus tests**

Run: `go test ./internal/campus/native`

Expected: PASS.

### Task 5: Build and audit the distributable DMG

**Files:**
- Output: `dist/PathfinderUCD-darwin-arm64.dmg`
- Output: `/Users/richis/Desktop/PathfinderUCD.dmg`

**Interfaces:**
- Consumes: the Wails app build and allowlisted academic source data.
- Produces: signed arm64 application DMG with clean academic resources and empty chat state.

- [ ] **Step 1: Run focused backend and packaging tests**

Run:

```bash
go test ./internal/campus/native ./internal/campus/tools
zsh desktop/scripts/stage-runtime-data_test.sh
```

Expected: PASS.

- [ ] **Step 2: Run the frontend regression suite**

Run: `pnpm --dir desktop/frontend test`

Expected: PASS with zero failures.

- [ ] **Step 3: Build the Wails application**

Run: `wails build -platform darwin/arm64 -clean` from `desktop` using the configured workspace toolchain.

Expected: `desktop/build/bin/pathfinder-ucd.app` exists and contains an arm64 executable.

- [ ] **Step 4: Build the DMG with the allowlisted data source**

Run: `PATHFINDER_DATA_SOURCE="$PWD/desktop/PathfinderUCD.app/Contents/Resources/data" zsh desktop/scripts/package-local-dmg.sh`

Expected: exit 0, signature verification succeeds, and the script prints the DMG SHA-256.

- [ ] **Step 5: Independently mount and inspect the final DMG**

Mount `dist/PathfinderUCD-darwin-arm64.dmg`; list the exact `data/sqlite` files; run SQLite integrity checks; assert `data/chat` is empty; search for forbidden names; verify `codesign --deep --strict`; and confirm the executable is arm64.

- [ ] **Step 6: Verify fresh chat state outside the bundle**

Using an isolated `PATHFINDER_APP_DATA_DIR`, open the campus store and assert the initial thread and message counts are zero. Do not delete or modify the user's existing Application Support database.

- [ ] **Step 7: Review the diff against every design requirement**

Run: `git diff --check` and inspect `git status --short`, preserving all unrelated pre-existing worktree changes.
