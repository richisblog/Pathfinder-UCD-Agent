# Pathfinder UCD Frontend/API Map

This document keeps the frontend pages, buttons, and backend operations aligned.
It is written for product, operations, and engineering handoff.

## Page Overview

| Page | URL | Template | JavaScript | Purpose |
| --- | --- | --- | --- | --- |
| Login | `/login` | `web/templates/login.html` | `web/static/js/login.js` | Starts Google sign-in and redirects already signed-in users. |
| First-time setup | `/onboarding` | `web/templates/onboarding.html` | `web/static/js/onboarding.js` | Collects stable student profile details before chat. |
| Chat | `/chat` | `web/templates/chat.html` | `web/static/js/chat.js` | Main academic advising chat experience. |
| Settings | `/settings` | `web/templates/settings.html` | `web/static/js/settings.js` | Lets users update saved stable profile details. |

Shared frontend modules:

| Module | Responsibility |
| --- | --- |
| `web/static/js/api.js` | API URL helpers, `/api/me`, logout, auth/profile guards, HTML escaping. |
| `web/static/js/profile-form.js` | Reads, validates, populates, and saves the student profile form. |
| `web/static/js/markdown.js` | Renders assistant Markdown in chat bubbles. |

Shared templates and styles:

| File | Responsibility |
| --- | --- |
| `web/templates/partials/profile_form_fields.html` | Shared onboarding/settings profile fields. |
| `web/static/css/base.css` | Site-wide typography, buttons, links, utility classes. |
| `web/static/css/auth.css` | Login page layout. |
| `web/static/css/profile.css` | Onboarding/settings form layout. |
| `web/static/css/chat.css` | Chat page layout and chat-specific controls. |
| `web/static/css/markdown.css` | Assistant answer formatting. |

## Login Page

URL: `/login`

Primary user actions:

| UI element | Frontend behavior | Backend/API | Backend operation |
| --- | --- | --- | --- |
| Continue with Google | Browser navigates to Google login start route. | `GET /auth/google` | Starts Google OAuth through Authlib. |
| Page load | Checks whether user is already signed in. | `GET /api/me` | Reads Flask session and user/profile from `app.db`. |

Redirect rules:

| Condition | Destination |
| --- | --- |
| Not authenticated | Stay on `/login`. |
| Authenticated and profile incomplete | `/onboarding` |
| Authenticated and profile complete | `/chat` |

Backend OAuth callback:

| Route | Behavior |
| --- | --- |
| `GET /auth/google/callback` | Reads Google user info, rejects non-`@ucdavis.edu` emails, upserts user row, stores `user_id` in Flask session, then redirects to `/onboarding` or `/chat`. |

Required environment variables for production Google login:

| Variable | Purpose |
| --- | --- |
| `SECRET_KEY` | Signs Flask session cookies. Must be private. |
| `GOOGLE_CLIENT_ID` | Google OAuth client id. |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret. Must be private. |
| `GOOGLE_ALLOWED_DOMAIN` | Defaults to `ucdavis.edu`. |

## First-Time Setup Page

URL: `/onboarding`

Primary user actions:

| UI element | Frontend behavior | Backend/API | Backend operation |
| --- | --- | --- | --- |
| Page load | Requires signed-in user; loads existing profile if any. | `GET /api/me` | Reads user and profile from `app.db`. |
| Save and start chatting | Validates required fields client-side, then saves profile. | `POST /api/profile` | Sanitizes and upserts `student_profiles` row. |
| Log out | Ends local session. | `POST /auth/logout` | Clears Flask session. |

Minimum required fields:

| Field | Reason |
| --- | --- |
| `student_type` | Gives the agent freshman/transfer/continuing/prospective context. |
| `current_major` or `target_major` | Gives the agent major context without asking every chat. |

Saved profile fields:

| Field | Meaning |
| --- | --- |
| `student_type` | freshman, transfer, continuing, or prospective. |
| `current_major` | Current major if known. |
| `target_major` | Intended/target major if different or undecided. |
| `college` | UC Davis college. |
| `entry_term`, `entry_year` | Entry quarter/year. |
| `graduation_year` | Expected graduation year. |
| `considering_change_major` | Boolean for change-of-major planning. |
| `ap_ib_summary` | User-provided AP/IB/transfer credit summary. |
| `placement_summary` | User-provided math/chemistry/writing placement status. |
| `course_preferences` | Planning priority, max difficulty, target units, professor/schedule style. |

## Chat Page

URL: `/chat`

Primary user actions:

