# Pathfinder UCD for DeepSeek Harness

**English** | [简体中文](README.zh-CN.md)

A native **TypeScript** plugin built with Harness's Cordis lifecycle and `defineTool` contracts. All campus data comes from the read-only [CourseScope JSON API](https://rmp.richis.top). The plugin does not read local campus databases or fall back to local snapshots.

Pathfinder helps students clarify their goals, research instructors and courses, compare degree-specific major-change requirements, and keep evidence-backed artifacts visible as the conversation develops. **Schedule import, accounts and forums are outside its scope.**

Plugin version: **0.2.3**. Tested with Harness **0.2.0-rc.2**. Dependencies are pinned in `package-lock.json`; the API contract was checked on **2026-10-14**.

## Install and run

Requirements: **Node.js 24+**, a working Harness model configuration, and network access to `https://rmp.richis.top`. No Go installation, Pathfinder desktop app or campus data directory is required.

```sh
git clone https://github.com/richisblog/Pathfinder-UCD-Agent.git
cd Pathfinder-UCD-Agent
npm ci
npm run build
npm run prepare-overlay
npx @deepseek-ai/dsh@0.2.0-rc.2 web --patch "$PWD/cordis.local.yml"
```

For an existing Harness installation, add the plugin node to its Cordis overlay:

```yaml
- insert:
    - id: pathfinder-ucd
      name: '/absolute/path/Pathfinder-UCD-Agent/dist/host.js'
      config:
        timeoutMs: 30000
```

Use an absolute entry path. The request timeout defaults to 30 seconds; `timeoutMs` accepts 100–120000 milliseconds. Restart Harness after building or changing the Host plugin. Keep existing model and other plugin settings when editing the overlay. The former `dataRoot` and `PATHFINDER_DATA_ROOT` settings are no longer used.

Historical conversations retain their artifacts and original sources. A new API request does not automatically make historical evidence current.

## English, Chinese and bounded overview scrolling

The workbench offers **English**, **中文**, and **Follow Harness** in its language selector. The preference is stored in the current browser. Fixed labels, statuses, tool names, evidence summaries and visualization inspection controls support both languages. English is the fallback when no supported interface language is known; follow mode responds to Harness language changes.

The entire upper overview—title, research question and progress—is capped at **320 px or 40% of the panel height, whichever is smaller**. Overflow scrolls independently, including when focused for keyboard navigation. The artifact tabs, main content and footer remain outside this region; the artifact body has its own scroll area.

Changing the interface language preserves student statements, original policy text and saved agent artifacts. New replies, artifact text and chart labels honor the student's requested language, or otherwise match the student's message. Ask the agent to use English when English artifacts are needed. Original sources and inspectable data are not silently translated or rewritten.

## Campus tools

