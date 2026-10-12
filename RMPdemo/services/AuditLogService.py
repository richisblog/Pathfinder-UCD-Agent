import json
import threading
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pathfinder_ucd_modern.core.config import AUDIT_LOG_MAX_VALUE_CHARS, LOG_ROOT
from pathfinder_ucd_modern.services.CalendarQueryService import pacific_now


SENSITIVE_KEYS = {
    "authorization",
    "cookie",
    "set-cookie",
    "api_key",
    "apikey",
    "access_token",
    "token",
    "password",
    "secret",
    "llm_api_key",
    "provider_api_key",
}


class AuditLogService:
    def __init__(self, log_root: Path = LOG_ROOT):
        self.log_root = Path(log_root)
        self._lock = threading.Lock()

    def start_chat(
        self,
        *,
        message: str,
        history: list[dict[str, Any]],
        request_meta: dict[str, Any],
    ) -> "ChatAuditTrace":
        return ChatAuditTrace(
            service=self,
            request_id=str(uuid.uuid4()),
            message=message,
            history=history,
            request_meta=request_meta,
        )

    def write(self, entry: dict[str, Any]) -> None:
        self.log_root.mkdir(parents=True, exist_ok=True)
        path = self.log_root / f"chat_audit-{pacific_now().strftime('%Y-%m-%d')}.jsonl"
        safe_entry = redact_and_bound(entry)
        line = json.dumps(safe_entry, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            with path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")


class ChatAuditTrace:
    def __init__(
        self,
        *,
        service: AuditLogService,
        request_id: str,
        message: str,
        history: list[dict[str, Any]],
        request_meta: dict[str, Any],
    ):
        self.service = service
        self.request_id = request_id
        self.started_at_utc = datetime.now(timezone.utc).isoformat()
        self.started_at_pacific = pacific_now().isoformat()
        self.message = message
        self.history = deepcopy(history)
        self.request_meta = deepcopy(request_meta)
        self.events: list[dict[str, Any]] = []
        self.finished = False

    def record(self, event_type: str, payload: dict[str, Any] | None = None) -> None:
        self.events.append({
            "type": event_type,
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
            "timestamp_pacific": pacific_now().isoformat(),
            "payload": deepcopy(payload or {}),
        })

    def finish(
        self,
        *,
        status: str,
        final_response: str | None = None,
        error: str | None = None,
    ) -> None:
        if self.finished:
            return
        self.finished = True
        entry = {
            "schema": "pathfinder_chat_audit_v1",
            "request_id": self.request_id,
            "started_at_utc": self.started_at_utc,
            "started_at_pacific": self.started_at_pacific,
            "finished_at_utc": datetime.now(timezone.utc).isoformat(),
            "finished_at_pacific": pacific_now().isoformat(),
            "status": status,
            "request": {
                "message": self.message,
                "history": self.history,
                "meta": self.request_meta,
            },
            "events": self.events,
            "final_response": final_response,
            "error": error,
        }
        self.service.write(entry)


def redact_and_bound(value: Any, *, key: str | None = None) -> Any:
    if key and key.lower() in SENSITIVE_KEYS:
        return "[REDACTED]"
    if isinstance(value, dict):
        return {
            str(item_key): redact_and_bound(item_value, key=str(item_key))
            for item_key, item_value in value.items()
        }
    if isinstance(value, list):
        return [redact_and_bound(item) for item in value]
    if isinstance(value, tuple):
        return [redact_and_bound(item) for item in value]
    if isinstance(value, str):
        if len(value) <= AUDIT_LOG_MAX_VALUE_CHARS:
            return value
        return {
            "truncated": True,
            "original_chars": len(value),
            "value": value[:AUDIT_LOG_MAX_VALUE_CHARS],
        }
    return value
