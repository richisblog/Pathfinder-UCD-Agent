import time
from collections import defaultdict, deque
from typing import Any
from urllib.parse import urlparse

from flask import Response, jsonify, request

from pathfinder_ucd_modern.core.config import (
    ALLOWED_ORIGINS,
    BLOCK_BOT_USER_AGENTS,
    CHAT_RATE_LIMIT_MAX_REQUESTS,
    IS_PRODUCTION,
    MAX_HISTORY_CHARS,
    MAX_HISTORY_MESSAGES,
    MAX_MESSAGE_CHARS,
    RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT_WINDOW_SECONDS,
    TRUST_PROXY,
)


BOT_USER_AGENT_PARTS = (
    "bot",
    "spider",
    "crawler",
    "scrapy",
    "curl",
    "wget",
    "python-requests",
    "httpx",
    "go-http-client",
    "java/",
)


class WindowRateLimiter:
    def __init__(self):
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, *, limit: int, window_seconds: int) -> tuple[bool, int]:
        now = time.monotonic()
        bucket = self._hits[key]
        while bucket and bucket[0] <= now - window_seconds:
            bucket.popleft()
        if len(bucket) >= limit:
            retry_after = max(1, int(window_seconds - (now - bucket[0])))
            return False, retry_after
        bucket.append(now)
        return True, 0


def client_ip() -> str:
    if TRUST_PROXY:
        forwarded = request.headers.get("X-Forwarded-For", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip.strip()
    return request.remote_addr or "unknown"


def is_allowed_origin(origin: str | None) -> bool:
    if not origin:
        return True
    normalized = origin.rstrip("/")
    if normalized in ALLOWED_ORIGINS:
        return True
    parsed = urlparse(normalized)
    if not IS_PRODUCTION and parsed.hostname in {"127.0.0.1", "localhost"}:
        return True
    request_origin = f"{request.scheme}://{request.host}".rstrip("/")
    return normalized == request_origin


def is_bot_user_agent(user_agent: str | None) -> bool:
    lowered = (user_agent or "").lower()
    return any(part in lowered for part in BOT_USER_AGENT_PARTS)


def sanitize_chat_payload(payload: dict[str, Any]) -> tuple[str, list[dict[str, str]]]:
    message = (payload.get("message") or "").strip()
    if not message:
        raise ValueError("Message required")
    if len(message) > MAX_MESSAGE_CHARS:
        raise ValueError(f"Message too long; max {MAX_MESSAGE_CHARS} characters")

    history: list[dict[str, str]] = []
    total_chars = 0
    raw_history = payload.get("history") or []
    if isinstance(raw_history, list):
        for item in raw_history[-MAX_HISTORY_MESSAGES:]:
            if not isinstance(item, dict):
                continue
            role = item.get("role")
            content = item.get("content")
            if role not in {"user", "assistant"} or not isinstance(content, str):
                continue
            total_chars += len(content)
            if total_chars > MAX_HISTORY_CHARS:
                break
            history.append({"role": role, "content": content})
    return message, history


def request_meta() -> dict[str, Any]:
    return {
        "ip": client_ip(),
        "method": request.method,
        "path": request.path,
        "origin": request.headers.get("Origin"),
        "referer": request.headers.get("Referer"),
        "user_agent": request.headers.get("User-Agent"),
        "forwarded_for": request.headers.get("X-Forwarded-For"),
    }


def configure_security(app) -> None:
    limiter = WindowRateLimiter()

    @app.before_request
    def enforce_request_security():
        if request.method == "OPTIONS":
            return Response(status=204)

        if request.path in {"/healthz", "/robots.txt"} or request.path.startswith("/static/"):
            return None

        origin = request.headers.get("Origin")
        if origin and not is_allowed_origin(origin):
            return jsonify({"error": "Origin not allowed"}), 403

        if BLOCK_BOT_USER_AGENTS and request.path.startswith("/api/") and is_bot_user_agent(request.headers.get("User-Agent")):
            return jsonify({"error": "Automated clients are not allowed"}), 403

        ip = client_ip()
        allowed, retry_after = limiter.allow(
            f"global:{ip}",
            limit=RATE_LIMIT_MAX_REQUESTS,
            window_seconds=RATE_LIMIT_WINDOW_SECONDS,
        )
        if not allowed:
            return rate_limited_response(retry_after)

        if request.path.startswith("/api/chat"):
            allowed, retry_after = limiter.allow(
                f"chat:{ip}",
                limit=CHAT_RATE_LIMIT_MAX_REQUESTS,
                window_seconds=RATE_LIMIT_WINDOW_SECONDS,
            )
            if not allowed:
                return rate_limited_response(retry_after)
        return None

    @app.after_request
    def add_security_headers(response):
        origin = request.headers.get("Origin")
        if is_allowed_origin(origin) and origin:
            response.headers["Access-Control-Allow-Origin"] = origin.rstrip("/")
            response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET,POST,DELETE,OPTIONS"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self'; "
            "img-src 'self' data:; "
            "connect-src 'self'; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )
        return response


def rate_limited_response(retry_after: int):
    response = jsonify({"error": "Too many requests. Please slow down."})
    response.status_code = 429
    response.headers["Retry-After"] = str(retry_after)
    return response
