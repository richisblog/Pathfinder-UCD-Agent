import re
import sqlite3
from pathlib import Path
from typing import Any

from pathfinder_ucd_modern.core.config import MAJORS_DB_PATH


AMBIGUOUS_CHINESE_MAJOR_ALIASES = {
    "cs": ["Computer Science", "Computer Science & Engineering", "Computer Engineering"],
    "计算机": ["Computer Science", "Computer Science & Engineering", "Computer Engineering"],
    "计算机科学": ["Computer Science", "Computer Science & Engineering"],
    "生物": ["Biological Sciences", "Biochemistry & Molecular Biology", "Cell Biology"],
    "biology": ["Biological Sciences", "Biochemistry & Molecular Biology", "Cell Biology"],
    "数学": ["Mathematics", "Applied Mathematics"],
    "math": ["Mathematics", "Applied Mathematics"],
    "统计": ["Statistics", "Data Science"],
    "stats": ["Statistics", "Data Science"],
    "工程": ["Computer Engineering", "Electrical Engineering", "Mechanical Engineering", "Civil Engineering"],
}

HIGH_CONFIDENCE_CHINESE_MAJOR_ALIASES = {
    "计算机工程": "Computer Engineering",
    "计算机科学与工程": "Computer Science & Engineering",
    "数据科学": "Data Science",
    "经济": "Economics",
    "经济学": "Economics",
    "心理": "Psychology",
    "心理学": "Psychology",
    "认知科学": "Cognitive Science",
    "化学": "Chemistry",
    "应用化学": "Applied Chemistry",
    "物理": "Physics",
    "应用物理": "Applied Physics",
    "政治科学": "Political Science",
    "社会学": "Sociology",
    "英语": "English",
    "历史": "History",
    "设计": "Design",
    "商科": "Business",
    "商业": "Business",
}


