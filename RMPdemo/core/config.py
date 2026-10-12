from pathlib import Path
import os


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'\"")
        if key and key not in os.environ:
            os.environ[key] = value


def env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def env_list(name: str) -> list[str]:
    value = os.environ.get(name, "")
    return [item.strip().rstrip("/") for item in value.split(",") if item.strip()]


MODERN_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = MODERN_ROOT
load_dotenv(PROJECT_ROOT / ".env")
DATA_ROOT = MODERN_ROOT / "data"
JSON_ROOT = DATA_ROOT / "json"
DB_ROOT = DATA_ROOT / "sqlite"
LOG_ROOT = Path(os.environ.get("PATHFINDER_LOG_ROOT", MODERN_ROOT / "logs"))
COURSE_DB_PATH = DB_ROOT / "courses.db"
CHANGEMAJOR_DB_PATH = DB_ROOT / "changemajor.db"
UCDAVIS_CALENDAR_DB_PATH = DB_ROOT / "ucdavis_calendar.db"
MAJORS_DB_PATH = DB_ROOT / "majors.db"

UC_DAVIS_SCHOOL_NUMERIC_ID = "1073"

LLM_API_KEY = os.environ.get("LLM_API_KEY", "").strip()
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "").strip()
LLM_MODEL = os.environ.get("LLM_MODEL", "").strip()

APP_ENV = os.environ.get("APP_ENV", os.environ.get("FLASK_ENV", "development")).strip().lower()
IS_PRODUCTION = APP_ENV == "production"
WEB_HOST = os.environ.get("WEB_HOST", "127.0.0.1")
WEB_PORT = env_int("WEB_PORT", 5050)
FLASK_DEBUG = env_bool("FLASK_DEBUG", not IS_PRODUCTION)
TRUST_PROXY = env_bool("TRUST_PROXY", IS_PRODUCTION)
ALLOWED_ORIGINS = env_list("ALLOWED_ORIGINS")
MAX_CONTENT_LENGTH = env_int("MAX_CONTENT_LENGTH", 64 * 1024)
MAX_MESSAGE_CHARS = env_int("MAX_MESSAGE_CHARS", 4000)
MAX_HISTORY_MESSAGES = env_int("MAX_HISTORY_MESSAGES", 20)
MAX_HISTORY_CHARS = env_int("MAX_HISTORY_CHARS", 30000)
RATE_LIMIT_WINDOW_SECONDS = env_int("RATE_LIMIT_WINDOW_SECONDS", 60)
RATE_LIMIT_MAX_REQUESTS = env_int("RATE_LIMIT_MAX_REQUESTS", 120)
CHAT_RATE_LIMIT_MAX_REQUESTS = env_int("CHAT_RATE_LIMIT_MAX_REQUESTS", 12)
BLOCK_BOT_USER_AGENTS = env_bool("BLOCK_BOT_USER_AGENTS", True)
AUDIT_LOG_ENABLED = env_bool("AUDIT_LOG_ENABLED", True)
AUDIT_LOG_MAX_VALUE_CHARS = env_int("AUDIT_LOG_MAX_VALUE_CHARS", 200000)

SECRET_KEY = os.environ.get("SECRET_KEY", "dev-change-me").strip()
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
GOOGLE_ALLOWED_DOMAIN = os.environ.get("GOOGLE_ALLOWED_DOMAIN", "ucdavis.edu").strip().lower()
APP_DB_PATH = Path(os.environ.get("APP_DB_PATH", DB_ROOT / "app.db"))
USER_DB_PATH = Path(os.environ.get("USER_DB_PATH", APP_DB_PATH))
APP_ENCRYPTION_KEY = os.environ.get("APP_ENCRYPTION_KEY", "").strip()
PLATFORM_DAILY_CHAT_LIMIT = env_int("PLATFORM_DAILY_CHAT_LIMIT", 15)
PLATFORM_QUOTA_TIMEZONE = os.environ.get("PLATFORM_QUOTA_TIMEZONE", "America/Los_Angeles").strip()
