import re
import sqlite3
from pathlib import Path
from typing import Any

from pathfinder_ucd_modern.core.config import COURSE_DB_PATH


COURSE_FIELDS = {
    "dept_code": "dept_code",
    "department": "dept_code",
    "course_number": "course_number",
    "number": "course_number",
    "title": "title",
    "units": "units",
    "description": "description",
    "prerequisites": "prerequisites",
    "prereqs": "prerequisites",
    "learning_activities": "learning_activities",
    "credit_limitations": "credit_limitations",
    "grade_mode": "grade_mode",
    "general_education": "general_education",
    "updated_at": "updated_at",
    "avg_rating": "avg_rating",
    "rating": "avg_rating",
    "avg_difficulty": "avg_difficulty",
    "difficulty": "avg_difficulty",
    "num_reviews": "num_reviews",
    "reviews": "num_reviews",
    "ge_AH": "ge_AH",
    "ge_SE": "ge_SE",
    "ge_SS": "ge_SS",
    "ge_ACGH": "ge_ACGH",
    "ge_DD": "ge_DD",
    "ge_OL": "ge_OL",
    "ge_QL": "ge_QL",
    "ge_SL": "ge_SL",
    "ge_VL": "ge_VL",
    "ge_WC": "ge_WC",
    "ge_WE": "ge_WE",
}

COURSE_SHORT_FIELDS = [
    "dept_code",
    "course_number",
    "title",
    "units",
    "prerequisites",
    "general_education",
    "avg_rating",
    "avg_difficulty",
    "num_reviews",
]

COURSE_LONG_FIELDS = [
    "description",
    "learning_activities",
    "credit_limitations",
    "grade_mode",
]

TEXT_FIELDS = ["dept_code", "course_number", "title", "description", "prerequisites", "general_education"]


class CourseDbQueryService:
    def __init__(self, db_path: Path = COURSE_DB_PATH):
        self.db_path = Path(db_path)

    def query_courses(
        self,
        course: str | None = None,
        filters: list[dict] | None = None,
        search: str | None = None,
        search_fields: list[str] | None = None,
        sort_by: str | None = None,
        sort_order: str = "asc",
        limit: int = 8,
        include_long_fields: bool = False,
    ) -> dict:
        filters = list(filters or [])
        parsed = parse_course_code(course)
        if parsed:
            dept, number = parsed
            filters.append({"field": "dept_code", "op": "exact", "value": dept})
            filters.append({"field": "course_number", "op": "exact", "value": number})

        params: list[Any] = []
        where_parts = []
        for item in filters:
            clause, clause_params = build_course_filter(item)
            if clause:
                where_parts.append(clause)
                params.extend(clause_params)

        if search:
            clauses = []
            for field in search_fields or TEXT_FIELDS:
                sql_field = COURSE_FIELDS.get(field)
                if not sql_field:
                    continue
                clauses.append(f"LOWER({sql_field}) LIKE ? ESCAPE '\\'")
                params.append(f"%{escape_like(str(search).lower())}%")
            if clauses:
                where_parts.append(f"({' OR '.join(clauses)})")

        requested_sort = sort_by or "dept_code"
        sort_field = COURSE_FIELDS.get(requested_sort, "dept_code")
        order = "DESC" if str(sort_order).lower() == "desc" else "ASC"
        limit = min(max(int(limit or 8), 1), 25)
        fields = COURSE_SHORT_FIELDS + (COURSE_LONG_FIELDS if include_long_fields else [])

        where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        sql = f"""
            SELECT {', '.join(fields)}
            FROM courses
            {where_sql}
            ORDER BY {sort_field} {order}, dept_code ASC, course_number ASC
            LIMIT ?
        """
        count_sql = f"SELECT COUNT(*) AS count FROM courses {where_sql}"

        conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            total_matches = conn.execute(count_sql, params).fetchone()["count"]
            rows = [compact_course_row(dict(row), include_long_fields) for row in conn.execute(sql, params + [limit]).fetchall()]
        finally:
            conn.close()

        return {
            "table": "courses",
            "course": normalize_course_label(course) if course else None,
            "filters": filters,
            "search": search,
            "sort_by": requested_sort,
            "sort_order": order.lower(),
            "limit": limit,
            "include_long_fields": include_long_fields,
            "total_matches": total_matches,
            "rows": rows,
        }


def parse_course_code(raw: str | None) -> tuple[str, str] | None:
    if not raw:
        return None
    match = re.search(r"(?<![A-Za-z0-9])([A-Za-z]{2,4})\s*0*(\d{1,3}[A-Za-z]{0,2})(?![A-Za-z0-9])", raw)
    if not match:
        return None
    dept, number = match.groups()
    num_match = re.match(r"(\d{1,3})([A-Za-z]{0,2})", number)
    if not num_match:
        return None
    digits, suffix = num_match.groups()
    return dept.upper(), f"{int(digits):03d}{suffix.upper()}"


def normalize_course_label(raw: str | None) -> str | None:
    parsed = parse_course_code(raw)
    if not parsed:
        return raw
    return f"{parsed[0]} {parsed[1]}"


def build_course_filter(item: dict) -> tuple[str | None, list[Any]]:
    field = str(item.get("field") or "").strip()
    op = str(item.get("op") or "contains").strip().lower()
    value = item.get("value")
    sql_field = COURSE_FIELDS.get(field)
    if not sql_field:
        return None, []

    if op in {"contains", "like", "fuzzy", "approx"}:
        return f"LOWER({sql_field}) LIKE ? ESCAPE '\\'", [f"%{escape_like(str(value).lower())}%"]
    if op in {"exact", "eq", "="}:
        return f"LOWER({sql_field}) = LOWER(?)", [str(value)]
    if op in {"startswith", "prefix"}:
        return f"LOWER({sql_field}) LIKE ? ESCAPE '\\'", [f"{escape_like(str(value).lower())}%"]
    if op in {"gt", ">"}:
        return f"{sql_field} > ?", [value]
    if op in {"gte", ">="}:
        return f"{sql_field} >= ?", [value]
    if op in {"lt", "<"}:
        return f"{sql_field} < ?", [value]
    if op in {"lte", "<="}:
        return f"{sql_field} <= ?", [value]
    if op == "between" and isinstance(value, list) and len(value) >= 2:
        return f"{sql_field} BETWEEN ? AND ?", [value[0], value[1]]
    if op == "in" and isinstance(value, list) and value:
        return f"{sql_field} IN ({', '.join(['?'] * len(value))})", list(value)
    if op == "is_null":
        return f"{sql_field} IS NULL", []
    if op == "not_null":
        return f"{sql_field} IS NOT NULL", []
    return None, []


def compact_course_row(row: dict, include_long_fields: bool) -> dict:
    row["course_code"] = f"{row.get('dept_code')} {row.get('course_number')}"
    for key in ["prerequisites", "general_education"]:
        row[key] = truncate(row.get(key), 320)
    if include_long_fields:
        for key in COURSE_LONG_FIELDS:
            row[key] = truncate(row.get(key), 520)
    return row


def truncate(value: Any, limit: int) -> Any:
    if value is None:
        return value
    text = str(value)
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
