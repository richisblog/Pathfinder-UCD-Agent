import json
from pathlib import Path

from flask import Flask, Response, jsonify, redirect, render_template, request, session, stream_with_context
from werkzeug.middleware.proxy_fix import ProxyFix

from pathfinder_ucd_modern.core.config import (
    AUDIT_LOG_ENABLED,
    FLASK_DEBUG,
    GOOGLE_ALLOWED_DOMAIN,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    IS_PRODUCTION,
    APP_ENCRYPTION_KEY,
    MAX_CONTENT_LENGTH,
    PLATFORM_DAILY_CHAT_LIMIT,
    SECRET_KEY,
    TRUST_PROXY,
    USER_DB_PATH,
    WEB_PORT,
)
from pathfinder_ucd_modern.services.AuditLogService import AuditLogService
from pathfinder_ucd_modern.services.ChangeMajorQueryService import ChangeMajorQueryService
from pathfinder_ucd_modern.services.LLMChatService import LLMChatService
from pathfinder_ucd_modern.services.RmpQueryService import RmpQueryService
from pathfinder_ucd_modern.services.TxtContextService import TxtContextService
from pathfinder_ucd_modern.services.UserProfileService import QuotaExceededError, UserProfileService
from pathfinder_ucd_modern.web.auth import (
    current_user_id,
    google_callback_userinfo,
    google_login_redirect,
    is_allowed_student_email,
    login_user,
    logout_user,
)
from pathfinder_ucd_modern.web.security import configure_security, request_meta, sanitize_chat_payload


_AUDIT_DEFAULT = object()


