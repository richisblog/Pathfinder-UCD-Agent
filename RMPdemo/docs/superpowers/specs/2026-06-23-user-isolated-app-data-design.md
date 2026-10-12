# User-Isolated App Data Design

Date: 2026-06-23

## Goal

Pathfinder UCD must bind Google-authenticated UC Davis users, saved student profiles, chat threads, chat messages, and tool traces to the signed-in user. Different users must never see or mutate each other's profile or chat data. The prompt/tool/database contract must also be explicit enough that future changes do not drift out of sync.

Users must be able to sign in with the same UC Davis email on different devices and see their own previous chat threads and messages. Chat history must be durable server-side data, not browser-local data.

Users must also be able to choose whether to use the platform default LLM provider or their own provider/API key. Platform default usage has a per-user quota no matter which provider the platform uses behind the scenes. User-supplied API keys bypass platform quota because the cost is paid by the user.

## Current State

User identity and student profiles live server-side through `UserProfileService`. The target private application database is `data/sqlite/app.db`; older local `users.db` files are legacy-only. A Google login callback upserts `users`, stores `user_id` in the Flask session, and `student_profiles` are keyed by `user_id`.

Chat history must be user-isolated server-side. The chat UI may keep only the active thread id in browser `localStorage`; thread metadata and messages belong in `app.db`.

The academic data databases remain public, read-only source databases:

- `rmp.db`
- `courses.db`
- `majors.db`
- `changemajor.db`
- `ucdavis_calendar.db`
- local AP/IB/placement text files

Those source databases should not contain private user data.

## Recommended Architecture

Create a single private application database at:

```text
data/sqlite/app.db
```

`app.db` owns private application state:

- Google-authenticated users
- student profiles
- chat threads
- chat messages
- tool-call traces
- context snapshots
- user LLM provider settings
- user LLM usage/quota events
- lightweight prompt/tool/schema registry records

Academic source databases remain separate and read-only. This keeps privacy and product data away from scraped/catalog source data.

## App Database Schema

### `users`

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  email_domain TEXT NOT NULL DEFAULT 'ucdavis.edu',
  name TEXT,
  picture TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);