| UI element | Frontend behavior | Backend/API | Backend operation |
| --- | --- | --- | --- |
| Page load | Requires signed-in user with completed profile. | `GET /api/me` | Redirects client to `/login` or `/onboarding` when needed. |
| Send | Streams answer and tool events. | `POST /api/chat/stream` | Validates session/profile, injects saved profile context, calls LLM tool loop. |
| New chat `+` | Creates a server-side chat thread. | `POST /api/chat/threads` | Creates only for current user. |
| Chat history item | Loads a server-side thread. | `GET /api/chat/threads/<thread_id>/messages` | Reads only current user's messages. |
| Delete chat `x` | Archives a server-side thread. | `DELETE /api/chat/threads/<thread_id>` | Archives only current user's thread. |
| Profile | Navigates to profile settings. | `/settings` page | Lets user update saved profile. |
| Log out | Ends local session. | `POST /auth/logout` | Clears Flask session. |

Backend chat behavior:

| Requirement | Implementation |
| --- | --- |
| Must be signed in | `/api/chat` and `/api/chat/stream` return `401` if no Flask session user. |
| Must have completed profile | Chat APIs return `428` when profile is missing/incomplete. |
| Saved profile is used every chat | `UserProfileService.profile_context_for_user()` creates a system context string passed to `LLMChatService`. |
| Profile is treated as user-provided context | The context tells the model it is not an official record and should be checked against tools when relevant. |

## Settings Page

URL: `/settings`

Primary user actions:

| UI element | Frontend behavior | Backend/API | Backend operation |
| --- | --- | --- | --- |
| Page load | Requires signed-in user; loads profile into form. | `GET /api/me` | Reads user and profile from `app.db`. |
| Save changes | Saves updated profile and returns to chat. | `POST /api/profile` | Sanitizes and upserts `student_profiles` row. |
| Back to chat | Navigates to chat. | `/chat` page | Chat page checks auth/profile again. |
| Log out | Ends local session. | `POST /auth/logout` | Clears Flask session. |

## Backend API Summary

| API | Method | Auth required | Profile required | Used by |
| --- | --- | --- | --- | --- |
| `/api/me` | GET | No | No | Login, onboarding, chat, settings |
| `/api/profile` | GET | Yes | No | Reserved for direct profile reads |
| `/api/profile` | POST | Yes | No | Onboarding, settings |
| `/api/chat` | POST | Yes | Yes | Non-stream chat clients |
| `/api/chat/stream` | POST | Yes | Yes | Chat page |
| `/api/chat/threads` | GET | Yes | Yes | List current user's chat threads |
| `/api/chat/threads` | POST | Yes | Yes | Create current user's chat thread |
| `/api/chat/threads/<thread_id>/messages` | GET | Yes | Yes | Read current user's thread messages |
| `/api/chat/threads/<thread_id>/messages/stream` | POST | Yes | Yes | Send message in current user's thread |
| `/api/settings/llm` | GET | Yes | No | Read model/API settings without API key |
| `/api/settings/llm` | POST | Yes | No | Save model/API settings and optional API key |
| `/api/settings/quota` | GET | Yes | No | Read platform quota status |
| `/auth/google` | GET | No | No | Login page |
| `/auth/google/callback` | GET | No | No | Google OAuth redirect |
| `/auth/logout` | POST | Yes/No | No | Onboarding, chat, settings |

## Data Storage

User account, profile, chat, provider settings, quota usage, and contract registry data are stored in:

```text
data/sqlite/app.db
```

This path is ignored by git through `/data/` and database ignore rules. Do not push this file to GitHub.

Tables:

| Table | Purpose |
| --- | --- |
| `users` | Google subject id, UC Davis email, display name, avatar URL. |
| `student_profiles` | Stable onboarding/settings profile fields. |
| `chat_threads` | User-owned chat sessions visible across devices. |
| `chat_messages` | User-owned chat messages with role/content/timestamps. |
| `chat_tool_calls` | User-owned tool traces. |
| `user_llm_settings` | User model provider mode and encrypted API key metadata. |
| `llm_usage_events` | Per-user platform quota usage. |

## Privacy and GitHub Safety

Before pushing to GitHub, check:

| Item | Should be committed? |
| --- | --- |
| `data/` | No |
| `logs/` | No |
| `.env`, `.env.*` | No |
| `GOOGLE_CLIENT_SECRET` value | No |
| `LLM_API_KEY` value | No |
| `app.db` | No |
| `users.db` legacy/local files | No |
| RMP/course SQLite files | No |

Local git commits are okay for backup. GitHub pushes require a separate privacy review.
