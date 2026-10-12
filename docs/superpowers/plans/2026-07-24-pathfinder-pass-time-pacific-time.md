# Pathfinder Pass Time and Pacific Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read UC Davis Schedule Builder Pass 1 and Pass 2 appointments into consented agent evidence and add a reliable online-first Pacific time conversion tool.

**Architecture:** The extension extracts only bounded pass-time fields from the authenticated Schedule Builder DOM or audited script assignments and includes them in existing personal evidence. A new read-only Go native tool validates instants and DST edge cases locally, calls OpenTimezone for explicit conversions, falls back to bundled IANA data, and always renders `America/Los_Angeles`.

**Tech Stack:** TypeScript 6, Chrome Manifest V3, Vitest, Go `time`/`time/tzdata`, `net/http`, Pathfinder native tool interfaces, OpenTimezone HTTPS API.

## Global Constraints

- Personal evidence remains memory-only and behind existing per-conversation consent.
- Never return page HTML, PIDM, student ID, names, email, cookies, or credentials.
- Use `America/Los_Angeles`; never infer Pacific time from the device timezone.
- OpenTimezone requests contain only a datetime and source/target IANA zones.
- Network conversion must have a short timeout, bounded body, strict validation, and local IANA fallback.
- Present but unparseable pass text fails closed with `SITE_VERSION_UNSUPPORTED`.
- `holds` remains unsupported.

---

### Task 1: Parse and normalize Schedule Builder pass times

**Files:**
- Modify: `extensions/pathfinder-schedule-bridge/tests/personal-schedule-provider.test.ts`
- Modify: `extensions/pathfinder-schedule-bridge/src/content/personal-schedule-provider.ts`

**Interfaces:**
- Produces: `PersonalPassTime` and optional `PersonalScheduleEvidence.passTimes`.
- Consumes: `queryPersonalScheduleInPage(term, categories)` and the page's `#PassTime1`/`#PassTime2` text.

- [ ] **Step 1: Write failing DOM, script-fallback, category, privacy, and malformed-text tests**

Add fixtures exposing:

```ts
querySelector(selector: string) {
  return selector === "#PassTime1"
    ? { textContent: "Pass 1: May 18, 2026 09:30 AM" }
    : selector === "#PassTime2"
      ? { textContent: "Pass 2: Aug 20, 2026 02:00 PM" }
      : null;
}
```

Assert exact `localDateTime`, RFC3339 `instant`, `PDT`, `-07:00`, no `passTimes` without `pass_times`, script fallback behavior, and a thrown `SITE_VERSION_UNSUPPORTED` for `Pass 1: someday`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd extensions/pathfinder-schedule-bridge
pnpm test -- personal-schedule-provider.test.ts
```

Expected: failures because `passTimes` is not defined.

- [ ] **Step 3: Implement bounded extraction and Pacific normalization**

Add:

```ts
export interface PersonalPassTime {
  pass: 1 | 2;
  sourceText: string;
  localDateTime: string;
  instant: string;
  timeZone: "America/Los_Angeles";
  abbreviation: "PST" | "PDT";
  utcOffset: string;
}
```

Read only `textContent.slice(0, 200)` from the two audited selectors; if absent, match only the audited `PassTime1`/`PassTime2` script assignments. Parse the exact English month/day/year/12-hour clock grammar. Derive and verify the Pacific offset with `Intl.DateTimeFormat(..., { timeZone: "America/Los_Angeles", timeZoneName: "shortOffset" })`, then return `passTimes` only when requested.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2. Expected: all personal-provider tests pass.

- [ ] **Step 5: Commit the parser**

```bash
git add extensions/pathfinder-schedule-bridge/src/content/personal-schedule-provider.ts \
  extensions/pathfinder-schedule-bridge/tests/personal-schedule-provider.test.ts
