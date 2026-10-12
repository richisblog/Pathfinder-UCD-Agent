from dataclasses import dataclass, field
from typing import Any

from .CourseInfoParse import course_code_variants


@dataclass
class SqlClause:
    sql: str
    params: list[Any] = field(default_factory=list)


def like_param(value: str) -> str:
    return f"%{value}%"


def or_like_clause(column: str, values: list[str], case_insensitive: bool = True) -> SqlClause:
    if not values:
        return SqlClause("1 = 1", [])

    operator = "LIKE"
    if case_insensitive:
        column_sql = f"LOWER({column})"
        params = [like_param(value.lower()) for value in values]
    else:
        column_sql = column
        params = [like_param(value) for value in values]

    return SqlClause(" OR ".join(f"{column_sql} {operator} ?" for _ in params), params)


def and_clauses(*clauses: SqlClause) -> SqlClause:
    active = [clause for clause in clauses if clause.sql]
    sql = " AND ".join(f"({clause.sql})" for clause in active) or "1 = 1"
    params = [param for clause in active for param in clause.params]
    return SqlClause(sql, params)


def course_match_clause(column: str, course_input: str) -> SqlClause:
    variants = course_code_variants(course_input)
    compact_variants = [variant.replace(" ", "") for variant in variants]
    direct = or_like_clause(column, variants)
    compact = or_like_clause(f"REPLACE({column}, ' ', '')", compact_variants)
    return SqlClause(f"({direct.sql}) OR ({compact.sql})", direct.params + compact.params)


def keyword_clause(column: str, keywords: list[str]) -> SqlClause:
    return or_like_clause(column, [keyword for keyword in keywords if keyword.strip()])


def select_only(sql: str) -> bool:
    return (sql or "").strip().upper().startswith("SELECT")


def limit_clause(limit: int | None, default: int = 50, maximum: int = 100) -> tuple[str, list[int]]:
    value = default if limit is None else min(max(int(limit), 1), maximum)
    return "LIMIT ?", [value]