```

Purpose: one row per Google identity. `email` must be a UC Davis email. `google_sub` is the stable Google identity key.

### `student_profiles`

```sql
CREATE TABLE student_profiles (
  user_id INTEGER PRIMARY KEY,
  student_type TEXT,
  current_major TEXT,
  target_major TEXT,
  college TEXT,
  entry_term TEXT,
  entry_year TEXT,
  graduation_year TEXT,
  considering_change_major INTEGER NOT NULL DEFAULT 0,
  ap_ib_summary TEXT,
  placement_summary TEXT,
  course_preferences_json TEXT NOT NULL DEFAULT '{}',
  profile_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Purpose: stable onboarding/settings profile for one user. It is not an official academic record; it is user-provided context.

### `chat_threads`

```sql
CREATE TABLE chat_threads (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_threads_user_updated
ON chat_threads(user_id, archived_at, updated_at DESC);
```

Purpose: server-side chat sessions. Every list/read/update/delete query must include `user_id = current_user.id`.

### `chat_messages`

```sql
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  original_content TEXT,
  token_count INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_messages_thread_user_created
ON chat_messages(thread_id, user_id, created_at ASC);
```

Purpose: durable messages for a user-owned thread. `user_id` is intentionally duplicated so every query can defend against cross-user access even when a `thread_id` is guessed.

`content` is the normalized display text. `original_content` preserves the raw message text when normalization or safety filtering changes it. `created_at` is the authoritative send/receive timestamp shown in the UI. `metadata_json` can store client timezone, provider, model, finish reason, latency, and message source.

### `chat_tool_calls`

```sql
CREATE TABLE chat_tool_calls (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  message_id TEXT,
  user_id INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  result_json TEXT,
  status TEXT NOT NULL CHECK(status IN ('started', 'ok', 'error')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  error TEXT,
  FOREIGN KEY(thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE,
  FOREIGN KEY(message_id) REFERENCES chat_messages(id) ON DELETE SET NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_tool_calls_thread_user_created
ON chat_tool_calls(thread_id, user_id, created_at ASC);
```

Purpose: per-user trace of tool calls made inside a chat. This may duplicate audit-log information, but it gives user-scoped product history without exposing global audit logs.

### `chat_context_snapshots`

```sql
CREATE TABLE chat_context_snapshots (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  profile_json TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  tool_contract_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Purpose: records the saved profile and contract versions used for an answer. This makes later debugging possible without relying on mutable current profile data.

### `user_llm_settings`

```sql
CREATE TABLE user_llm_settings (
  user_id INTEGER PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'platform_default'
    CHECK(mode IN ('platform_default', 'user_provider')),
  provider TEXT NOT NULL DEFAULT 'deepseek',
  display_name TEXT,
  base_url TEXT,
  model TEXT,
  api_key_ciphertext TEXT,
  api_key_last_four TEXT,
  api_key_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Purpose: stores one user's model-provider preference. API keys must never be returned to the browser after save. The UI can show only provider, model, base URL, and `api_key_last_four`.

Security rule: do not store API keys in plaintext. Use application-level encryption with a server-side `APP_ENCRYPTION_KEY` environment variable before writing `api_key_ciphertext`. If `APP_ENCRYPTION_KEY` is missing, the backend must reject attempts to persist user API keys and tell the user/admin to configure encryption first.

Common provider presets shown in the Settings UI:

| Provider | Base URL default | Common model examples |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat`, `deepseek-reasoner` |
| OpenAI / ChatGPT API | `https://api.openai.com/v1` | `gpt-4.1`, `gpt-4.1-mini`, `gpt-4o-mini` |
| OpenRouter | `https://openrouter.ai/api/v1` | user-selected |
| Anthropic-compatible proxy | user-entered | user-selected |
| Custom OpenAI-compatible | user-entered | user-selected |

The app already uses an OpenAI-compatible client. Provider support should start with OpenAI-compatible providers. Native non-compatible providers can be added later through adapters.

### `llm_usage_events`

```sql
CREATE TABLE llm_usage_events (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  thread_id TEXT,
  message_id TEXT,
  provider_mode TEXT NOT NULL CHECK(provider_mode IN ('platform_default', 'user_provider')),
  provider TEXT NOT NULL,
  model TEXT,
  counted_against_platform_quota INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(thread_id) REFERENCES chat_threads(id) ON DELETE SET NULL,
  FOREIGN KEY(message_id) REFERENCES chat_messages(id) ON DELETE SET NULL
);

CREATE INDEX idx_llm_usage_user_created
ON llm_usage_events(user_id, created_at DESC);
```

Purpose: records per-user model usage and supports platform quota enforcement.

Quota rule for platform default provider:

- `platform_default` mode uses the server's configured provider/key. The provider can be DeepSeek, OpenAI, or another OpenAI-compatible provider configured by the operator.
- Each user gets 15 assistant responses per local calendar day by default when they have not saved their own API key.
- Only successful assistant responses count against the daily quota.
- A failed request should not burn quota unless the provider returns billable usage and the app chooses to count it explicitly.
- `user_provider` mode does not count against the platform quota and should allow unlimited chatting from Pathfinder's side, subject only to the user's own provider/key limits.
- The quota window should use a configured timezone, defaulting to `America/Los_Angeles` for UC Davis.

Recommended configuration:

```text
PLATFORM_DAILY_CHAT_LIMIT=15
PLATFORM_QUOTA_TIMEZONE=America/Los_Angeles
APP_ENCRYPTION_KEY=<private encryption key>
```

### `schema_registry`

```sql
CREATE TABLE schema_registry (
  id TEXT PRIMARY KEY,
  db_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL,
  public_description TEXT,
  tool_exposed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(db_name, table_name, field_name)
);
```

Purpose: documents fields that tools and prompts are allowed to reference. This does not replace SQLite source schemas; it is the application-facing contract.

### `tool_registry`

```sql
CREATE TABLE tool_registry (
  name TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  input_schema_json TEXT NOT NULL,
  output_schema_json TEXT NOT NULL DEFAULT '{}',
  source_db TEXT,
  source_tables_json TEXT NOT NULL DEFAULT '[]',
  version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Purpose: records the canonical tool names, input schemas, source tables, and versions. The code-level `TOOLS` list should be generated from or validated against this contract.

### `prompt_registry`

```sql
CREATE TABLE prompt_registry (
  name TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  tool_names_json TEXT NOT NULL DEFAULT '[]',
  schema_refs_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Purpose: records prompt versions and the tool/schema references expected by the prompt. This gives tests a stable place to check prompt-tool-schema consistency.

## User Isolation Rules

1. Authentication is based on Google OAuth and must reject non-`@ucdavis.edu` emails.
2. Session stores only `user_id`; every protected API resolves the current user from `app.db`.
3. A profile row is readable or writable only by its owner.
4. A chat thread is listable, readable, writable, archivable, or deletable only when `thread.user_id == current_user.id`.
5. Messages and tool traces must be queried with both `thread_id` and `user_id`.
6. `thread_id` is never sufficient authorization.
7. Frontend localStorage must not be the source of truth for chat history.
8. Frontend may store only non-sensitive UI state such as the last active thread id.
9. Academic source DB queries remain shared and read-only; their results can be copied into a user's tool trace, but source DB rows are not user-owned.
10. Global audit logs remain server-private and are not exposed to users.
11. User model API keys are private to that user and must not be shown to other users, logs, prompt context, tool traces, or frontend responses.
12. Platform default quota is evaluated per `user_id`, never globally and never by IP alone.

## Backend API Changes

Existing:

- `GET /api/me`
- `GET /api/profile`
- `POST /api/profile`
- `POST /api/chat`
- `POST /api/chat/stream`

New server-side chat APIs:

| API | Method | Auth | Profile | Purpose |
| --- | --- | --- | --- | --- |
| `/api/chat/threads` | GET | yes | yes | List current user's non-archived threads. |
| `/api/chat/threads` | POST | yes | yes | Create a new current-user thread. |
| `/api/chat/threads/<thread_id>` | GET | yes | yes | Read current user's thread metadata. |
| `/api/chat/threads/<thread_id>` | PATCH | yes | yes | Rename, pin, or archive current user's thread. |
| `/api/chat/threads/<thread_id>` | DELETE | yes | yes | Archive or delete current user's thread. |
| `/api/chat/threads/<thread_id>/messages` | GET | yes | yes | Read current user's messages for a thread. |
| `/api/chat/threads/<thread_id>/messages` | POST | yes | yes | Non-stream send inside current-user thread. |
| `/api/chat/threads/<thread_id>/messages/stream` | POST | yes | yes | Stream send inside current-user thread. |
| `/api/settings/llm` | GET | yes | no | Read current user's provider mode/settings, excluding API key. |
| `/api/settings/llm` | POST | yes | no | Save current user's provider mode/settings/API key. |
| `/api/settings/llm/test` | POST | yes | no | Optional provider-key smoke test without saving chat history. |
| `/api/settings/quota` | GET | yes | no | Read current user's remaining platform default quota. |

Compatibility path:

- Keep `/api/chat` and `/api/chat/stream` temporarily.
- Internally, they create or use a current-user default thread.
- Frontend should migrate to thread-specific APIs.

## Frontend Changes

The chat page must stop treating browser localStorage as the source of truth.

New behavior:

1. On `/chat` load, call `GET /api/chat/threads`.
2. If no thread exists, call `POST /api/chat/threads`.
3. When selecting a thread, call `GET /api/chat/threads/<thread_id>/messages`.
4. When sending a message, call `POST /api/chat/threads/<thread_id>/messages/stream`.
5. The left sidebar renders server threads, not localStorage sessions.
6. Deleting a chat calls `DELETE /api/chat/threads/<thread_id>` or archives it.
7. localStorage can keep only `pathfinder.ucd.chat.activeThreadId`, and the server still verifies ownership.
8. Each message rendered in the UI should use the `created_at` timestamp returned by the server.
9. Because thread/message history is server-side, the same user sees the same chat history across devices after Google login.

Settings page behavior:

1. Profile settings remain on `/settings`.
2. Add a model/API section to `/settings`.
3. Users can choose:
   - platform default provider with daily quota
   - OpenAI / ChatGPT API
   - DeepSeek personal API
   - OpenRouter
   - custom OpenAI-compatible endpoint
4. When users save their own key, the frontend posts it once to `/api/settings/llm`.
5. The backend stores only encrypted key material and returns only masked metadata.
6. The chat page can display remaining platform quota only when mode is `platform_default`.
7. If a user saves their own API key, the UI should clearly show that Pathfinder's daily quota no longer applies, while their own provider may still apply billing/rate limits.

## Prompt, Tool, and Schema Contract

The current `LLMChatService` owns:

- `SYSTEM_PROMPT`
- `TOOLS`
- `run_tool()`

The current data services own:

- `RmpQueryService.TABLE_CONFIG`
- `CourseDbQueryService.COURSE_FIELDS`
- `CalendarQueryService` query surface
- `MajorCatalogService`
- `ChangeMajorQueryService`
- `TxtContextService`

To prevent drift:

1. Add a `services/ToolContractService.py` or `services/ToolRegistryService.py`.
2. Register tool metadata from the same structures used by `LLMChatService`.
3. Add tests that compare:
   - every `TOOLS[*].function.name`
   - every `run_tool()` supported name
   - every registry tool name
   - every documented tool name in `docs/TOOL_PROMPT_CONTRACT.md`
4. Register schema fields that are exposed through query tools:
   - RMP fields from `RmpQueryService.TABLE_CONFIG`
   - course fields from `CourseDbQueryService.COURSE_FIELDS`
   - app private fields from `app.db`
5. Prompt text should reference only registered tool names.
6. A prompt version and tool contract version should be attached to each context snapshot.

## Migration Plan

1. Introduce `APP_DB_PATH` in `core/config.py`, defaulting to `data/sqlite/app.db`.
2. Replace `USER_DB_PATH` usage with `APP_DB_PATH`. Keep `USER_DB_PATH` as a temporary alias for backward compatibility only if needed.
3. Expand `UserProfileService` into `AppDataService`, or keep `UserProfileService` and add `ChatHistoryService`.
4. Add `chat_threads`, `chat_messages`, `chat_tool_calls`, and `chat_context_snapshots`.
5. Add `user_llm_settings` and `llm_usage_events`.
6. Add registry tables.
7. Update `/api/me` and profile APIs to use the app database.
8. Add thread APIs.
9. Add LLM settings and quota APIs.
10. Update frontend chat page to use server threads.
11. Update frontend settings page to manage model provider/API key.
12. Update docs:
   - `docs/FRONTEND_API_MAP.md`
   - `docs/DATABASE_CONTRACT.md`
   - `docs/TOOL_PROMPT_CONTRACT.md`
13. Commit locally after privacy scan. Do not push GitHub without explicit approval.

## Tests

Required tests:

1. UC Davis email validation accepts only `@ucdavis.edu`.
2. User A profile cannot be read through User B session.
3. User A chat thread list excludes User B threads.
4. User A cannot read User B thread by guessed `thread_id`.
5. User A cannot read User B messages by guessed `thread_id`.
6. User A cannot archive/delete User B thread.
7. Chat message creation stores `user_id` on thread, message, and tool traces.
8. Chat response receives profile context for the signed-in user only.
9. User A sees their previous server-side chat threads after logging in from a fresh browser session.
10. Message rows preserve content, original content when applicable, role, and `created_at`.
11. Frontend chat page references server-thread APIs and no longer stores message history in localStorage.
12. Platform default quota blocks the 16th successful assistant response for the same user/day when the daily limit is 15 and the user has no saved API key.
13. User-provider mode bypasses platform default quota and does not block on Pathfinder's daily message limit.
14. User API keys are not returned by settings APIs and are not present in logs/tool traces/message content.
15. Tool contract test checks `TOOLS`, `run_tool()`, registry, and docs stay aligned.
16. Schema contract test checks exposed query fields are registered.
17. Privacy scan confirms no app database, source databases, logs, or secrets are tracked by git.

## Acceptance Criteria

The work is complete only when:

1. `app.db` schema exists and owns user/profile/chat/contract tables.
2. All profile and chat APIs enforce session user isolation.
3. Chat history is stored server-side and bound to `user_id`.
4. The frontend reads and writes chat threads through authenticated backend APIs.
5. Different Google users cannot see each other's threads or messages.
6. User profile context used for LLM calls always comes from the signed-in user.
7. Tool calls are recorded with `user_id` and `thread_id`.
8. Chat history survives across browsers/devices for the same Google user.
9. Every message has server-side content, role, and timestamp metadata.
10. Users can choose platform default or their own OpenAI-compatible provider/API key.
11. Platform default usage is limited to 15 successful assistant responses per user per day by default when the user has not saved their own API key.
12. User API keys are encrypted at rest and never returned to the browser after save.
13. Prompt/tool/schema contract docs exist and are covered by tests.
14. Existing academic source databases remain read-only and do not store private user data.
15. Unit tests, compile checks, JS syntax checks, local HTTP route checks, and privacy scans pass.
16. Changes are committed locally, with no GitHub push unless separately approved.
