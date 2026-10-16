# Migration to native DeepSeek Harness

English | [简体中文](MIGRATION.zh-CN.md)

From v0.2.2, the current Pathfinder UCD implementation is a native TypeScript plugin for DeepSeek Harness.

- Install, build and test from the repository root. Go, Wails and the former Reasonix agent are no longer required.
- Harness owns model execution, conversations, tool dispatch and native question UI. The plugin supplies campus queries, consultation projections and the workbench.
- Campus queries use the read-only CourseScope JSON API at https://rmp.richis.top. Local SQLite/text queries and `dataRoot` configuration are retired.
- Schedule import, accounts and forums are outside scope. Their old extensions and publishing/deployment workflows have been removed from the current branch.
- Old chat data is not automatically imported. Follow the README for a separate Harness installation; do not copy old account data or credentials.
- Prior source remains in Git history and the v0.1.0 tag. The old macOS DMG belongs to the previous architecture.

## Consultation flow

Vague personal request → context assessment → native question and wait → reassess the answer → publish a research plan → API lookup → update changed artifacts → continue or answer.

Student statements remain separate from official evidence. Ask incrementally about decision-critical gaps; factual lookups do not require a complete student profile. Synchronization-control notices add no evidence, while real API failures remain recorded.

## Language and layout in v0.2.3

English is the default README language, with a complete Chinese alternative. The workbench can use English, Chinese or follow Harness, without rewriting original evidence or saved artifacts. New generated content honors the student's language request.

The upper overview has an independent scrollbar and a maximum of 320 px or 40% of panel height. Artifact tabs, body and footer remain outside it.

## Publication boundary

Source releases contain the plugin, tests, licenses and CI. Compiled packages contain Host/Client code and notices, without machine profiles, credentials, chats, schedules or campus databases. ECharts is bundled in the browser module. See THIRD_PARTY_NOTICES.md for third-party licenses.