class MajorCatalogService:
    """Query major catalog pages from majors.db and resolve cautious aliases."""

    def __init__(self, db_path: Path = MAJORS_DB_PATH):
        self.db_path = Path(db_path)

    def query_majors(
        self,
        major_name: str | None = None,
        search: str | None = None,
        degree_type: str | None = None,
        limit: int = 8,
        include_full_text: bool = False,
    ) -> dict[str, Any]:
        resolution = self.resolve_major_name(major_name or search)
        if resolution.get("needs_clarification"):
            return {
                "table": "majors",
                "major_name": major_name,
                "search": search,
                "needs_clarification": True,
                "clarification_prompt": resolution["clarification_prompt"],
                "candidates": resolution.get("candidates", []),
                "rows": [],
                "total_matches": 0,
            }

        effective_query = resolution.get("resolved_major") or major_name or search
        if resolution.get("resolved_major"):
            rows, total = self._query_exact_major(
                major_name=resolution["resolved_major"],
                degree_type=degree_type,
                limit=limit,
                include_full_text=include_full_text,
            )
        else:
            rows, total = self._query_rows(
                query=effective_query,
                degree_type=degree_type,
                limit=limit,
                include_full_text=include_full_text,
            )
        return {
            "table": "majors",
            "major_name": major_name,
            "search": search,
            "resolved_major": resolution.get("resolved_major"),
            "resolution_confidence": resolution.get("confidence"),
            "degree_type": degree_type,
            "limit": limit,
            "total_matches": total,
            "rows": rows,
        }

    def resolve_major_name(self, raw: str | None) -> dict[str, Any]:
        query = normalize_query(raw)
        if not query:
            return {"confidence": "none", "resolved_major": None}

        lowered = query.lower()
        if lowered in AMBIGUOUS_CHINESE_MAJOR_ALIASES:
            return clarification(query, AMBIGUOUS_CHINESE_MAJOR_ALIASES[lowered])
        if query in AMBIGUOUS_CHINESE_MAJOR_ALIASES:
            return clarification(query, AMBIGUOUS_CHINESE_MAJOR_ALIASES[query])
        if query in HIGH_CONFIDENCE_CHINESE_MAJOR_ALIASES:
            return {
                "confidence": "high",
                "resolved_major": HIGH_CONFIDENCE_CHINESE_MAJOR_ALIASES[query],
            }

        matches = self._name_matches(query)
        exact = [row for row in matches if row["major_name"].lower() == lowered]
        if exact:
            return {"confidence": "exact", "resolved_major": exact[0]["major_name"]}
        unique_names = sorted({row["major_name"] for row in matches})
        if len(unique_names) == 1:
            return {"confidence": "high", "resolved_major": unique_names[0]}
        if len(unique_names) > 1 and contains_cjk(query):
            return clarification(query, unique_names[:6])
        return {"confidence": "low", "resolved_major": query}

    def _name_matches(self, query: str) -> list[dict[str, Any]]:
        conn = self._connect()
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                """
                SELECT id, major_name, degree_type, filename
                FROM majors
                WHERE LOWER(major_name) LIKE ? ESCAPE '\\'
                ORDER BY major_name, degree_type
                LIMIT 12
                """,
                (f"%{escape_like(query.lower())}%",),
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def _query_rows(
        self,
        query: str | None,
        degree_type: str | None,
        limit: int,
        include_full_text: bool,
    ) -> tuple[list[dict[str, Any]], int]:
        clauses = []
        params: list[Any] = []
        if query:
            tokens = tokenize_query(query)
            token_clauses = []
            for token in tokens:
                pattern = f"%{escape_like(token.lower())}%"
                token_clauses.append("(LOWER(major_name) LIKE ? ESCAPE '\\' OR LOWER(full_text) LIKE ? ESCAPE '\\')")
                params.extend([pattern, pattern])
            if token_clauses:
                clauses.append(f"({' AND '.join(token_clauses)})")
        if degree_type:
            clauses.append("LOWER(degree_type) = LOWER(?)")
            params.append(degree_type)

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        limit = min(max(int(limit or 8), 1), 25)
        fields = ["id", "major_name", "degree_type", "filename", "full_text"]
        conn = self._connect()
        conn.row_factory = sqlite3.Row
        try:
            total = conn.execute(f"SELECT COUNT(*) AS count FROM majors {where_sql}", params).fetchone()["count"]
            rows = conn.execute(
                f"SELECT {', '.join(fields)} FROM majors {where_sql} ORDER BY major_name, degree_type LIMIT ?",
                params + [limit],
            ).fetchall()
            return [format_major_catalog_row(dict(row), include_full_text) for row in rows], total
        finally:
            conn.close()

    def _query_exact_major(
        self,
        major_name: str,
        degree_type: str | None,
        limit: int,
        include_full_text: bool,
    ) -> tuple[list[dict[str, Any]], int]:
        clauses = ["LOWER(major_name) = LOWER(?)"]
        params: list[Any] = [major_name]
        if degree_type:
            clauses.append("LOWER(degree_type) = LOWER(?)")
            params.append(degree_type)
        where_sql = f"WHERE {' AND '.join(clauses)}"
        limit = min(max(int(limit or 8), 1), 25)
        conn = self._connect()
        conn.row_factory = sqlite3.Row
        try:
            total = conn.execute(f"SELECT COUNT(*) AS count FROM majors {where_sql}", params).fetchone()["count"]
            rows = conn.execute(
                f"""
                SELECT id, major_name, degree_type, filename, full_text
                FROM majors
                {where_sql}
                ORDER BY major_name, degree_type
                LIMIT ?
                """,
                params + [limit],
            ).fetchall()
            return [format_major_catalog_row(dict(row), include_full_text) for row in rows], total
        finally:
            conn.close()

    def _connect(self):
        return sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True, timeout=10)


def clarification(query: str, candidates: list[str]) -> dict[str, Any]:
    return {
        "confidence": "ambiguous",
        "needs_clarification": True,
        "candidates": candidates,
        "clarification_prompt": (
            f"I am not fully sure which UC Davis major '{query}' refers to. "
            f"Please provide the English major name, or choose one of: {', '.join(candidates)}."
        ),
    }


def format_major_catalog_row(row: dict[str, Any], include_full_text: bool) -> dict[str, Any]:
    text = normalize_text(row.get("full_text") or "")
    row["summary"] = text[:900] + "..." if len(text) > 900 else text
    if include_full_text:
        row["full_text"] = text[:5000] + "..." if len(text) > 5000 else text
    else:
        row.pop("full_text", None)
    return row


def normalize_query(raw: str | None) -> str:
    return re.sub(r"\s+", " ", str(raw or "").strip())


def tokenize_query(query: str) -> list[str]:
    normalized = normalize_query(query)
    return [token for token in re.split(r"[^A-Za-z0-9&\u4e00-\u9fff]+", normalized) if token]


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def contains_cjk(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text or ""))


def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