def create_app(
    *,
    user_db_path: str | Path | None = None,
    chat_service: LLMChatService | None = None,
    audit_service: AuditLogService | None | object = _AUDIT_DEFAULT,
):
    app = Flask(
        __name__,
        template_folder="templates",
        static_folder="static",
    )
    app.secret_key = SECRET_KEY
    app.config.update(
        GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET,
        GOOGLE_ALLOWED_DOMAIN=GOOGLE_ALLOWED_DOMAIN,
        APP_ENCRYPTION_KEY=APP_ENCRYPTION_KEY,
        PLATFORM_DAILY_CHAT_LIMIT=PLATFORM_DAILY_CHAT_LIMIT,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=IS_PRODUCTION,
    )
    if TRUST_PROXY:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
    app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH
    query_service = RmpQueryService()
    changemajor_service = ChangeMajorQueryService()
    chat_service = chat_service or LLMChatService(query_service, changemajor_service=changemajor_service)
    audit_service = (AuditLogService() if AUDIT_LOG_ENABLED else None) if audit_service is _AUDIT_DEFAULT else audit_service
    user_service = UserProfileService(Path(user_db_path) if user_db_path else USER_DB_PATH)

    configure_security(app)

    @app.get("/")
    def index():
        return redirect("/chat")

    @app.get("/login")
    def login_page():
        return render_template("login.html")

    @app.get("/onboarding")
    def onboarding_page():
        return render_template("onboarding.html")

    @app.get("/chat")
    def chat_page():
        return render_template("chat.html")

    @app.get("/settings")
    def settings_page():
        return render_template("settings.html")

    @app.get("/healthz")
    def healthz():
        return jsonify({"ok": True})

    @app.get("/robots.txt")
    def robots_txt():
        return Response(
            "User-agent: *\nDisallow: /\n",
            mimetype="text/plain; charset=utf-8",
        )

    @app.errorhandler(413)
    def request_too_large(_error):
        return jsonify({"error": "Request body too large"}), 413

    @app.get("/auth/google")
    def google_login():
        try:
            return google_login_redirect()
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    @app.get("/auth/google/callback")
    def google_callback():
        try:
            google_user = google_callback_userinfo()
        except Exception as exc:
            return jsonify({"error": str(exc)}), 400
        email = google_user.get("email")
        if not is_allowed_student_email(email, app.config["GOOGLE_ALLOWED_DOMAIN"]):
            return jsonify({"error": "Please sign in with a UC Davis @ucdavis.edu email address."}), 403
        try:
            user = user_service.upsert_google_user(google_user)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        login_user(user["id"])
        refreshed = user_service.get_user_with_profile(user["id"])
        return redirect("/chat" if refreshed and refreshed.get("profile_complete") else "/onboarding")

    @app.post("/auth/logout")
    def logout():
        logout_user()
        return jsonify({"ok": True})

    @app.delete("/api/account")
    def delete_account():
        user = require_user()
        if not isinstance(user, dict):
            return user
        deleted = user_service.delete_account_data(user["id"])
        logout_user()
        return jsonify({"ok": True, "deleted": deleted})

    @app.get("/api/me")
    def me():
        user = current_user()
        if not user:
            return jsonify({"authenticated": False, "user": None, "profile": None, "profile_complete": False})
        return jsonify({
            "authenticated": True,
            "user": public_user(user),
            "profile": user.get("profile"),
            "profile_complete": bool(user.get("profile_complete")),
        })

    @app.get("/api/profile")
    def get_profile():
        user = require_user()
        if not isinstance(user, dict):
            return user
        return jsonify({"profile": user.get("profile"), "profile_complete": bool(user.get("profile_complete"))})

    @app.post("/api/profile")
    def save_profile():
        user = require_user()
        if not isinstance(user, dict):
            return user
        payload = request.get_json(silent=True) or {}
        profile = user_service.save_profile(user["id"], payload)
        refreshed = user_service.get_user_with_profile(user["id"])
        return jsonify({
            "ok": True,
            "user": public_user(refreshed),
            "profile": profile,
            "profile_complete": bool(refreshed and refreshed.get("profile_complete")),
        })

    @app.get("/api/chat/threads")
    def list_chat_threads():
        user = require_user(profile_required=True)
        if not isinstance(user, dict):
            return user
        return jsonify({"threads": user_service.list_threads(user["id"])})

    @app.post("/api/chat/threads")
    def create_chat_thread():
        user = require_user(profile_required=True)
        if not isinstance(user, dict):
            return user
        payload = request.get_json(silent=True) or {}
        thread = user_service.create_thread(user["id"], payload.get("title"))
        return jsonify({"thread": thread})

    @app.get("/api/chat/threads/<thread_id>")
    def get_chat_thread(thread_id):
        user = require_user(profile_required=True)
        if not isinstance(user, dict):
            return user
        thread = user_service.get_thread(user["id"], thread_id)
        if not thread:
            return jsonify({"error": "Thread not found"}), 404
        return jsonify({"thread": thread})

    @app.delete("/api/chat/threads/<thread_id>")
    def delete_chat_thread(thread_id):
        user = require_user(profile_required=True)
        if not isinstance(user, dict):
            return user
        if not user_service.archive_thread(user["id"], thread_id):
            return jsonify({"error": "Thread not found"}), 404
        return jsonify({"ok": True})

    @app.get("/api/chat/threads/<thread_id>/messages")
    def list_chat_messages(thread_id):
        user = require_user(profile_required=True)
        if not isinstance(user, dict):
            return user
        messages = user_service.list_messages(user["id"], thread_id)
        if messages is None:
            return jsonify({"error": "Thread not found"}), 404
        return jsonify({"messages": messages})

    @app.post("/api/chat/threads/<thread_id>/messages")
    def add_chat_message(thread_id):
        user = require_user(profile_required=True)
        if not isinstance(user, dict):
            return user
        payload = request.get_json(silent=True) or {}
        try:
            message = user_service.add_message(
                user["id"],
                thread_id,
                payload.get("role") or "user",
                payload.get("content") or "",
                original_content=payload.get("original_content"),
                metadata=payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {},
            )
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        if not message:
            return jsonify({"error": "Thread not found"}), 404
        return jsonify({"message": message})

    @app.post("/api/chat/threads/<thread_id>/usage")
    def record_thread_usage(thread_id):
        user = require_user(profile_required=True)
        if not isinstance(user, dict):
            return user
        if not user_service.get_thread(user["id"], thread_id):
            return jsonify({"error": "Thread not found"}), 404
        payload = request.get_json(silent=True) or {}
        try:
            quota = user_service.record_llm_usage(
                user["id"],
                thread_id=thread_id,
                provider_mode=payload.get("provider_mode") or "platform_default",
                provider=payload.get("provider") or "platform",
                model=payload.get("model"),
                daily_limit=current_daily_limit(),
            )
        except QuotaExceededError as exc:
            return jsonify({"error": str(exc), "quota": user_service.quota_status(user["id"], current_daily_limit())}), 429
        return jsonify({"ok": True, "quota": quota})

    @app.post("/api/chat/threads/<thread_id>/messages/stream")
    def stream_thread_message(thread_id):
        user = require_user(profile_required=True)
        if not isinstance(user, dict):
            return user
        if not user_service.get_thread(user["id"], thread_id):
            return jsonify({"error": "Thread not found"}), 404
        quota = user_service.quota_status(user["id"], current_daily_limit())
        if not quota.get("unlimited") and quota.get("remaining") <= 0:
            return jsonify({"error": "Daily platform message limit reached", "quota": quota}), 429

        payload = request.get_json(silent=True) or {}
        try:
            message, _history = sanitize_chat_payload(payload)
            user_message = user_service.add_message(
                user["id"],
                thread_id,
                "user",
                message,
                original_content=payload.get("message"),
                metadata={"source": "chat_thread_stream"},
            )
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        if not user_message:
            return jsonify({"error": "Thread not found"}), 404

        stored_history = user_service.list_messages(user["id"], thread_id) or []
        history = [
            {"role": item["role"], "content": item["content"]}
            for item in stored_history
            if item["role"] in {"user", "assistant"} and item["id"] != user_message["id"]
        ]
        llm_config = current_llm_config(user["id"])

        def generate():
            final_parts = []
            error_text = None
            try:
                tool_event = None
                for event in chat_service.stream_chat(
                    message=message,
                    history=history,
                    student_profile_context=user_service.profile_context_for_user(user["id"]),
                    llm_config=llm_config,
                ):
                    if event.get("type") == "delta":
                        final_parts.append(event.get("content") or "")
                    if event.get("type") == "tool_start":
                        tool_event = {
                            "tool_name": event.get("name") or event.get("label") or "tool",
                            "arguments": event.get("args") if isinstance(event.get("args"), dict) else {},
                        }
                    elif event.get("type") == "tool_result" and tool_event:
                        user_service.add_tool_call(
                            user["id"],
                            thread_id,
                            message_id=user_message["id"],
                            tool_name=tool_event["tool_name"],
                            arguments=tool_event["arguments"],
                            result={"summary": event.get("summary")},
                            status="ok",
                        )
                        tool_event = None
                    yield json.dumps(event, ensure_ascii=False) + "\n"
            except Exception as exc:
                error_text = str(exc)
                yield json.dumps({"type": "error", "message": str(exc)}, ensure_ascii=False) + "\n"
            finally:
                final_text = "".join(final_parts).strip()
                if final_text and not error_text:
                    assistant_message = user_service.add_message(
                        user["id"],
                        thread_id,
                        "assistant",
                        final_text,
                        metadata={"source": "chat_thread_stream"},
                    )
                    provider_mode = llm_config.get("mode") if isinstance(llm_config, dict) else "platform_default"
                    try:
                        user_service.record_llm_usage(
                            user["id"],
                            thread_id=thread_id,
                            message_id=assistant_message["id"] if assistant_message else None,
                            provider_mode=provider_mode,
                            provider=(llm_config or {}).get("provider") or "platform",
                            model=(llm_config or {}).get("model"),
                            daily_limit=current_daily_limit(),
                        )
                    except QuotaExceededError:
                        # Quota is checked before generation; a race can still happen.
                        pass

        return Response(
            stream_with_context(generate()),
            mimetype="application/x-ndjson; charset=utf-8",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.get("/api/settings/llm")
    def get_llm_settings():
        user = require_user()
        if not isinstance(user, dict):
            return user
        return jsonify({"settings": user_service.get_llm_settings(user["id"])})

    @app.post("/api/settings/llm")
    def save_llm_settings():
        user = require_user()
        if not isinstance(user, dict):
            return user
        payload = request.get_json(silent=True) or {}
        try:
            settings = user_service.save_llm_settings(
                user["id"],
                payload,
                encryption_key=current_encryption_key(),
            )
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        return jsonify({"settings": settings})

    @app.get("/api/settings/quota")
    def get_quota():
        user = require_user()
        if not isinstance(user, dict):
            return user
        return jsonify(user_service.quota_status(user["id"], current_daily_limit()))

    @app.post("/api/chat")
    def chat():
        user = require_user(profile_required=True)
        if not isinstance(user, dict):
            return user
        quota = user_service.quota_status(user["id"], current_daily_limit())
        if not quota.get("unlimited") and quota.get("remaining") <= 0:
            return jsonify({"error": "Daily platform message limit reached", "quota": quota}), 429
        payload = request.get_json(silent=True) or {}
        try:
            message, history = sanitize_chat_payload(payload)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        llm_config = current_llm_config(user["id"])

        trace = audit_service.start_chat(
            message=message,
            history=history,
            request_meta=request_meta(),
        ) if audit_service else None
        try:
            result = chat_service.chat(
                message=message,
                cards=payload.get("cards") or [],
                history=history,
                student_profile_context=user_service.profile_context_for_user(user["id"]),
                llm_config=llm_config,
                audit_recorder=trace.record if trace else None,
            )
            if result.get("answer"):
                provider_mode = llm_config.get("mode") if isinstance(llm_config, dict) else "platform_default"
                user_service.record_llm_usage(
                    user["id"],
                    provider_mode=provider_mode,
                    provider=(llm_config or {}).get("provider") or "platform",
                    model=(llm_config or {}).get("model"),
                    daily_limit=current_daily_limit(),
                    metadata={"source": "legacy_chat"},
                )
            if trace:
                trace.finish(status="ok", final_response=result.get("answer"))
            return jsonify(result)
        except Exception as exc:
            if trace:
                trace.finish(status="error", error=str(exc))
            return jsonify({"error": str(exc)}), 500

    @app.post("/api/chat/stream")
    def chat_stream():
        user = require_user(profile_required=True)
        if not isinstance(user, dict):
            return user
        quota = user_service.quota_status(user["id"], current_daily_limit())
        if not quota.get("unlimited") and quota.get("remaining") <= 0:
            return jsonify({"error": "Daily platform message limit reached", "quota": quota}), 429
        payload = request.get_json(silent=True) or {}
        try:
            message, history = sanitize_chat_payload(payload)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        llm_config = current_llm_config(user["id"])

        trace = audit_service.start_chat(
            message=message,
            history=history,
            request_meta=request_meta(),
        ) if audit_service else None

        def generate():
            final_parts = []
            error_text = None
            try:
                for event in chat_service.stream_chat(
                    message=message,
                    history=history,
                    student_profile_context=user_service.profile_context_for_user(user["id"]),
                    llm_config=llm_config,
                    audit_recorder=trace.record if trace else None,
                ):
                    if event.get("type") == "delta":
                        final_parts.append(event.get("content") or "")
                    yield json.dumps(event, ensure_ascii=False) + "\n"
            except Exception as exc:
                error_text = str(exc)
                yield json.dumps({"type": "error", "message": str(exc)}, ensure_ascii=False) + "\n"
            finally:
                final_response = "".join(final_parts)
                if final_response and not error_text:
                    provider_mode = llm_config.get("mode") if isinstance(llm_config, dict) else "platform_default"
                    try:
                        user_service.record_llm_usage(
                            user["id"],
                            provider_mode=provider_mode,
                            provider=(llm_config or {}).get("provider") or "platform",
                            model=(llm_config or {}).get("model"),
                            daily_limit=current_daily_limit(),
                            metadata={"source": "legacy_chat_stream"},
                        )
                    except QuotaExceededError:
                        pass
                if trace:
                    trace.finish(
                        status="error" if error_text else "ok",
                        final_response=final_response,
                        error=error_text,
                    )

        return Response(
            stream_with_context(generate()),
            mimetype="application/x-ndjson; charset=utf-8",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.get("/api/professors")
    def professors():
        query = request.args.get("q", "")
        limit = request.args.get("limit", default=12, type=int)
        return jsonify({"cards": query_service.search_professors(query, limit)})

    @app.get("/api/courses/<path:course>")
    def course_professors(course):
        limit = request.args.get("limit", default=12, type=int)
        return jsonify(query_service.professors_for_course(course, limit))

    @app.get("/api/professors/<professor_id>/reviews")
    def professor_reviews(professor_id):
        course = request.args.get("course")
        limit = request.args.get("limit", default=8, type=int)
        return jsonify(query_service.professor_reviews(professor_id, course, limit))

    @app.post("/api/reviews/search")
    def review_search():
        payload = request.get_json(silent=True) or {}
        return jsonify(query_service.search_reviews_by_keywords(
            keywords=payload.get("keywords") or [],
            professor_numeric_id=payload.get("professor_numeric_id"),
            course_code=payload.get("course_code"),
            limit=int(payload.get("limit") or 20),
        ))

    @app.get("/api/changemajor")
    def changemajor():
        major = request.args.get("q") or request.args.get("major")
        college = request.args.get("college")
        search = request.args.get("search")
        limit = request.args.get("limit", default=5, type=int)
        return jsonify(changemajor_service.query_majors(
            major_name=major,
            college=college,
            search=search,
            limit=limit,
        ))

    @app.get("/api/majors/catalog")
    def major_catalog():
        return jsonify(changemajor_service.list_major_catalog())

    @app.post("/api/onboarding/format-context")
    def format_onboarding_context():
        user = require_user()
        if not isinstance(user, dict):
            return user
        payload = request.get_json(silent=True) or {}
        txt_context = TxtContextService()
        formatted_credit = format_credit_fallback(payload, txt_context)
        professional_summary = format_profile_summary_fallback(payload, formatted_credit)

        try:
            client, model = chat_service.client_and_model(current_llm_config(user["id"]))
            local_context = txt_context.search("AP IB credit UC Davis Advanced Placement International Baccalaureate", limit=3)
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You format UC Davis onboarding profile data. Use the supplied local AP/IB context "
                            "only as reference. Do not invent official credit. Return concise JSON with keys "
                            "formatted_credit_summary and professional_summary. professional_summary should be "
                            "formal, student-profile style, and include prior credit, placement, and personal context."
                        ),
                    },
                    {
                        "role": "user",
                        "content": json.dumps({
                            "profile": payload,
                            "local_ap_ib_context": local_context.get("matches", []),
                            "fallback_formatted_credit_summary": formatted_credit,
                            "fallback_professional_summary": professional_summary,
                        }, ensure_ascii=False),
                    },
                ],
                temperature=0.2,
            )
            parsed = json.loads(response.choices[0].message.content or "{}")
            formatted_credit = str(parsed.get("formatted_credit_summary") or formatted_credit).strip()
            professional_summary = str(parsed.get("professional_summary") or professional_summary).strip()
        except Exception:
            pass

        if payload.get("credits_only"):
            return jsonify({"formatted_credit_summary": formatted_credit})
        return jsonify({
            "formatted_credit_summary": formatted_credit,
            "professional_summary": professional_summary,
        })

    def current_user():
        user_id = current_user_id()
        if not user_id:
            return None
        return user_service.get_user_with_profile(user_id)

    def require_user(profile_required: bool = False):
        user = current_user()
        if not user:
            return jsonify({"error": "Authentication required"}), 401
        if profile_required and not user.get("profile_complete"):
            return jsonify({
                "error": "Student profile required",
                "profile_required": True,
            }), 428
        return user

    def current_encryption_key() -> str:
        return app.config.get("TEST_APP_ENCRYPTION_KEY") or app.config.get("APP_ENCRYPTION_KEY") or ""

    def current_daily_limit() -> int:
        return int(app.config.get("PLATFORM_DAILY_CHAT_LIMIT") or PLATFORM_DAILY_CHAT_LIMIT)

    def current_llm_config(user_id: int) -> dict:
        return user_service.llm_config_for_user(user_id, encryption_key=current_encryption_key())

    return app


