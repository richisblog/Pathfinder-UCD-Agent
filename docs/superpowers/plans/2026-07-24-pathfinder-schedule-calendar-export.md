# Pathfinder Schedule Calendar Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save a drag-and-drop-ready ICS calendar containing registered courses, waitlisted courses, and Pass 1/Pass 2 appointments.

**Architecture:** The extension exposes only the bounded schedule fields used by `srcparse/generate_calendar.py`. A Go exporter mirrors its recurring-meeting, drop-date, final-exam, and Pacific-time rules, then the existing Wails save dialog writes the file after an explicit UI click.

**Tech Stack:** TypeScript, Vitest, Chrome MV3, Go, Wails, IANA time zones.

## Global Constraints

- Reuse `srcparse/generate_calendar.py` semantics; do not upload or retain Schedule Builder HTML.
- Include Registered and Waitlisted courses; prefix waitlisted titles with `(WL)`.
- Include Pass 1 and Pass 2, CRLF output, and `America/Los_Angeles` timed events.
- Save only after an explicit click and selected native file path.
- Preserve unrelated dirty-worktree changes.

---

### Task 1: Calendar evidence fields

**Files:**
- Modify: `extensions/pathfinder-schedule-bridge/src/content/personal-schedule-provider.ts`
- Test: `extensions/pathfinder-schedule-bridge/tests/personal-schedule-provider.test.ts`

**Produces:** meeting start/end date/time plus course drop/final fields from audited `new Date(...)` values.

- [ ] **Step 1: Write failing tests**

Add a CourseDetails fixture containing `STARTTIME`, `ENDTIME`, `DROP_DATE`, and `FINAL_EXAM_STARTDATE`; assert ISO fields and no email/PIDM in serialized evidence.

- [ ] **Step 2: Verify RED**

Run `pnpm exec vitest run tests/personal-schedule-provider.test.ts`; expected failure is missing calendar fields.

- [ ] **Step 3: Implement the smallest parser**

Parse only the audited JS `new Date(year, month - 1, day, hour, minute, second, ms)` form and return bounded ISO fields.

- [ ] **Step 4: Verify GREEN and commit**

Run the Step 2 command, then commit the parser and test with `feat: expose Schedule Builder calendar fields`.

### Task 2: ICS generator

**Files:**
- Create: `desktop/schedule_calendar.go`
- Test: `desktop/schedule_calendar_test.go`

**Produces:** `generateScheduleCalendar(evidence, now) (string, error)`.

- [ ] **Step 1: Write failing tests**

Test CRLF output, calendar headers, Pacific TZID, weekly RRULE, registered and `(WL)` titles, all-day drop date, two-hour final, both pass events, 30-minute alarms, and absent identity data.

- [ ] **Step 2: Verify RED**

Run `/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./desktop -run ScheduleCalendar`; expected compile failure.

- [ ] **Step 3: Implement srcparse-equivalent rendering**

Use the source weekday mapping `M,T,W,R,F,S,U -> MO,TU,WE,TH,FR,SA,SU`, stable UID from summary/start, escaped ICS fields, meeting/final/pass alarms, and no drop-date alarm.

- [ ] **Step 4: Verify GREEN and commit**

Run the Step 2 command, then commit with `feat: generate Schedule Builder ICS calendar`.

### Task 3: Native save operation

**Files:**
- Modify: `desktop/schedule_bridge_app.go`
- Modify: `desktop/app.go`
- Test: `desktop/schedule_bridge_app_test.go`

**Produces:** `App.SaveScheduleCalendar(sessionID string) (string, error)`.

- [ ] **Step 1: Write failing tests**

Assert session consent, `Term: "current"`, categories `schedule,waitlist,pass_times`, native save only after path choice, quiet cancellation, and non-OK bridge forwarding without personal values.

- [ ] **Step 2: Verify RED**

Run `/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./desktop -run 'ScheduleBridge.*Calendar|SaveScheduleCalendar'`; expected missing-method failures.

- [ ] **Step 3: Implement saving**

Decode sanitized evidence, call generator, use existing native save dialog with `ucdavis-schedule-<term>.ics` / `text/calendar`, and return the selected path.

- [ ] **Step 4: Verify GREEN and commit**

Run Step 2 and commit with `feat: save Schedule Builder calendar`.

### Task 4: Explicit save control

**Files:**
- Modify: `desktop/frontend/src/lib/bridge.ts`
- Modify: `desktop/frontend/src/components/ScheduleBridgeStatus.tsx`
- Modify: `desktop/frontend/src/components/ScheduleBridgeBanner.css`
- Test: `desktop/frontend/src/__tests__/schedule-bridge-calendar-export.test.ts`

- [ ] **Step 1: Write failing UI contract**

Assert a consented-only `Save ICS calendar` action calls `app.SaveScheduleCalendar(sessionId)` only when clicked.

- [ ] **Step 2: Verify RED**

Run `cd desktop/frontend && pnpm exec tsx src/__tests__/schedule-bridge-calendar-export.test.ts`; expected missing API/control assertions.

- [ ] **Step 3: Implement the button**

Add calendar icon, busy state, basename-only success text, quiet cancellation, and existing error rendering.

- [ ] **Step 4: Verify GREEN and commit**

Run Step 2 and commit with `feat: add schedule calendar save control`.

### Task 5: Release verification

- [ ] **Step 1: Bump extension package and manifest to `0.3.1`.**
- [ ] **Step 2: Run `pnpm verify`, selected Go tests, frontend tests/build, and real Schedule Builder fixture parsing.**
- [ ] **Step 3: Sync verified extension `dist/` to `/Users/richis/PathfinderScheduleBridge` and compare hashes.**
- [ ] **Step 4: Build Wails, package DMG with `desktop/scripts/package-local-dmg.sh`, verify mounted signature, and commit only version/source changes.**
