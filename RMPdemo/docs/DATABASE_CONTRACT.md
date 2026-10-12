# Pathfinder UCD Database Contract

This document explains which database owns which data and how user isolation works.

## Database Boundaries

| Database | Type | Contains private user data? | Purpose |
| --- | --- | --- | --- |
| `data/sqlite/app.db` | Application database | Yes | Users, profiles, chat threads, messages, tool traces, LLM settings, quota events, prompt/tool/schema registries. |
| `data/sqlite/rmp.db` | Source database | No | Public RateMyProfessors professor/review/course aggregate data. |
| `data/sqlite/courses.db` | Source database | No | Public UC Davis course catalog facts. |
| `data/sqlite/majors.db` | Source database | No | Public UC Davis major catalog text. |
| `data/sqlite/changemajor.db` | Source database | No | Public change-of-major requirements. |
| `data/sqlite/ucdavis_calendar.db` | Source database | No | Public UC Davis calendar events. |
| `data/txt/*.txt` | Source documents | No | AP/IB/math placement/chemistry placement policy excerpts. |

`app.db` must never be committed or pushed to GitHub.

## User-Owned Tables

| Table | Owner key | Isolation rule |
| --- | --- | --- |
| `users` | `id`, `email`, `google_sub` | Google OAuth creates/updates only the signed-in user. |
| `student_profiles` | `user_id` | Read/write only where `user_id = current_user.id`. |
| `chat_threads` | `user_id` | List/read/update/delete only where `user_id = current_user.id`. |
| `chat_messages` | `user_id`, `thread_id` | Read/write only where both `user_id` and `thread_id` match. |
| `chat_tool_calls` | `user_id`, `thread_id` | Trace rows are visible only to the owning user. |
| `user_llm_settings` | `user_id` | Each user has their own provider/API setting. API keys are encrypted and never returned. |
| `llm_usage_events` | `user_id` | Platform quota is counted per user. |

## Chat History Requirements

- Chat history is stored server-side in `chat_threads` and `chat_messages`.
- Users who sign in with the same UC Davis email on another device should see their own previous threads.
- A guessed `thread_id` is not enough to read messages; every query must also match `user_id`.
- Each message stores `role`, `content`, `original_content` when applicable, and `created_at`.
- Frontend localStorage can store only the active thread id, never full message history.

## LLM Settings and Quota

- If `user_llm_settings.mode = platform_default`, the user uses the platform API and is limited by `PLATFORM_DAILY_CHAT_LIMIT`, default 15 successful assistant replies per day.
- If `mode = user_provider`, the user uses their own API key and is not limited by Pathfinder's daily quota.
- User API keys are encrypted with `APP_ENCRYPTION_KEY`.
- API keys are never returned to the frontend after saving. The frontend can show only `api_key_last_four`.

## Contract Registry Tables

| Table | Purpose |
| --- | --- |
| `schema_registry` | Documents DB fields exposed to tools/prompts. |
| `tool_registry` | Documents tool names, input schemas, source DBs, and source tables. |
| `prompt_registry` | Documents prompt versions and the tool names they rely on. |

These tables exist so the prompt, tools, and source schema do not drift apart silently.
