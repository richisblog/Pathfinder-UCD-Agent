# Pathfinder Schedule Calendar Export Design

**Date:** 2026-07-24

## Goal

Let a student save a standards-compliant `.ics` file from Pathfinder and drag
it into their calendar application. The file must contain the student's
registered courses, waitlisted courses, Pass 1, and Pass 2 appointments from
the authenticated UC Davis Schedule Builder page.

## Scope

- Reuse the event behavior in `srcparse/generate_calendar.py`:
  recurring weekly meeting events, drop-date events, final-exam events,
  Pacific time, deterministic UIDs, and CRLF output.
- Include registered courses normally and waitlisted courses with the `(WL)`
  prefix exactly as `srcparse` does.
- Add one one-hour event for each available Pass 1 / Pass 2 appointment,
  including the existing 30-minute display alarm.
- Provide an explicit desktop **Save ICS calendar** action in the existing
  consented Schedule Bridge popover. It opens a native save dialog; cancellation
  writes no file.
- Detect the currently open Schedule Builder term directly from the audited
  `termCode` page value, so the student does not type a term.

This change does not create calendar events through Google/Apple/Outlook APIs,
does not persist personal schedule content, and does not send schedule data to
an external service.

## Architecture

### Extension evidence

The extension remains the sole reader of authenticated Schedule Builder page
state. Its personal parser will add the same bounded meeting details consumed
by `srcparse`: type, location, weekdays, `STARTTIME`, and `ENDTIME`; it will
also expose bounded drop-date and final-exam values. It will read `termCode`
from the audited page script or URL when the request uses the `current` term
sentinel. No page HTML, student identifier, email, cookie, or name crosses the
bridge.

### Desktop export

`App.SaveScheduleCalendar(sessionID)` will issue a consent-gated personal
bridge request with `term: "current"` and categories `schedule`, `waitlist`,
and `pass_times`. It decodes only the sanitized evidence, renders it through a
small Go ICS exporter that mirrors `srcparse/generate_calendar.py`, then uses
the existing native `PickExportFile` / `SaveExportFile` path to save
`ucdavis-schedule-<term>.ics`.

The export is initiated only by the student clicking the button. Bridge status
errors are returned unchanged so the interface can direct the student to open
Schedule Builder, pair the extension, or grant consent.

### ICS contract

The calendar contains `VERSION:2.0`, `CALSCALE:GREGORIAN`,
`X-WR-TIMEZONE:America/Los_Angeles`, and CRLF line endings. Course meeting
events use `RRULE:FREQ=WEEKLY;BYDAY=...;UNTIL=...`, a 30-minute display alarm,
and a stable UID derived from summary and start time. Drop dates are all-day,
without an alarm. Final exams are two-hour Pacific events with an alarm. Pass
appointments are one-hour Pacific events titled `UC Davis Pass 1` or `UC Davis
Pass 2`, with the displayed appointment text in `DESCRIPTION` and an alarm.

Malformed meeting dates/times are omitted rather than guessed. A malformed
displayed pass time is already rejected by the extension as
`SITE_VERSION_UNSUPPORTED`.

## UI and errors

The button is visible only when the bridge is connected and the current
conversation has personal-data consent. While saving, it is disabled. A
successful save displays the selected filename; cancellation is silent. No
course names or appointment values are placed in error messages.

## Testing

- TypeScript tests prove current-term extraction and sanitized meeting/date
  fields from the supplied Schedule Builder structure.
- Go exporter tests prove CRLF output; registered, `(WL)`, Pass 1, Pass 2,
  drop-date, final-exam, weekly RRULE, Pacific `TZID`, and absence of identity
  fields.
- Desktop tests prove consent/session propagation, `current` term use, native
  save behavior, cancellation behavior, and non-OK bridge status forwarding.
- Frontend contract tests prove the visible save action calls the new native
  method only after an explicit click.
