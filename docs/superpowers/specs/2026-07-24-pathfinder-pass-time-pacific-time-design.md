# Pathfinder Pass Time and Pacific Time Design

**Date:** 2026-07-24

## Goal

Pathfinder must read the signed-in student's UC Davis registration Pass 1 and
Pass 2 appointments from Schedule Builder and make them available to the
academic agent under the existing per-conversation personal-data consent.
Pathfinder must also provide a general read-only tool for obtaining and
converting exact Pacific time independently of the user's computer timezone.

## Scope

This change includes:

- parsing Pass 1 and Pass 2 from the authenticated Schedule Builder page;
- returning pass times through `query_live_schedule` when personal context is
  requested and consented;
- adding a deterministic `convert_pacific_time` agent tool;
- automatically handling PST/PDT with the IANA
  `America/Los_Angeles` timezone;
- updating agent guidance so pass-time, advising, and Zoom answers use the time
  tool instead of mental timezone arithmetic;
- regression tests based on the observed Schedule Builder structure and
  daylight-saving boundaries.

This change does not include registration writes, calendar-event creation,
Zoom API access, advising-system integration, or persistence of personal
Schedule Builder data.

## Architecture

### Schedule Builder extension

The extension's personal provider remains the only component allowed to inspect
authenticated Schedule Builder page state. It will read the bounded text
content of `#PassTime1` and `#PassTime2`, with a script-text fallback matching
the page's assignments to those elements. It will never return page HTML,
cookies, PIDM, student ID, names, or email addresses.

Pass times are added to the existing personal evidence object:

```ts
interface PersonalPassTime {
  pass: 1 | 2;
  sourceText: string;
  localDateTime: string;
  instant: string;
  timeZone: "America/Los_Angeles";
  abbreviation: "PST" | "PDT";
  utcOffset: string;
}

interface PersonalScheduleEvidence {
  fetchedAt: string;
  term: string;
  courses: PersonalCourse[];
  passTimes?: PersonalPassTime[];
}
```

`localDateTime` is an ISO local wall-clock value without an offset, for example
`2026-05-18T09:30:00`. `instant` is RFC 3339 with the correct historical
Pacific offset. The extension retains the bounded `sourceText` so the agent can
show what Schedule Builder displayed while using normalized fields for
calculation.

The parser accepts the observed English format:

```text
Pass 1: May 18, 2026 09:30 AM
Pass 2: Aug 20, 2026 02:00 PM
```

An absent element means that pass is omitted. A present but unparseable value
causes the request to return `SITE_VERSION_UNSUPPORTED`; it must not silently
return an incomplete or guessed appointment.

### Bridge request behavior

`schedule.personal` already accepts the `pass_times` category. The request
handler will support it instead of rejecting it. It will request only the
categories selected by the caller:

- `schedule` returns registered courses;
- `waitlist` returns waitlisted courses;
- `pass_times` returns Pass 1 and Pass 2;
- `holds` remains unsupported and returns `SITE_VERSION_UNSUPPORTED`.

The desktop tool's personal-only request will ask for `schedule`, `waitlist`,
and `pass_times`. Public course searches that set
`include_personal_context: true` will attach the same personal evidence.

Personal evidence remains memory-only and guarded by the existing
per-conversation consent check.

### Pacific time tool

The desktop agent receives a new read-only, plan-safe native tool named
`convert_pacific_time`.

Input:

```json
{
  "date_time": "2026-08-20T14:00:00-04:00",
  "source_time_zone": "America/New_York"
}
```

Both fields are optional only for the current-time operation:

- no fields: return the current time in `America/Los_Angeles`;
- `date_time` with an RFC 3339 offset or `Z`: convert that instant to Pacific
  time; `source_time_zone` is not required;
- local `date_time` without an offset: `source_time_zone` is required and must
  be a valid IANA timezone;
- `source_time_zone` without `date_time`: invalid request.

Output:

```json
{
  "instant": "2026-08-20T18:00:00Z",
  "pacific_time": "2026-08-20T11:00:00-07:00",
  "time_zone": "America/Los_Angeles",
  "abbreviation": "PDT",
  "utc_offset": "-07:00",
  "display": "August 20, 2026 at 11:00 AM PDT"
}
```

For explicit conversions, the implementation calls the open-source
OpenTimezone `POST https://api.opentimezone.com/convert` endpoint first. The
request contains only `dateTime`, `fromTimezone`, and
`toTimezone: "America/Los_Angeles"`; it never contains schedule or student
data. Calls use HTTPS, a short timeout, a bounded response body, and strict
response validation.

OpenTimezone does not provide a current-clock endpoint. The no-argument
operation therefore reads the device's UTC system clock and converts that
instant with Go's bundled IANA timezone database. Explicit conversions also
use the same local IANA implementation as a fallback when the public endpoint
is unavailable or returns invalid data. The output includes
`conversion_source: "opentimezone"` or
`conversion_source: "local_iana_fallback"` so callers can report provenance
without losing functionality offline.

The implementation never uses the operating system's current timezone for
interpretation or output. For a local time that is skipped or repeated at a
daylight-saving transition, local validation happens before any network call
and returns an explicit ambiguity or nonexistent-time error rather than
choosing silently.

## Agent behavior

The campus system prompt will direct the agent to:

- use `query_live_schedule` with personal context for the student's Pass 1 and
  Pass 2;
- report that Schedule Builder is the source and identify PST or PDT;
- use `convert_pacific_time` for current Pacific time and all advising or Zoom
  timezone conversions;
- never calculate timezone offsets mentally when the tool is available;
- distinguish a pass appointment from a registration deadline or open
  registration period;
- request the smallest recovery action for login, pairing, consent, or browser
  state failures.

The agent may calculate relative phrases such as “in three days” only from the
normalized instant returned by a tool. It must preserve the exact appointment
in the answer.

## Error handling

- Missing Schedule Builder tab: `BROWSER_REQUIRED`.
- Expired university login: `LOGIN_REQUIRED`.
- Missing session consent: `CONSENT_REQUIRED`.
- Pass-time nodes absent: successful personal response with no `passTimes`
  field, allowing the agent to say no appointment was displayed.
- Pass-time text present but unsupported: `SITE_VERSION_UNSUPPORTED` with a
  bounded schema message that excludes the personal value.
- Invalid timezone: tool validation error naming the invalid timezone.
- Offset-less input without a source timezone: tool validation error.
- DST gap or overlap: explicit nonexistent or ambiguous local-time error.

## Testing

Extension tests will cover:

- Pass 1 and Pass 2 extraction from DOM nodes;
- the observed script assignment fallback;
- correct PDT normalization for May and August 2026;
- category filtering so pass times are not returned unless requested;
- rejection of present but unparseable pass-time text;
- proof that page HTML and identity fields do not enter evidence;
- preservation of registered, waitlisted, and opaque-ID course behavior.

Go tests will cover:

- current Pacific time with an injected clock;
- RFC 3339 instant conversion;
- local time conversion from another IANA timezone;
- PST and PDT dates;
- date rollover;
- invalid timezone and missing source timezone;
- DST nonexistent and ambiguous local times;
- successful OpenTimezone conversion, bounded network failure, invalid remote
  responses, and local IANA fallback;
- registration of the new tool as read-only and plan-safe;
- `query_live_schedule` requesting the `pass_times` personal category.

Integration verification will run the extension's complete `pnpm verify`, the
relevant native and desktop Go tests, the Pathfinder frontend checks, a
production desktop build, and deployment to the actual unpacked-extension
directory used by Comet.

## Delivery

The extension version will be incremented and rebuilt. The verified extension
will be copied to `/Users/richis/PathfinderScheduleBridge`, the path currently
loaded by Comet. The desktop application and DMG will be rebuilt and signed.
The user must reload the extension and replace the installed desktop
application before testing the new agent behavior.