git commit -m "feat: parse Schedule Builder pass times"
```

### Task 2: Carry pass times through bridge requests

**Files:**
- Modify: `extensions/pathfinder-schedule-bridge/tests/request-service.test.ts`
- Modify: `extensions/pathfinder-schedule-bridge/src/background/request-handler.ts`
- Modify: `internal/campus/native/live_schedule_tool_test.go`
- Modify: `internal/campus/native/live_schedule_tool.go`

**Interfaces:**
- Consumes: optional `PersonalScheduleEvidence.passTimes`.
- Produces: `schedule.personal` support for `pass_times`; desktop personal request categories `schedule,waitlist,pass_times`.

- [ ] **Step 1: Write failing bridge and native-tool tests**

Assert:

```ts
params: { term: "202610", categories: ["pass_times"] }
```

returns `OK` and pass evidence, while public searches with personal context call `readPersonal(term, ["schedule", "waitlist", "pass_times"])`. Update the Go assertion to require:

```go
strings.Join(client.personalRequest.Categories, ",") == "schedule,waitlist,pass_times"
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cd extensions/pathfinder-schedule-bridge
pnpm test -- request-service.test.ts
cd ../..
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/campus/native -run 'LiveSchedule'
```

Expected: extension rejects `pass_times`; Go omits the category.

- [ ] **Step 3: Implement category propagation**

Allow `pass_times` in the request handler's supported set, add it to personal evidence requested by search, and change Go personal categories to:

```go
[]string{"schedule", "waitlist", "pass_times"}
```

Update tool descriptions/schema text to mention Pass 1 and Pass 2.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run Step 2 commands. Expected: all selected tests pass.

- [ ] **Step 5: Commit bridge propagation**

```bash
git add extensions/pathfinder-schedule-bridge/src/background/request-handler.ts \
  extensions/pathfinder-schedule-bridge/tests/request-service.test.ts \
  internal/campus/native/live_schedule_tool.go \
  internal/campus/native/live_schedule_tool_test.go
git commit -m "feat: expose pass times to live schedule tool"
```

### Task 3: Build the online-first Pacific time tool

**Files:**
- Create: `internal/campus/native/pacific_time_tool.go`
- Create: `internal/campus/native/pacific_time_tool_test.go`
- Modify: `internal/campus/native/tools.go`
- Modify: `internal/campus/native/tools_test.go`

**Interfaces:**
- Produces: `newPacificTimeTool(client, clock)`, native tool name `convert_pacific_time`.
- Input: optional `date_time` and `source_time_zone`.
- Output: `instant`, `pacific_time`, `time_zone`, `abbreviation`, `utc_offset`, `display`, `conversion_source`.

- [ ] **Step 1: Write deterministic failing tests**

Cover no-argument current PDT time with an injected clock, RFC3339 conversion and date rollover, source-zone local conversion, winter PST, invalid IANA zone, missing source zone, DST gap (`2026-03-08T02:30:00` in Los Angeles), DST overlap (`2026-11-01T01:30:00`), successful fake OpenTimezone response, transport/invalid-response fallback, unknown JSON fields, read-only/plan-safe flags, and registration in `Tools`/`DataToolNames`.

- [ ] **Step 2: Run the native tests and verify RED**

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/campus/native -run 'Pacific|Tool'
```

Expected: compile failure because the new tool does not exist.

- [ ] **Step 3: Implement local parsing, ambiguity checks, and formatting**

Use `_ "time/tzdata"` and `time.LoadLocation("America/Los_Angeles")`. Parse RFC3339 directly. For offset-less local input, enumerate distinct zone offsets around the candidate and accept exactly one UTC instant whose projected wall components match; return explicit errors for zero or multiple matches. Format offsets from `Zone()` rather than hardcoding `-07:00`/`-08:00`.

- [ ] **Step 4: Implement the bounded OpenTimezone client and fallback**

POST:

```json
{
  "dateTime": "2026-08-20T18:00:00",
  "fromTimezone": "UTC",
  "toTimezone": "America/Los_Angeles"
}
```

to `https://api.opentimezone.com/convert` using a two-second `http.Client`, `Content-Type: application/json`, `io.LimitReader` capped at 16 KiB, status validation, and strict JSON decoding of only `dateTime`. Validate the remote wall time against local IANA conversion before labeling it `opentimezone`; otherwise return the local result with `local_iana_fallback`.

- [ ] **Step 5: Register the tool**

Always append `newPacificTimeTool(defaultOpenTimezoneClient(), time.Now)` in `Tools`, include `convert_pacific_time` in `DataToolNames`, and test valid JSON schema plus read-only/plan-safe flags.

