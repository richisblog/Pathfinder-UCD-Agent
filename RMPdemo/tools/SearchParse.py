import re
from dataclasses import dataclass

from .CourseInfoParse import parse_course_code
from .TextClean import normalize_whitespace


PROFESSOR_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+)+$")


@dataclass(frozen=True)
class SearchIntent:
    raw_query: str
    course_code: str | None = None
    professor_name: str | None = None
    keywords: list[str] | None = None


def parse_keywords(query: str, min_length: int = 2) -> list[str]:
    words = re.split(r"[^A-Za-z0-9]+", query or "")
    return [word for word in words if len(word) >= min_length]


def looks_like_professor_name(query: str) -> bool:
    return bool(PROFESSOR_NAME_RE.match(normalize_whitespace(query)))


def parse_search_intent(query: str) -> SearchIntent:
    cleaned = normalize_whitespace(query)
    course = parse_course_code(cleaned)
    professor_name = cleaned if looks_like_professor_name(cleaned) and not course else None

    return SearchIntent(
        raw_query=cleaned,
        course_code=course.spaced if course else None,
        professor_name=professor_name,
        keywords=parse_keywords(cleaned),
    )


def split_csv_terms(value: str | None) -> list[str]:
    return [item.strip() for item in (value or "").split(",") if item.strip()]