Eleven GET tools correspond directly to the [OpenAPI contract](https://rmp.richis.top/openapi.json). Two additional tools manage student clarification and consultation artifacts.

| Tool                                     | Purpose                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `pathfinder_search`                      | Resolve English or Chinese course/instructor names to course keys and numeric professor IDs |
| `pathfinder_get_course`                  | Course information and linked lookup entry points                                           |
| `pathfinder_get_course_professors`       | Filter and rank linked instructors with course-specific statistics                          |
| `pathfinder_get_professor`               | Instructor identity and historical metrics across courses                                   |
| `pathfinder_get_professor_courses`       | Linked courses and their review statistics                                                  |
| `pathfinder_get_professor_reviews`       | Full reviews, scoped by course, dates, confidence and cursor                                |
| `pathfinder_search_review_comments`      | FTS5 keyword/phrase search using repeated `term` values and `any`/`all` matching            |
| `pathfinder_get_professor_course_stats`  | Deduplicated course/instructor statistics, distributions and descriptive trends             |
| `pathfinder_get_official_catalog_course` | Official course title, units, prerequisites and GE snapshot                                 |
| `pathfinder_search_major_requirements`   | Resolve official English major names, OASIS codes and colleges                              |
| `pathfinder_get_major_requirements`      | Original degree-specific AB/BS major-change messages                                        |
| `pathfinder_assess_request`              | Assess decision-critical context and ask one native student question when needed            |
| `pathfinder_update_consultation`         | Atomically publish changed artifact sections or acknowledge reviewed sections               |

Examples: “Compare Ty Feng's ECS 20 and ECS 140A reviews, including sample sizes and sources.” “Check MAT21C units, prerequisites and GE.” “Compare Mathematics AB and BS major-change conditions, preserving the original alternatives.”

The former local tools are retired. There is no arbitrary SQL, file-read or arbitrary-URL tool. The API currently has no academic-calendar, general degree-curriculum or policy-text endpoint; Pathfinder states this boundary instead of filling gaps from local files.

Reviewed instructions from the [AI guide](https://rmp.richis.top/ai-guide?lang=en), [agent prompt](https://rmp.richis.top/ai-prompt.txt?lang=en) and [major guide](https://rmp.richis.top/major-guide.txt) are contributed through a native system-prompt section. The website's global-memory directive is not installed; the instructions apply to this plugin.

## Live consultation workbench

The conversation header opens a native Harness right-side tab. It opens automatically when plans or query evidence appear, and supports Harness's panel layout modes.

- **Plan:** steps, completion counts, current action, blockers and supporting evidence.
- **Findings:** evidence-supported statements versus tentative interpretations, with traceable sources.
- **Follow-ups:** possible next questions and reasons. “Add to draft” fills and focuses the composer without sending.
- **Uncertainties:** unresolved claims, missing conditions, verification actions and resolution status.

Host session projections update on new student messages and tool outcomes. The Client subscribes with Harness's `useProjection`; no manual refresh is needed. Each section tracks the observation it has reviewed. Pending updates are explicitly marked while previous content stays available.

The agent publishes a plan before campus research and synchronizes stale sections before another query. A final answer with unfinished artifact updates receives at most two repair requests. Synchronization denials do not count as query evidence or increase evidence epochs. Successful queries attach a native deferred context explaining how to publish the next update. Actual API errors and cancellations remain visible. General conversation does not trigger campus-research repair.

`pathfinder_update_consultation` supports partial updates. `reviewed_sections` acknowledges reviewed but unchanged content without copying it; optional `base_revision` rejects stale writes. Artifacts, visualizations and sources persist in Harness session logs and replay across history and branches. Sessions remain isolated, and evidence still referenced by an artifact is retained beyond the recent-query window.

## Clarify before researching

`pathfinder_assess_request` separates stated student facts from decision-critical gaps. `needs_input` uses native `userQuestions.ask` to display **one question and wait for a real answer**. `ready` records that the scoped next step has enough context. Student replies are explicitly self-reported evidence, separate from official sources. Each answer must be reassessed; another focused question can follow without requiring a complete student profile.

Vague personal requests such as “What should I take next term? Something useful but not too hard” are guarded before course queries. A generic undergraduate assumption cannot bypass the intake check. The workbench shows a waiting state while a question is open. Direct course-title, unit or prerequisite lookups do not require personal context.

If the native question service is absent, this tool is not registered and vague recommendations remain guarded; the agent should ask in the conversation. Sidebar follow-ups are optional research suggestions, not a replacement for blocking clarification. Semantic gap assessment remains the agent's responsibility; the fallback rules do not recognize every possible phrasing.

## Agent-selected visualizations

Each section can independently choose a visualization or retain its native list.

| Form     | Input and interaction                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| ECharts  | JSON `option` for bar, line, pie, Sankey, graph, radar, map and other charts; configured tooltips, legends and zoom |
| HTML/SVG | Custom structures, flows, annotations, tables and cards; optional click/filter scripts                              |
| Canvas   | Declared data and a drawing script for custom interactive demonstrations                                            |

ECharts is bundled locally, without a CDN. Data, axes, labels and configuration can be inspected. Options must be JSON, without function callbacks. Graphs use explicit coordinates or circular layouts; maps embed GeoJSON. Scripts cannot directly use random drawing; interactions should compute from declared data.

HTML/SVG/Canvas run in isolated `allow-scripts` frames. Scripts can read `PATHFINDER_DATA` and `PATHFINDER_THEME` and operate their own frame, without access to the Host DOM, accounts or network. Controls, fonts and themes use Harness primitives and tokens. Charts update with `setOption`, resize with their container and dispose on unmount.

Each visualization records its origin (`evidence`, `artifacts` or `scenario`), rationale and references. Scenarios require explicit assumptions; evidence-based charts require successful, nonempty observations. The underlying text and source explanations remain visible.

## Retrieval and evidence rules

- Requests use the fixed `https://rmp.richis.top/api/v1/` origin and GET only, omit credentials and reject redirects. Harness parameter validation is followed by endpoint, range, date and identifier checks.
- Original API payloads remain in `data`. `source.api_url` is the exact request URL; `requested_at` is the HTTP request timestamp, not collection or policy-effective time. Inspect `fetched_at`/`as_of` for snapshot timing. CourseScope is independent of UC Davis and RMP.
- Full `comment`, `course_raw` and inferred-link confidence are preserved. Course comparisons use `course_stats.overall.rating_mean` and `rating_n`, not the professor's across-course mean. Recent review activity does not establish current teaching; self-reported grades are not registrar distributions.
- FTS5 searches literal tokens/phrases, not semantics; read full comments to determine polarity. Explain small samples and self-selection bias. Trends and intervals do not establish causality or representativeness.
- Lists accept at most 100 items. Preserve `next_cursor` and continue only when needed, with identical filters. There are no automatic retries or pagination. Endpoints without cursor contracts are not assumed to paginate.
- AB and BS remain separate records. `not_displayed` means unavailable text, not unrestricted eligibility. Preserve AND/OR, grades, GPA, planning and advising conditions. Option names are not independently verified option requirements; form context and catalog year can affect messages. Incomplete records cannot guarantee eligibility or admission.
- HTTP/network errors, timeouts, non-JSON and responses above 8 MiB fail explicitly, without local fallback. Narrow the query or limit for large responses; accepted text is not silently truncated.

## Lifecycle and verification

Tools register through `ctx.tools.register(defineTool(...))` and are removed on Cordis disposal. Asynchronous native `fetch` keeps the Host responsive. Cancellation, timeout and plugin disposal abort pending requests; disposal waits for them to settle. SQLite and Worker threads are not required.

```sh
npm test
npm run format:check
npm run test:live
```

Regression checks cover native Harness execution, all API routes, repeated keywords/cursors, validation, empty evidence, errors, timeout/cancellation/disposal, student-question waits, synchronization control, replay/session isolation, bilingual controls and visualization behavior. `test:live` exercises all eleven API tools and Mathematics AB/BS separately, writing `live-api-verification.json` without full review text or account information. It is optional and not run by normal CI.

The visualization layer has been checked in model-driven desktop conversations. The website version has also completed a MAT21C desktop lookup with actual API URL, `fetched_at` and all four sections synchronized. These checks do not guarantee every model will select optimal questions or updates.

## Source map

| File                           | Responsibility                                                 |
| ------------------------------ | -------------------------------------------------------------- |
| `src/host.ts`                  | Host configuration, registration and request lifecycle         |
| `src/api-contract.ts`          | Reviewed GET endpoint and parameter contracts                  |
| `src/runtime.ts`               | Validation, HTTP, provenance, cancellation and response limits |
| `src/protocol.ts`              | Reviewed CourseScope agent instructions                        |
| `src/intake.ts`                | Native student clarification and context assessment            |
| `src/progress.ts`              | Live context, execution guards and artifact publication        |
| `src/consultation.ts`          | Session projection, evidence validation and section revisions  |
| `src/client/Workbench.tsx`     | Native sidebar and bounded overview layout                     |
| `src/client/i18n.ts`           | English/Chinese interface state and translations               |
| `src/client/Visualization.tsx` | ECharts and isolated HTML/SVG/Canvas rendering                 |
| `src/visualization.ts`         | Visualization validation, determinism and provenance           |
| `src/prepare-overlay.ts`       | Standalone overlay generation                                  |

## Migration and licenses

The Harness plugin replaces the former Reasonix Go/Wails application from v0.2.2 onward. See [migration notes](docs/MIGRATION.md) ([中文](docs/MIGRATION.zh-CN.md)). Historical code and releases remain available; old DMGs do not contain the new Harness features.

Plugin source is MIT-licensed. ECharts and zrender notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Harness references: [plugin development](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md), [tool definitions](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/tool.md), [tool contracts](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md).