- [ ] **Step 6: Run native tests and verify GREEN**

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/campus/native
```

Expected: package passes.

- [ ] **Step 7: Commit the tool**

```bash
git add internal/campus/native/pacific_time_tool.go \
  internal/campus/native/pacific_time_tool_test.go \
  internal/campus/native/tools.go \
  internal/campus/native/tools_test.go
git commit -m "feat: add Pacific time conversion tool"
```

### Task 4: Teach the academic agent when to use the new evidence

**Files:**
- Modify: `internal/campus/native/tools.go`
- Modify: `internal/campus/native/tools_test.go`

**Interfaces:**
- Consumes: `query_live_schedule` pass-time evidence and `convert_pacific_time`.
- Produces: prompt rules preventing mental timezone arithmetic and confusion between pass times and deadlines.

- [ ] **Step 1: Add failing prompt-contract assertions**

Require prompt text containing `Pass 1`, `Pass 2`, `convert_pacific_time`, `America/Los_Angeles`, `PST or PDT`, and a distinction between pass appointments and registration deadlines.

- [ ] **Step 2: Run the prompt test and verify RED**

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/campus/native -run SystemPrompt
```

Expected: missing-string assertions fail.

- [ ] **Step 3: Add concise tool-planning guidance**

Tell the agent to retrieve pass appointments through consented `query_live_schedule`, use `convert_pacific_time` for current/advising/Zoom conversions, preserve the returned instant, and never do offset arithmetic mentally.

- [ ] **Step 4: Run prompt and package tests and verify GREEN**

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/campus/native
```

Expected: package passes.

- [ ] **Step 5: Commit prompt guidance**

```bash
git add internal/campus/native/tools.go internal/campus/native/tools_test.go
git commit -m "feat: guide agent on pass and Pacific times"
```

### Task 5: Version, verify, deploy, and package

**Files:**
- Modify: `extensions/pathfinder-schedule-bridge/package.json`
- Modify: `extensions/pathfinder-schedule-bridge/manifest.json`
- Generated: `extensions/pathfinder-schedule-bridge/dist/**`
- Generated: `dist/PathfinderUCD-darwin-arm64.dmg`

**Interfaces:**
- Produces: extension `0.3.0` deployed to `/Users/richis/PathfinderScheduleBridge` and a rebuilt desktop DMG.

- [ ] **Step 1: Bump extension version to `0.3.0`**

Set the same version in `package.json` and `manifest.json`.

- [ ] **Step 2: Run complete extension verification**

```bash
cd extensions/pathfinder-schedule-bridge
pnpm verify
```

Expected: typecheck, every Vitest test, and Vite production build pass.

- [ ] **Step 3: Run Go and frontend verification**

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/campus/native ./internal/campus/livebridge/...
cd desktop/frontend
pnpm test
pnpm build
```

Expected: selected Go packages and frontend checks pass; record any pre-existing unrelated failures without overwriting user work.

- [ ] **Step 4: Deploy the extension**

Copy the verified `dist` contents to `/Users/richis/PathfinderScheduleBridge`, preserving no stale build files, then compare sorted file hashes between source dist and deployed directory.

- [ ] **Step 5: Build and package desktop**

Use the repository's existing Wails/package scripts:

```bash
cd desktop
/Users/richis/go/bin/wails build -platform darwin/arm64 -clean
./scripts/package-local-dmg.sh
```

Verify the staged/mounted app signature and record the DMG SHA-256.

- [ ] **Step 6: Run final focused regression checks**

Execute the parser against `/Users/richis/Downloads/Schedule Builder.html` and assert ECS 189G CRN `47525`, Pass 1, and Pass 2 are present without identity data. Re-run native Pacific-time tests and one live OpenTimezone request with non-personal sample data.

- [ ] **Step 7: Commit only source/version changes**

```bash
git add extensions/pathfinder-schedule-bridge/package.json \
  extensions/pathfinder-schedule-bridge/manifest.json
git commit -m "chore: release schedule bridge 0.3.0"
```

Do not stage unrelated dirty-worktree files or generated application bundles.
