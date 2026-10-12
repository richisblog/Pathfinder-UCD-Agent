import json
import sqlite3
import base64
import hashlib
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from cryptography.fernet import Fernet

from pathfinder_ucd_modern.core.config import (
    APP_ENCRYPTION_KEY,
    PLATFORM_DAILY_CHAT_LIMIT,
    USER_DB_PATH,
)


PROFILE_TEXT_FIELDS = {
    "language",
    "international_status",
    "student_type",
    "current_major",
    "target_major",
    "college",
    "entry_term",
    "entry_year",
    "graduation_year",
    "ap_ib_summary",
    "placement_summary",
}


class UserProfileService:
    def __init__(self, db_path: Path = USER_DB_PATH):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.ensure_schema()

    def ensure_schema(self) -> None:
        with closing(self._connect()) as conn, conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
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

                CREATE TABLE IF NOT EXISTS student_profiles (
                    user_id INTEGER PRIMARY KEY,
                    student_type TEXT,
                    language TEXT NOT NULL DEFAULT 'en',
                    international_status TEXT NOT NULL DEFAULT 'prefer_not_to_answer',
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
                    FOREIGN KEY(user_id) REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS chat_threads (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    archived_at TEXT,
                    pinned INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                );

                CREATE INDEX IF NOT EXISTS idx_chat_threads_user_updated
                ON chat_threads(user_id, archived_at, updated_at DESC);

                CREATE TABLE IF NOT EXISTS chat_messages (
                    id TEXT PRIMARY KEY,
                    thread_id TEXT NOT NULL,
                    user_id INTEGER NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
                    content TEXT NOT NULL,
                    original_content TEXT,
                    token_count INTEGER,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(thread_id) REFERENCES chat_threads(id),
                    FOREIGN KEY(user_id) REFERENCES users(id)
                );

                CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_user_created
                ON chat_messages(thread_id, user_id, created_at ASC);

                CREATE TABLE IF NOT EXISTS chat_tool_calls (
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
                    FOREIGN KEY(thread_id) REFERENCES chat_threads(id),
                    FOREIGN KEY(message_id) REFERENCES chat_messages(id),
                    FOREIGN KEY(user_id) REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS user_llm_settings (
                    user_id INTEGER PRIMARY KEY,
                    mode TEXT NOT NULL DEFAULT 'platform_default'
                        CHECK(mode IN ('platform_default', 'user_provider')),
                    provider TEXT NOT NULL DEFAULT 'platform',
                    display_name TEXT,
                    base_url TEXT,
                    model TEXT,
                    api_key_ciphertext TEXT,
                    api_key_last_four TEXT,
                    api_key_updated_at TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS llm_usage_events (
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
                    FOREIGN KEY(user_id) REFERENCES users(id),
                    FOREIGN KEY(thread_id) REFERENCES chat_threads(id),
                    FOREIGN KEY(message_id) REFERENCES chat_messages(id)
                );

                CREATE INDEX IF NOT EXISTS idx_llm_usage_user_created
                ON llm_usage_events(user_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS schema_registry (
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

                CREATE TABLE IF NOT EXISTS tool_registry (
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

                CREATE TABLE IF NOT EXISTS prompt_registry (
                    name TEXT PRIMARY KEY,
                    version TEXT NOT NULL,
                    prompt_text TEXT NOT NULL,
                    tool_names_json TEXT NOT NULL DEFAULT '[]',
                    schema_refs_json TEXT NOT NULL DEFAULT '[]',
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
            self._ensure_columns(conn)
            self._seed_contract_registry(conn)

    def _ensure_columns(self, conn: sqlite3.Connection) -> None:
        ensure_column(conn, "users", "email_domain", "TEXT NOT NULL DEFAULT 'ucdavis.edu'")
        ensure_column(conn, "users", "last_login_at", "TEXT")
        ensure_column(conn, "student_profiles", "profile_version", "INTEGER NOT NULL DEFAULT 1")
        ensure_column(conn, "student_profiles", "language", "TEXT NOT NULL DEFAULT 'en'")
        ensure_column(conn, "student_profiles", "international_status", "TEXT NOT NULL DEFAULT 'prefer_not_to_answer'")
        ensure_column(conn, "chat_messages", "original_content", "TEXT")

    def _seed_contract_registry(self, conn: sqlite3.Connection) -> None:
        from pathfinder_ucd_modern.services.CourseDbQueryService import COURSE_FIELDS
        from pathfinder_ucd_modern.services.LLMChatService import SYSTEM_PROMPT, TOOLS
        from pathfinder_ucd_modern.services.RmpQueryService import TABLE_CONFIG

        tool_names = []
        for tool in TOOLS:
            fn = tool.get("function") or {}
            name = fn.get("name")
            if not name:
                continue
            tool_names.append(name)
            conn.execute(
                """
                INSERT INTO tool_registry (
                    name, description, input_schema_json, output_schema_json,
                    source_db, source_tables_json, version, enabled, updated_at
                )
                VALUES (?, ?, ?, '{}', ?, ?, ?, 1, CURRENT_TIMESTAMP)
                ON CONFLICT(name) DO UPDATE SET
                    description = excluded.description,
                    input_schema_json = excluded.input_schema_json,
                    source_db = excluded.source_db,
                    source_tables_json = excluded.source_tables_json,
                    version = excluded.version,
                    enabled = 1,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    name,
                    fn.get("description") or "",
                    json.dumps(fn.get("parameters") or {}, ensure_ascii=False, sort_keys=True),
                    tool_source_db(name),
                    json.dumps(tool_source_tables(name), ensure_ascii=False),
                    "2026-06-23",
                ),
            )

        for table_name, config in TABLE_CONFIG.items():
            for field_name in sorted(config.get("fields") or {}):
                registry_id = f"rmp.{table_name}.{field_name}"
                conn.execute(
                    """
                    INSERT INTO schema_registry (
                        id, db_name, table_name, field_name, field_type,
                        public_description, tool_exposed, updated_at
                    )
                    VALUES (?, 'rmp.db', ?, ?, 'query_field', ?, 1, CURRENT_TIMESTAMP)
                    ON CONFLICT(db_name, table_name, field_name) DO UPDATE SET
                        field_type = excluded.field_type,
                        public_description = excluded.public_description,
                        tool_exposed = 1,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (registry_id, table_name, field_name, f"RMP query field: {field_name}"),
                )

        for field_name in sorted(COURSE_FIELDS):
            registry_id = f"courses.courses.{field_name}"
            conn.execute(
                """
                INSERT INTO schema_registry (
                    id, db_name, table_name, field_name, field_type,
                    public_description, tool_exposed, updated_at
                )
                VALUES (?, 'courses.db', 'courses', ?, 'query_field', ?, 1, CURRENT_TIMESTAMP)
                ON CONFLICT(db_name, table_name, field_name) DO UPDATE SET
                    field_type = excluded.field_type,
                    public_description = excluded.public_description,
                    tool_exposed = 1,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (registry_id, field_name, f"Course catalog query field: {field_name}"),
            )

        conn.execute(
            """
            INSERT INTO prompt_registry (
                name, version, prompt_text, tool_names_json, schema_refs_json, updated_at
            )
            VALUES ('system_prompt', '2026-06-23', ?, ?, '[]', CURRENT_TIMESTAMP)
            ON CONFLICT(name) DO UPDATE SET
                version = excluded.version,
                prompt_text = excluded.prompt_text,
                tool_names_json = excluded.tool_names_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            (SYSTEM_PROMPT, json.dumps(sorted(tool_names), ensure_ascii=False)),
        )

    def upsert_google_user(self, google_user: dict[str, Any]) -> dict[str, Any]:
        google_sub = clean_text(google_user.get("sub"))
        email = clean_text(google_user.get("email")).lower()
        if not google_sub:
            raise ValueError("Google user id missing")
        if not email:
            raise ValueError("Google email missing")
        name = clean_text(google_user.get("name"))
        picture = clean_text(google_user.get("picture"))

        email_domain = email.split("@")[-1] if "@" in email else ""
        with closing(self._connect()) as conn, conn:
            conn.execute(
                """
                INSERT INTO users (google_sub, email, email_domain, name, picture, last_login_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(google_sub) DO UPDATE SET
                    email = excluded.email,
                    email_domain = excluded.email_domain,
                    name = excluded.name,
                    picture = excluded.picture,
                    updated_at = CURRENT_TIMESTAMP,
                    last_login_at = CURRENT_TIMESTAMP
                """,
                (google_sub, email, email_domain, name, picture),
            )
            row = conn.execute(
                """
                SELECT id, google_sub, email, email_domain, name, picture, created_at, updated_at, last_login_at
                FROM users
                WHERE google_sub = ?
                """,
                (google_sub,),
            ).fetchone()
        return dict(row)

    def list_threads(self, user_id: int, include_archived: bool = False) -> list[dict[str, Any]]:
        where_archived = "" if include_archived else "AND archived_at IS NULL"
        with closing(self._connect()) as conn:
            rows = conn.execute(
                f"""
                SELECT id, user_id, title, created_at, updated_at, archived_at, pinned
                FROM chat_threads
                WHERE user_id = ?
                {where_archived}
                ORDER BY pinned DESC, updated_at DESC, created_at DESC
                """,
                (user_id,),
            ).fetchall()
        return [format_thread_row(row) for row in rows]

    def create_thread(self, user_id: int, title: str | None = None) -> dict[str, Any]:
        thread_id = new_id("thread")
        clean_title = clean_text(title, max_len=120) or "New chat"
        now = utc_now()
        with closing(self._connect()) as conn, conn:
            conn.execute(
                """
                INSERT INTO chat_threads (id, user_id, title, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (thread_id, user_id, clean_title, now, now),
            )
            row = self._thread_row(conn, user_id, thread_id)
        return format_thread_row(row)

    def get_thread(self, user_id: int, thread_id: str) -> dict[str, Any] | None:
        with closing(self._connect()) as conn:
            row = self._thread_row(conn, user_id, thread_id)
        return format_thread_row(row) if row else None

    def archive_thread(self, user_id: int, thread_id: str) -> bool:
        with closing(self._connect()) as conn, conn:
            result = conn.execute(
                """
                UPDATE chat_threads
                SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND user_id = ? AND archived_at IS NULL
                """,
                (thread_id, user_id),
            )
        return result.rowcount > 0

    def delete_account_data(self, user_id: int) -> bool:
        with closing(self._connect()) as conn, conn:
            user = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user:
                return False
            conn.execute("DELETE FROM chat_tool_calls WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM llm_usage_events WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM chat_messages WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM chat_threads WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM user_llm_settings WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM student_profiles WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        return True

    def add_message(
        self,
        user_id: int,
        thread_id: str,
        role: str,
        content: str,
        *,
        original_content: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        if role not in {"user", "assistant", "system"}:
            raise ValueError("Unsupported message role")
        clean_content = str(content or "")
        if not clean_content.strip():
            raise ValueError("Message content required")
        message_id = new_id("msg")
        metadata_json = json.dumps(metadata or {}, ensure_ascii=False, sort_keys=True)
        now = utc_now()
        with closing(self._connect()) as conn, conn:
            thread = self._thread_row(conn, user_id, thread_id)
            if not thread:
                return None
            conn.execute(
                """
                INSERT INTO chat_messages (
                    id, thread_id, user_id, role, content, original_content,
                    metadata_json, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    message_id,
                    thread_id,
                    user_id,
                    role,
                    clean_content,
                    original_content,
                    metadata_json,
                    now,
                ),
            )
            if role == "user":
                new_title = summarize_title(clean_content)
                conn.execute(
                    """
                    UPDATE chat_threads
                    SET title = CASE WHEN title = 'New chat' THEN ? ELSE title END,
                        updated_at = ?
                    WHERE id = ? AND user_id = ?
                    """,
                    (new_title, now, thread_id, user_id),
                )
            else:
                conn.execute(
                    "UPDATE chat_threads SET updated_at = ? WHERE id = ? AND user_id = ?",
                    (now, thread_id, user_id),
                )
            row = conn.execute(
                """
                SELECT id, thread_id, user_id, role, content, original_content,
                       token_count, metadata_json, created_at
                FROM chat_messages
                WHERE id = ? AND user_id = ?
                """,
                (message_id, user_id),
            ).fetchone()
        return format_message_row(row)

    def list_messages(self, user_id: int, thread_id: str, limit: int = 100) -> list[dict[str, Any]] | None:
        with closing(self._connect()) as conn:
            if not self._thread_row(conn, user_id, thread_id):
                return None
            rows = conn.execute(
                """
                SELECT id, thread_id, user_id, role, content, original_content,
                       token_count, metadata_json, created_at
                FROM chat_messages
                WHERE thread_id = ? AND user_id = ?
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (thread_id, user_id, min(max(int(limit or 100), 1), 500)),
            ).fetchall()
        return [format_message_row(row) for row in rows]

    def save_llm_settings(
        self,
        user_id: int,
        payload: dict[str, Any],
        *,
        encryption_key: str | None = None,
    ) -> dict[str, Any]:
        mode = clean_text(payload.get("mode")) or "platform_default"
        if mode not in {"platform_default", "user_provider"}:
            raise ValueError("Unsupported LLM mode")
        provider = clean_text(payload.get("provider"), 80) or ("platform" if mode == "platform_default" else "custom")
        display_name = clean_text(payload.get("display_name"), 120)
        base_url = clean_text(payload.get("base_url"), 500)
        model = clean_text(payload.get("model"), 120)
        api_key = str(payload.get("api_key") or "")
        api_key_ciphertext = None
        api_key_last_four = None
        api_key_updated_at = None

        if mode == "user_provider":
            existing = self.get_llm_settings(user_id, include_secret=True)
            if api_key:
                api_key_ciphertext = encrypt_secret(api_key, encryption_key or APP_ENCRYPTION_KEY)
                api_key_last_four = api_key[-4:]
                api_key_updated_at = utc_now()
            elif existing and existing.get("_api_key_ciphertext"):
                api_key_ciphertext = existing["_api_key_ciphertext"]
                api_key_last_four = existing.get("api_key_last_four")
                api_key_updated_at = existing.get("api_key_updated_at")
            else:
                raise ValueError("API key required for user provider mode")

        with closing(self._connect()) as conn, conn:
            conn.execute(
                """
                INSERT INTO user_llm_settings (
                    user_id, mode, provider, display_name, base_url, model,
                    api_key_ciphertext, api_key_last_four, api_key_updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    mode = excluded.mode,
                    provider = excluded.provider,
                    display_name = excluded.display_name,
                    base_url = excluded.base_url,
                    model = excluded.model,
                    api_key_ciphertext = excluded.api_key_ciphertext,
                    api_key_last_four = excluded.api_key_last_four,
                    api_key_updated_at = excluded.api_key_updated_at,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    user_id,
                    mode,
                    provider,
                    display_name,
                    base_url,
                    model,
                    api_key_ciphertext,
                    api_key_last_four,
                    api_key_updated_at,
                ),
            )
        settings = self.get_llm_settings(user_id)
        if not settings:
            raise RuntimeError("LLM settings save failed")
        return settings

    def get_llm_settings(self, user_id: int, include_secret: bool = False) -> dict[str, Any]:
        with closing(self._connect()) as conn:
            row = conn.execute(
                """
                SELECT user_id, mode, provider, display_name, base_url, model,
                       api_key_ciphertext, api_key_last_four, api_key_updated_at,
                       created_at, updated_at
                FROM user_llm_settings
                WHERE user_id = ?
                """,
                (user_id,),
            ).fetchone()
        if not row:
            result = {
                "mode": "platform_default",
                "provider": "platform",
                "display_name": "",
                "base_url": "",
                "model": "",
                "api_key_last_four": None,
                "api_key_updated_at": None,
            }
        else:
            result = dict(row)
            ciphertext = result.pop("api_key_ciphertext", None)
            if include_secret:
                result["_api_key_ciphertext"] = ciphertext
        if not include_secret:
            result.pop("_api_key_ciphertext", None)
        return result

    def llm_config_for_user(self, user_id: int, *, encryption_key: str | None = None) -> dict[str, Any]:
        settings = self.get_llm_settings(user_id, include_secret=True)
        if settings.get("mode") != "user_provider":
            return {"mode": "platform_default"}
        ciphertext = settings.get("_api_key_ciphertext")
        if not ciphertext:
            return {"mode": "platform_default"}
        return {
            "mode": "user_provider",
            "provider": settings.get("provider") or "custom",
            "base_url": settings.get("base_url") or None,
            "model": settings.get("model") or None,
            "api_key": decrypt_secret(ciphertext, encryption_key or APP_ENCRYPTION_KEY),
        }

    def quota_status(self, user_id: int, daily_limit: int = PLATFORM_DAILY_CHAT_LIMIT) -> dict[str, Any]:
        settings = self.get_llm_settings(user_id)
        if settings.get("mode") == "user_provider":
            return {
                "mode": "user_provider",
                "unlimited": True,
                "daily_limit": None,
                "used": 0,
                "remaining": None,
            }
        used = self.platform_usage_count_today(user_id)
        limit = max(int(daily_limit or PLATFORM_DAILY_CHAT_LIMIT), 0)
        return {
            "mode": "platform_default",
            "unlimited": False,
            "daily_limit": limit,
            "used": used,
            "remaining": max(limit - used, 0),
        }

    def record_llm_usage(
        self,
        user_id: int,
        *,
        thread_id: str | None = None,
        message_id: str | None = None,
        provider_mode: str = "platform_default",
        provider: str = "platform",
        model: str | None = None,
        daily_limit: int = PLATFORM_DAILY_CHAT_LIMIT,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if provider_mode not in {"platform_default", "user_provider"}:
            raise ValueError("Unsupported provider mode")
        counted = 1 if provider_mode == "platform_default" else 0
        if counted and self.platform_usage_count_today(user_id) >= max(int(daily_limit or 0), 0):
            raise QuotaExceededError("Daily platform message limit reached")
        event_id = new_id("usage")
        now = utc_now()
        with closing(self._connect()) as conn, conn:
            conn.execute(
                """
                INSERT INTO llm_usage_events (
                    id, user_id, thread_id, message_id, provider_mode, provider,
                    model, counted_against_platform_quota, created_at, metadata_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event_id,
                    user_id,
                    thread_id,
                    message_id,
                    provider_mode,
                    provider,
                    model,
                    counted,
                    now,
                    json.dumps(metadata or {}, ensure_ascii=False, sort_keys=True),
                ),
            )
        return self.quota_status(user_id, daily_limit=daily_limit)

    def add_tool_call(
        self,
        user_id: int,
        thread_id: str,
        *,
        message_id: str | None,
        tool_name: str,
        arguments: dict[str, Any] | None = None,
        result: dict[str, Any] | None = None,
        status: str = "ok",
        error: str | None = None,
    ) -> dict[str, Any] | None:
        if status not in {"started", "ok", "error"}:
            raise ValueError("Unsupported tool status")
        with closing(self._connect()) as conn, conn:
            if not self._thread_row(conn, user_id, thread_id):
                return None
            call_id = new_id("tool")
            now = utc_now()
            conn.execute(
                """
                INSERT INTO chat_tool_calls (
                    id, thread_id, message_id, user_id, tool_name, arguments_json,
                    result_json, status, created_at, completed_at, error
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    call_id,
                    thread_id,
                    message_id,
                    user_id,
                    clean_text(tool_name, 120),
                    json.dumps(arguments or {}, ensure_ascii=False, sort_keys=True),
                    json.dumps(result or {}, ensure_ascii=False, sort_keys=True) if result is not None else None,
                    status,
                    now,
                    now if status in {"ok", "error"} else None,
                    error,
                ),
            )
            row = conn.execute(
                """
                SELECT id, thread_id, message_id, user_id, tool_name, arguments_json,
                       result_json, status, created_at, completed_at, error
                FROM chat_tool_calls
                WHERE id = ? AND user_id = ?
                """,
                (call_id, user_id),
            ).fetchone()
        return dict(row) if row else None

    def platform_usage_count_today(self, user_id: int) -> int:
        start = utc_day_start()
        with closing(self._connect()) as conn:
            row = conn.execute(
                """
                SELECT COUNT(*) AS count
                FROM llm_usage_events
                WHERE user_id = ?
                  AND counted_against_platform_quota = 1
                  AND created_at >= ?
                """,
                (user_id, start),
            ).fetchone()
        return int(row["count"] if row else 0)

    def _thread_row(self, conn: sqlite3.Connection, user_id: int, thread_id: str) -> sqlite3.Row | None:
        return conn.execute(
            """
            SELECT id, user_id, title, created_at, updated_at, archived_at, pinned
            FROM chat_threads
            WHERE id = ? AND user_id = ?
            """,
            (thread_id, user_id),
        ).fetchone()

    def save_profile(self, user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        profile = sanitize_profile(payload)
        preferences_json = json.dumps(profile["course_preferences"], ensure_ascii=False, sort_keys=True)
        with closing(self._connect()) as conn, conn:
            conn.execute(
                """
                INSERT INTO student_profiles (
                    user_id, student_type, language, international_status, current_major, target_major, college,
                    entry_term, entry_year, graduation_year, considering_change_major,
                    ap_ib_summary, placement_summary, course_preferences_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    student_type = excluded.student_type,
                    language = excluded.language,
                    international_status = excluded.international_status,
                    current_major = excluded.current_major,
                    target_major = excluded.target_major,
                    college = excluded.college,
                    entry_term = excluded.entry_term,
                    entry_year = excluded.entry_year,
                    graduation_year = excluded.graduation_year,
                    considering_change_major = excluded.considering_change_major,
                    ap_ib_summary = excluded.ap_ib_summary,
                    placement_summary = excluded.placement_summary,
                    course_preferences_json = excluded.course_preferences_json,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    user_id,
                    profile["student_type"],
                    profile["language"],
                    profile["international_status"],
                    profile["current_major"],
                    profile["target_major"],
                    profile["college"],
                    profile["entry_term"],
                    profile["entry_year"],
                    profile["graduation_year"],
                    1 if profile["considering_change_major"] else 0,
                    profile["ap_ib_summary"],
                    profile["placement_summary"],
                    preferences_json,
                ),
            )
            row = self._profile_row(conn, user_id)
        if not row:
            raise RuntimeError("Profile save failed")
        return format_profile_row(row)

    def get_user_with_profile(self, user_id: int) -> dict[str, Any] | None:
        with closing(self._connect()) as conn:
            user = conn.execute(
                """
                SELECT id, google_sub, email, name, picture, created_at, updated_at
                FROM users
                WHERE id = ?
                """,
                (user_id,),
            ).fetchone()
            if not user:
                return None
            profile = self._profile_row(conn, user_id)
        result = dict(user)
        result["profile"] = format_profile_row(profile) if profile else None
        result["profile_complete"] = profile_is_complete(result["profile"])
        return result

    def profile_context_for_user(self, user_id: int) -> str:
        user = self.get_user_with_profile(user_id)
        if not user or not user.get("profile"):
            return ""
        profile = user["profile"]
        preferences = profile.get("course_preferences") or {}
        lines = [
            "Stable student profile from the user's saved onboarding settings.",
            "Always consult this profile before answering each chat turn.",
            "Prior credit, placement, major, college, international status, and planning preferences are high-salience advising context.",
            f"UC Davis email: {user.get('email')}",
            f"Preferred UI language: {profile.get('language') or 'en'}",
            f"International student status: {profile.get('international_status') or 'prefer_not_to_answer'}",
            f"Student type: {profile.get('student_type') or 'not provided'}",
            f"Current major: {profile.get('current_major') or 'not provided'}",
            f"Target major: {profile.get('target_major') or 'not provided'}",
            f"College: {profile.get('college') or 'not provided'}",
            f"Entry term/year: {profile.get('entry_term') or 'not provided'} {profile.get('entry_year') or ''}".strip(),
            f"Expected graduation year: {profile.get('graduation_year') or 'not provided'}",
            f"Considering change of major: {bool(profile.get('considering_change_major'))}",
            f"AP/IB/transfer credit summary: {profile.get('ap_ib_summary') or 'not provided'}",
            f"Placement summary: {profile.get('placement_summary') or 'not provided'}",
            f"Self assessment: {preferences.get('self_assessment') or 'not provided'}",
            f"Course preferences: {json.dumps(preferences, ensure_ascii=False, sort_keys=True)}",
            "Use this profile as user-provided context, not as official record. If it conflicts with tool data, explain the conflict.",
        ]
        return "\n".join(lines)

    def _profile_row(self, conn: sqlite3.Connection, user_id: int) -> sqlite3.Row | None:
        return conn.execute(
            """
            SELECT user_id, student_type, language, international_status, current_major, target_major, college,
                   entry_term, entry_year, graduation_year, considering_change_major,
                   ap_ib_summary, placement_summary, course_preferences_json,
                   created_at, updated_at
            FROM student_profiles
            WHERE user_id = ?
            """,
            (user_id,),
        ).fetchone()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn


def sanitize_profile(payload: dict[str, Any]) -> dict[str, Any]:
    result = {field: clean_text(payload.get(field), max_len=240) for field in PROFILE_TEXT_FIELDS}
    if result["language"] not in {"en", "zh"}:
        result["language"] = "en"
    if result["international_status"] not in {"yes", "no", "prefer_not_to_answer"}:
        result["international_status"] = "prefer_not_to_answer"
    result["ap_ib_summary"] = clean_text(payload.get("ap_ib_summary"), max_len=1200)
    result["placement_summary"] = clean_text(payload.get("placement_summary"), max_len=1200)
    result["considering_change_major"] = bool(payload.get("considering_change_major"))
    preferences = payload.get("course_preferences")
    result["course_preferences"] = sanitize_preferences(preferences if isinstance(preferences, dict) else {})
    return result


def sanitize_preferences(preferences: dict[str, Any]) -> dict[str, str]:
    allowed = {
        "priority",
        "max_difficulty",
        "target_units",
        "professor_style",
        "schedule_preference",
        "self_assessment",
    }
    clean = {}
    for key in allowed:
        max_len = 1200 if key == "self_assessment" else 200
        value = clean_text(preferences.get(key), max_len=max_len)
        if value:
            clean[key] = value
    return clean


def format_profile_row(row: sqlite3.Row | dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    profile = dict(row)
    raw_preferences = profile.pop("course_preferences_json", "{}") or "{}"
    try:
        profile["course_preferences"] = json.loads(raw_preferences)
    except json.JSONDecodeError:
        profile["course_preferences"] = {}
    profile["considering_change_major"] = bool(profile.get("considering_change_major"))
    return profile


def profile_is_complete(profile: dict[str, Any] | None) -> bool:
    if not profile:
        return False
    return bool(profile.get("student_type") and (profile.get("current_major") or profile.get("target_major")))


def clean_text(value: Any, max_len: int = 500) -> str:
    text = " ".join(str(value or "").split())
    return text[:max_len]


class QuotaExceededError(RuntimeError):
    pass


def ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in existing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def utc_day_start() -> str:
    now = datetime.now(timezone.utc)
    start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    return start.isoformat().replace("+00:00", "Z")


def summarize_title(content: str) -> str:
    clean = " ".join(str(content or "").split())
    return clean[:48] + ("..." if len(clean) > 48 else "") if clean else "New chat"


def format_thread_row(row: sqlite3.Row | dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    item = dict(row)
    item["pinned"] = bool(item.get("pinned"))
    return item


def format_message_row(row: sqlite3.Row | dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    item = dict(row)
    raw_metadata = item.pop("metadata_json", "{}") or "{}"
    try:
        item["metadata"] = json.loads(raw_metadata)
    except json.JSONDecodeError:
        item["metadata"] = {}
    return item


def encrypt_secret(secret: str, encryption_key: str | None) -> str:
    key = (encryption_key or "").strip()
    if not key:
        raise ValueError("APP_ENCRYPTION_KEY must be configured before saving user API keys")
    fernet = Fernet(derive_fernet_key(key))
    return fernet.encrypt(secret.encode("utf-8")).decode("utf-8")


def decrypt_secret(ciphertext: str, encryption_key: str | None) -> str:
    key = (encryption_key or "").strip()
    if not key:
        raise ValueError("APP_ENCRYPTION_KEY must be configured before reading user API keys")
    fernet = Fernet(derive_fernet_key(key))
    return fernet.decrypt(ciphertext.encode("utf-8")).decode("utf-8")


def derive_fernet_key(raw_key: str) -> bytes:
    digest = hashlib.sha256(raw_key.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def tool_source_db(tool_name: str) -> str | None:
    if tool_name in {"search_professors", "professors_for_course", "professor_reviews", "search_reviews_by_keywords", "query_rmp_table"}:
        return "rmp.db"
    if tool_name == "query_course_db":
        return "courses.db"
    if tool_name == "query_change_major":
        return "changemajor.db"
    if tool_name == "query_major_catalog":
        return "majors.db"
    if tool_name == "query_ucdavis_calendar":
        return "ucdavis_calendar.db"
    if tool_name == "search_txt_context":
        return "data/txt"
    return None


def tool_source_tables(tool_name: str) -> list[str]:
    tables = {
        "search_professors": ["professors"],
        "professors_for_course": ["professor_courses", "professors"],
        "professor_reviews": ["reviews", "professors"],
        "search_reviews_by_keywords": ["reviews", "professors"],
        "query_rmp_table": ["professors", "reviews", "professor_courses"],
        "query_course_db": ["courses"],
        "query_change_major": ["majors"],
        "query_major_catalog": ["majors"],
        "query_ucdavis_calendar": ["calendar_events"],
        "search_txt_context": [
            "AP.txt",
            "IB.txt",
            "math placement.txt.txt",
            "chemistry placement.txt.txt",
            "writing_requirements.md",
            "course_selection_policies.md",
            "international_student_course_planning.md",
            "ucdavis_common_resources_index.md",
            "ucdavis_policy_sources_index.md",
        ],
    }
    return tables.get(tool_name, [])
