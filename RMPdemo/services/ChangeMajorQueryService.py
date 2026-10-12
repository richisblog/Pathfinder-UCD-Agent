import sqlite3
from collections import defaultdict
from pathlib import Path

from pathfinder_ucd_modern.core.config import CHANGEMAJOR_DB_PATH
from pathfinder_ucd_modern.tools.ChangeMajorParse import (
    build_change_major_keywords,
    build_major_search_variants,
    normalize_requirement_text,
)


MAJOR_FIELDS = {
    "id": "id",
    "full_name": "full_name",
    "major_code": "major_code",
    "college": "college",
    "college_en": "college_en",
    "description": "description",
    "search_keywords": "search_keywords",
}

SHORT_FIELDS = ["id", "full_name", "major_code", "college_en"]
ALL_FIELDS = ["id", "full_name", "major_code", "college", "college_en", "description", "search_keywords"]


class ChangeMajorQueryService:
    """Query the UC Davis Change-of-Major database (changemajor.db)."""

    def __init__(self, db_path: Path = CHANGEMAJOR_DB_PATH):
        self.db_path = Path(db_path)

    def _connect(self):
        return sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True, timeout=10)

    def query_majors(
        self,
        major_name: str | None = None,
        college: str | None = None,
        search: str | None = None,
        limit: int = 5,
    ) -> dict:
        """Search majors by name, college, or free-text keywords.

        Returns a dict with ``rows``, ``total_matches``, and metadata.
        """
        params: list[object] = []
        where_parts: list[str] = []

        # --- major name matching (uses build_major_search_variants for fuzzy) ---
        if major_name:
            exact_rows = self._exact_major_matches(major_name)
            if exact_rows:
                exact_names = [row["full_name"] for row in exact_rows]
                placeholders = ", ".join(["?"] * len(exact_names))
                where_parts.append(f"full_name IN ({placeholders})")
                params.extend(exact_names)
            else:
                variants = build_major_search_variants(major_name)
                keywords = build_change_major_keywords(major_name)
                all_terms = list(dict.fromkeys(variants + keywords))  # dedupe, keep order

                clauses: list[str] = []
                for term in all_terms:
                    escaped = _escape_like(term.lower())
                    clauses.append("LOWER(full_name) LIKE ? ESCAPE '\\'")
                    params.append(f"%{escaped}%")
                    clauses.append("LOWER(major_code) LIKE ? ESCAPE '\\'")
                    params.append(f"%{escaped}%")
                    clauses.append("LOWER(search_keywords) LIKE ? ESCAPE '\\'")
                    params.append(f"%{escaped}%")
                where_parts.append(f"({' OR '.join(clauses)})")

        # --- college filter ---
        if college:
            escaped_college = _escape_like(college.lower())
            where_parts.append(
                "(LOWER(college) LIKE ? ESCAPE '\\' OR LOWER(college_en) LIKE ? ESCAPE '\\')"
            )
            params.extend([f"%{escaped_college}%", f"%{escaped_college}%"])

        # --- free-text keyword search ---
        if search:
            search_terms = [t.strip() for t in search.split() if t.strip()]
            search_clauses: list[str] = []
            for term in search_terms:
                escaped = _escape_like(term.lower())
                search_clauses.append("LOWER(full_name) LIKE ? ESCAPE '\\'")
                params.append(f"%{escaped}%")
                search_clauses.append("LOWER(search_keywords) LIKE ? ESCAPE '\\'")
                params.append(f"%{escaped}%")
                search_clauses.append("LOWER(description) LIKE ? ESCAPE '\\'")
                params.append(f"%{escaped}%")
            where_parts.append(f"({' OR '.join(search_clauses)})")

        where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        limit = min(max(int(limit or 5), 1), 30)

        count_sql = f"SELECT COUNT(*) AS count FROM majors {where_sql}"
        select_sql = f"""
            SELECT {', '.join(ALL_FIELDS)}
            FROM majors
            {where_sql}
            ORDER BY full_name ASC
            LIMIT ?
        """

        conn = self._connect()
        conn.row_factory = sqlite3.Row
        try:
            total_matches = conn.execute(count_sql, params).fetchone()["count"]
            rows = [_format_major_row(dict(row)) for row in conn.execute(select_sql, params + [limit]).fetchall()]
        finally:
            conn.close()

        return {
            "table": "majors",
            "major_name": major_name,
            "college": college,
            "search": search,
            "limit": limit,
            "total_matches": total_matches,
            "rows": rows,
        }

    def _exact_major_matches(self, major_name: str) -> list[dict]:
        normalized = _normalize_major_name(major_name)
        conn = self._connect()
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                """
                SELECT full_name
                FROM majors
                WHERE LOWER(full_name) = LOWER(?)
                   OR LOWER(REPLACE(full_name, ' and ', ' & ')) = LOWER(?)
                   OR LOWER(REPLACE(full_name, ' & ', ' and ')) = LOWER(?)
                   OR UPPER(major_code) = UPPER(?)
                ORDER BY full_name
                """,
                (major_name, normalized, normalized, major_name),
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def get_major_detail(self, major_code: str) -> dict | None:
        """Get full details for a single major by its major_code."""
        conn = self._connect()
        conn.row_factory = sqlite3.Row
        try:
            row = conn.execute(
                f"SELECT {', '.join(ALL_FIELDS)} FROM majors WHERE UPPER(major_code) = UPPER(?)",
                (major_code,),
            ).fetchone()
        finally:
            conn.close()

        if not row:
            return None
        return _format_major_row(dict(row), include_full_description=True)

    def list_colleges(self) -> list[str]:
        """Return distinct college names (English)."""
        if not self.db_path.exists():
            return []
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT DISTINCT college_en FROM majors WHERE college_en IS NOT NULL ORDER BY college_en"
            ).fetchall()
        finally:
            conn.close()
        return [row[0] for row in rows]

    def list_major_catalog(self) -> dict:
        """Return all change-of-major majors grouped by college for profile UI pickers."""
        empty = {"colleges": [], "majors_by_college": {}, "total_majors": 0}
        if not self.db_path.exists():
            return empty

        conn = self._connect()
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                """
                SELECT full_name, major_code, college_en
                FROM majors
                WHERE full_name IS NOT NULL
                  AND college_en IS NOT NULL
                ORDER BY LOWER(college_en), LOWER(full_name)
                """
            ).fetchall()
        except sqlite3.Error:
            return empty
        finally:
            conn.close()

        grouped: dict[str, list[dict]] = defaultdict(list)
        for row in rows:
            item = {
                "full_name": row["full_name"],
                "major_code": row["major_code"],
                "college_en": row["college_en"],
            }
            grouped[row["college_en"]].append(item)

        colleges = sorted(grouped.keys(), key=str.casefold)
        majors_by_college = {
            college: sorted(grouped[college], key=lambda item: item["full_name"].casefold())
            for college in colleges
        }
        return {
            "colleges": colleges,
            "majors_by_college": majors_by_college,
            "total_majors": sum(len(items) for items in majors_by_college.values()),
        }


def _format_major_row(row: dict, include_full_description: bool = True) -> dict:
    """Clean up a major row for return to the caller."""
    if include_full_description:
        row["description"] = normalize_requirement_text(row.get("description") or "")
    else:
        desc = normalize_requirement_text(row.get("description") or "")
        row["description"] = desc[:300] + "..." if len(desc) > 300 else desc
    # Drop search_keywords from output (internal indexing field)
    row.pop("search_keywords", None)
    return row


def _normalize_major_name(value: str) -> str:
    return " ".join((value or "").replace("&", "and").split())


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
