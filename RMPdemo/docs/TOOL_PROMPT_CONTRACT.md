# Pathfinder UCD Tool and Prompt Contract

This document lists the tool surface that the system prompt may rely on.

## Tool Names

The following tools are registered by `LLMChatService.TOOLS` and mirrored into `app.db.tool_registry`:

| Tool | Source |
| --- | --- |
| `search_professors` | `rmp.db.professors` |
| `professors_for_course` | `rmp.db.professor_courses`, `rmp.db.professors` |
| `professor_reviews` | `rmp.db.reviews`, `rmp.db.professors` |
| `search_reviews_by_keywords` | `rmp.db.reviews`, `rmp.db.professors` |
| `query_rmp_table` | `rmp.db.professors`, `rmp.db.reviews`, `rmp.db.professor_courses` |
| `query_course_db` | `courses.db.courses` |
| `query_ucdavis_calendar` | `ucdavis_calendar.db.calendar_events` |
| `search_txt_context` | `data/txt/*.txt` |
| `query_major_catalog` | `majors.db.majors` |
| `query_change_major` | `changemajor.db.majors` |

## Consistency Rules

1. Every tool name in `LLMChatService.TOOLS` must be implemented by `LLMChatService.run_tool()`.
2. Every tool name in `LLMChatService.TOOLS` must be registered in `app.db.tool_registry`.
3. Every tool name listed in this document must exist in `LLMChatService.TOOLS`.
4. Prompt text may mention only registered tool names.
5. Queryable RMP and course fields must appear in `schema_registry`.

## User Context Rule

Saved student profile context is user-provided, not official. When profile data conflicts with retrieved UC Davis data, the assistant should explain the conflict and rely on the tool-grounded official/source data for factual claims.

## Privacy Rule

Tool calls and tool results can be stored in user-owned `chat_tool_calls`, but user API keys must never appear in:

- prompts
- tool arguments
- tool results
- chat messages
- audit logs
- frontend API responses