def public_user(user: dict | None) -> dict | None:
    if not user:
        return None
    return {
        "id": user.get("id"),
        "email": user.get("email"),
        "name": user.get("name"),
        "picture": user.get("picture"),
    }


def format_credit_fallback(payload: dict, txt_context: TxtContextService | None = None) -> str:
    raw = str(payload.get("ap_ib_summary") or "").strip()
    if not raw:
        return "No AP, IB, or transfer credit reported."
    normalized = " ".join(raw.replace("\n", "; ").split())
    context_note = ""
    if txt_context:
        matches = txt_context.search(normalized, limit=1).get("matches") or []
        if matches:
            context_note = f" Local reference checked: {matches[0].get('title', 'UC Davis credit policy')}."
    return f"Student-reported prior credit for official verification: {normalized}.{context_note}"


def format_profile_summary_fallback(payload: dict, formatted_credit: str) -> str:
    prefs = payload.get("course_preferences") or {}
    lines = [
        "Student Profile Summary",
        f"Student stage: {payload.get('student_type') or 'Not specified'}",
        f"International student status: {payload.get('international_status') or 'Not specified'}",
        f"College: {payload.get('college') or 'Not specified'}",
        f"Current major: {payload.get('current_major') or 'Not specified'}",
        f"Target major: {payload.get('target_major') or 'Not specified'}",
        f"Timeline: {payload.get('entry_term') or 'Entry term unknown'} {payload.get('entry_year') or ''} to {payload.get('graduation_year') or 'graduation year unknown'}".strip(),
        f"Planning difficulty: {prefs.get('max_difficulty') or 'Not specified'}",
        f"Planning priority: {prefs.get('priority') or 'Not sure yet'}",
        f"Target units per quarter: {prefs.get('target_units') or 'Not specified'}",
        f"Prior credit: {formatted_credit}",
        f"Placement: {payload.get('placement_summary') or 'No placement details reported.'}",
        f"Student self-assessment: {prefs.get('self_assessment') or 'No self-assessment provided.'}",
    ]
    return "\n".join(lines)


app = create_app()


if __name__ == "__main__":
    app.run(debug=FLASK_DEBUG, port=WEB_PORT)
