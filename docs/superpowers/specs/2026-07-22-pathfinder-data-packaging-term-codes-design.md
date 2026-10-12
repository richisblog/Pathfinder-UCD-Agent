# Pathfinder Data Packaging and Term Codes Design

## Goal

Ship the academic evidence required by Pathfinder without distributing backups, local user records, or existing chat history, and translate human-readable UC Davis terms into the six-digit codes required by Schedule Builder.

## Packaged academic data

The desktop package uses an explicit allowlist. It includes exactly these SQLite databases because `internal/campus/tools/runner.go` opens them at runtime:

- `rmp.db`
- `courses.db`
- `majors.db`
- `changemajor.db`
- `ucdavis_calendar.db`

The package also includes the current `.txt` and `.md` policy sources used by `search_txt_context`. It never includes `app.db`, `users.db`, `.bak` files, SQLite `-wal` or `-shm` sidecars, `.DS_Store`, or any other unlisted file.

The packaging script copies allowlisted resources into `Contents/Resources/data` before code signing. It fails before producing a DMG if a required database is missing or fails `PRAGMA integrity_check`. After mounting the completed DMG, it verifies the exact database allowlist again and rejects forbidden files.

## Empty user and chat state

Existing user and chat data is never copied into the application bundle. The bundle contains an empty `Contents/Resources/data/chat` directory as an explicit packaging contract, but it contains no database or transcript.

At runtime, Pathfinder continues to create its writable `pathfinder.db` under the per-user macOS application-data directory. A fresh installation therefore starts with zero chat threads and zero chat messages. Academic evidence remains read-only inside the application bundle and is not mixed with user state.

## UC Davis term-code normalization

A term code consists of a four-digit calendar year followed by a two-digit term-type suffix:

| Term type | Suffix | 2026 example |
| --- | --- | --- |
| Winter Quarter | `01` | `202601` |
| Spring Semester | `02` | `202602` |
| Spring Quarter | `03` | `202603` |
| Summer Session 1 | `05` | `202605` |
| Summer Special Session | `06` | `202606` |
| Summer Session 2 | `07` | `202607` |
| Summer Quarter | `08` | `202608` |
| Fall Semester | `09` | `202609` |
| Fall Quarter | `10` | `202610` |

There is no inferred `04` term.

The native `query_live_schedule` tool normalizes its `term` argument before sending the request to the browser bridge:

- A valid six-digit code is accepted unchanged, provided its suffix is one of the supported suffixes above.
- Full English names and abbreviations such as `Fall Quarter 2026`, `Fall Qtr 2026`, `Spring Semester 2026`, and `Sum Ses 2 2026` are converted to their codes.
- Natural English order such as `2026 Fall Quarter` and the existing slug form `2026-fall` are supported. A bare fall, spring, or winter season uses the UC Davis quarter suffix.
- Equivalent Chinese names such as `2026年秋季学期`, `2026 秋季 Quarter`, `2026年夏季第二期`, and explicit semester wording are supported.
- A bare `Summer 2026` or `2026 夏季` is rejected as ambiguous because Summer Session 1, Special Session, Session 2, and Summer Quarter have different codes.
- Unsupported names, unsupported suffixes, and years outside four decimal digits fail with a user-readable validation error before contacting the extension.

The tool schema states that the value may be a six-digit code or a human-readable term. The system prompt tells the agent not to guess ambiguous summer terms.

## Error handling

Missing packaged academic data produces a clear error identifying the absent resource instead of a raw SQLite error 14. Term-normalization errors identify the accepted term forms and do not issue a bridge request. The browser provider retains its six-digit validation as a defense-in-depth check.

## Verification

Automated tests cover each suffix, full names, abbreviations, slugs, Chinese aliases, direct codes, ambiguous summer input, unsupported suffixes, and confirmation that invalid terms never reach the bridge.

Packaging verification mounts the generated DMG and proves that:

1. all five required academic databases exist and pass SQLite integrity checks;
2. no backup, journal, user, or chat database is present;
3. the chat resource directory is empty;
4. policy text files are present; and
5. the application binary is arm64 and its signature verifies.
