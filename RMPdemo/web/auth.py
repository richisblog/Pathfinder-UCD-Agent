from typing import Any

from flask import current_app, redirect, request, session, url_for

from pathfinder_ucd_modern.core.config import GOOGLE_ALLOWED_DOMAIN


def is_allowed_student_email(email: str | None, allowed_domain: str = GOOGLE_ALLOWED_DOMAIN) -> bool:
    normalized = (email or "").strip().lower()
    domain = (allowed_domain or "ucdavis.edu").strip().lower().lstrip("@")
    return bool(normalized and normalized.endswith(f"@{domain}") and normalized.count("@") == 1)


def current_user_id() -> int | None:
    value = session.get("user_id")
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def login_user(user_id: int) -> None:
    session.clear()
    session["user_id"] = int(user_id)


def logout_user() -> None:
    session.clear()


def google_login_redirect():
    google = get_google_oauth_client()
    redirect_uri = url_for("google_callback", _external=True)
    return google.authorize_redirect(redirect_uri)


def google_callback_userinfo() -> dict[str, Any]:
    test_user = current_app.config.get("TEST_GOOGLE_USERINFO")
    if test_user is not None:
        return dict(test_user)

    google = get_google_oauth_client()
    token = google.authorize_access_token()
    userinfo = token.get("userinfo")
    if userinfo:
        return dict(userinfo)
    return dict(google.userinfo(token=token))


def get_google_oauth_client():
    try:
        from authlib.integrations.flask_client import OAuth
    except ImportError as exc:
        raise RuntimeError("Google login requires authlib. Install requirements.txt first.") from exc

    client_id = current_app.config.get("GOOGLE_CLIENT_ID")
    client_secret = current_app.config.get("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise RuntimeError("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured for Google login.")

    oauth = current_app.extensions.get("pathfinder_oauth")
    if not oauth:
        oauth = OAuth(current_app)
        current_app.extensions["pathfinder_oauth"] = oauth
    if not hasattr(oauth, "google"):
        oauth.register(
            name="google",
            client_id=client_id,
            client_secret=client_secret,
            authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
            access_token_url="https://oauth2.googleapis.com/token",
            userinfo_endpoint="https://openidconnect.googleapis.com/v1/userinfo",
            jwks_uri="https://www.googleapis.com/oauth2/v3/certs",
            client_kwargs={"scope": "openid email profile", "prompt": "select_account"},
        )
    return oauth.google


def login_redirect_target(default: str = "/") -> str:
    next_url = request.args.get("next") or request.form.get("next") or default
    if not isinstance(next_url, str) or not next_url.startswith("/"):
        return default
    return next_url
