import json
import re
import sqlite3
from pathlib import Path

from pathfinder_ucd_modern.core.config import DB_ROOT
from pathfinder_ucd_modern.services.CourseProfessorLookupService import CourseProfessorLookupService


GENERIC_REVIEW_KEYWORDS = {
    "class",
    "course",
    "lecture",
    "lectures",
    "professor",
    "teacher",
    "student",
    "students",
    "physics",
    "english",
    "understand",
}


TABLE_CONFIG = {
    "professors": {
        "from": "professors p",
        "select": [
            "p.id",
            "p.numeric_id",
            "p.first_name",
            "p.last_name",
            "(p.first_name || ' ' || p.last_name) AS professor_name",
            "p.department",
            "p.school",
            "p.avg_rating",
            "p.num_ratings",
            "p.avg_difficulty",
            "p.would_take_again_percent",
            "p.rmp_url",
        ],
        "fields": {
            "id": "p.id",
            "numeric_id": "p.numeric_id",
            "first_name": "p.first_name",
            "last_name": "p.last_name",
            "professor_name": "(p.first_name || ' ' || p.last_name)",
            "name": "(p.first_name || ' ' || p.last_name)",
            "department": "p.department",
            "school": "p.school",
            "avg_rating": "p.avg_rating",
            "rating": "p.avg_rating",
            "num_ratings": "p.num_ratings",
            "reviews": "p.num_ratings",
            "avg_difficulty": "p.avg_difficulty",
            "difficulty": "p.avg_difficulty",
            "would_take_again_percent": "p.would_take_again_percent",
            "would_take_again": "p.would_take_again_percent",
        },
        "text_fields": ["professor_name", "first_name", "last_name", "department", "school"],
    },
    "reviews": {
        "from": "reviews r LEFT JOIN professors p ON p.id = r.professor_id",
        "select": [
            "r.review_id",
            "r.professor_id",
            "p.numeric_id AS professor_numeric_id",
            "(p.first_name || ' ' || p.last_name) AS professor_name",
            "p.department",
            "r.course_name",
            "r.normalized_course_code",
            "r.rating_tags",
            "r.difficulty_rating",
            "r.quality_rating",
            "r.comment",
            "r.date",
            "r.is_online",
            "r.is_for_credit",
            "r.attendance_mandatory",
            "r.textbook_used",
            "r.would_take_again",
            "r.grade",
            "r.course_normalization_confidence",
            "r.course_normalization_method",
        ],
        "fields": {
            "review_id": "r.review_id",
            "professor_id": "r.professor_id",
            "professor_numeric_id": "p.numeric_id",
            "professor_name": "(p.first_name || ' ' || p.last_name)",
            "name": "(p.first_name || ' ' || p.last_name)",
            "department": "p.department",
            "course_name": "r.course_name",
            "normalized_course_code": "r.normalized_course_code",
            "course": "r.normalized_course_code",
            "rating_tags": "r.rating_tags",
            "difficulty_rating": "r.difficulty_rating",
            "difficulty": "r.difficulty_rating",
            "quality_rating": "r.quality_rating",
            "quality": "r.quality_rating",
            "comment": "r.comment",
            "date": "r.date",
            "is_online": "r.is_online",
            "is_for_credit": "r.is_for_credit",
            "attendance_mandatory": "r.attendance_mandatory",
            "textbook_used": "r.textbook_used",
            "would_take_again": "r.would_take_again",
            "grade": "r.grade",
            "course_normalization_confidence": "r.course_normalization_confidence",
            "course_normalization_method": "r.course_normalization_method",
        },
        "text_fields": ["professor_name", "department", "course_name", "normalized_course_code", "rating_tags", "comment", "grade"],
    },
    "professor_courses": {
        "from": "professor_courses pc LEFT JOIN professors p ON p.id = pc.professor_id",
        "select": [
            "pc.professor_id",
            "p.numeric_id AS professor_numeric_id",
            "(p.first_name || ' ' || p.last_name) AS professor_name",
            "p.department",
            "pc.normalized_course_code",
            "pc.display_course_name",
            "pc.raw_course_names_json",
            "pc.review_count",
            "pc.avg_quality_rating",
            "pc.avg_difficulty_rating",
        ],
        "fields": {
            "professor_id": "pc.professor_id",
            "professor_numeric_id": "p.numeric_id",
            "professor_name": "(p.first_name || ' ' || p.last_name)",
            "name": "(p.first_name || ' ' || p.last_name)",
            "department": "p.department",
            "normalized_course_code": "pc.normalized_course_code",
            "course": "pc.normalized_course_code",
            "display_course_name": "pc.display_course_name",
            "raw_course_names_json": "pc.raw_course_names_json",
            "review_count": "pc.review_count",
            "reviews": "pc.review_count",
            "avg_quality_rating": "pc.avg_quality_rating",
            "quality": "pc.avg_quality_rating",
            "avg_difficulty_rating": "pc.avg_difficulty_rating",
            "difficulty": "pc.avg_difficulty_rating",
        },
        "text_fields": ["professor_name", "department", "normalized_course_code", "display_course_name", "raw_course_names_json"],
    },
}


class RmpQueryService:
    def __init__(self, db_path: Path = DB_ROOT / "rmp.db"):
        self.db_path = Path(db_path)
        self.course_lookup = CourseProfessorLookupService(self.db_path)

    def search_professors(self, query: str, limit: int = 12) -> list[dict]:
        wildcard = f"%{query.strip()}%"
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                """
                SELECT id, numeric_id, first_name, last_name, department, avg_rating,
                       avg_difficulty, num_ratings, would_take_again_percent, rmp_url
                FROM professors
                WHERE first_name LIKE ?
                   OR last_name LIKE ?
                   OR (first_name || ' ' || last_name) LIKE ?
                   OR department LIKE ?
                ORDER BY num_ratings DESC, avg_rating DESC
                LIMIT ?
                """,
                (wildcard, wildcard, wildcard, wildcard, limit),
            ).fetchall()
        finally:
            conn.close()

        return [professor_card(dict(row)) for row in rows]

    def professors_for_course(self, course: str, limit: int = 12) -> dict:
        result = self.course_lookup.find_professors_for_course(course, limit=limit)
        cards = [course_professor_card(item) for item in result.get("professors", [])]
        return {
            "status": result["status"],
            "query": result["query"],
            "normalized_course_code": result["normalized_course_code"],
            "candidates": result["candidates"],
            "cards": cards,
        }

    def professor_reviews(self, professor_numeric_id: str, course_code: str | None = None, limit: int = 8) -> dict:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            professor = conn.execute(
                """
                SELECT id, numeric_id, first_name, last_name, department, avg_rating,
                       avg_difficulty, num_ratings, rmp_url
                FROM professors
                WHERE numeric_id = ? OR id = ?
                """,
                (professor_numeric_id, professor_numeric_id),
            ).fetchone()
            if not professor:
                return {"professor": None, "reviews": [], "cards": []}

            params = [professor["id"]]
            course_filter = ""
            if course_code:
                course_filter = "AND normalized_course_code = ?"
                params.append(course_code)
            params.append(limit)

            reviews = conn.execute(
                f"""
                SELECT review_id, course_name, normalized_course_code, quality_rating,
                       difficulty_rating, rating_tags, grade, date, comment
                FROM reviews
                WHERE professor_id = ?
                {course_filter}
                ORDER BY date DESC
                LIMIT ?
                """,
                params,
            ).fetchall()
        finally:
            conn.close()

        prof = dict(professor)
        return {
            "professor": professor_card(prof),
            "reviews": [dict(row) for row in reviews],
            "cards": [review_card(dict(row), prof) for row in reviews],
        }

    def search_reviews_by_keywords(
        self,
        keywords: list[str],
        professor_numeric_id: str | None = None,
        course_code: str | None = None,
        limit: int = 20,
    ) -> dict:
        clean_keywords = normalize_keywords(keywords)
        if not clean_keywords:
            return {
                "searched_keywords": [],
                "total_matches": 0,
                "read_count": 0,
                "reviews": [],
                "cards": [],
            }

        requested_limit = max(int(limit or 20), 20)
        where_parts = ["r.comment IS NOT NULL", "TRIM(r.comment) <> ''"]
        params: list[object] = []

        keyword_clauses = []
        for keyword in clean_keywords:
            keyword_clauses.append("LOWER(r.comment) LIKE ? ESCAPE '\\'")
            params.append(f"%{escape_like(keyword.lower())}%")
        where_parts.append(f"({' OR '.join(keyword_clauses)})")

        if professor_numeric_id:
            where_parts.append("(p.numeric_id = ? OR p.id = ?)")
            params.extend([professor_numeric_id, professor_numeric_id])

        normalized_course = normalize_course_filter(course_code)
        if normalized_course:
            where_parts.append("r.normalized_course_code = ?")
            params.append(normalized_course)

        where_sql = " AND ".join(where_parts)

        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            total_matches = conn.execute(
                f"""
                SELECT COUNT(*) AS count
                FROM reviews r
                JOIN professors p ON p.id = r.professor_id
                WHERE {where_sql}
                """,
                params,
            ).fetchone()["count"]

            read_count = min(requested_limit, total_matches)
            if read_count == 0:
                return {
                    "searched_keywords": clean_keywords,
                    "total_matches": 0,
                    "read_count": 0,
                    "reviews": [],
                    "cards": [],
                }

            score_sql = " + ".join(["CASE WHEN LOWER(r.comment) LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END" for _ in clean_keywords])
            score_params = [f"%{escape_like(keyword.lower())}%" for keyword in clean_keywords]
            candidate_limit = min(max(read_count * 6, 120), 1000)
            rows = conn.execute(
                f"""
                SELECT r.review_id, r.professor_id, r.course_name, r.normalized_course_code,
                       r.quality_rating, r.difficulty_rating, r.rating_tags, r.grade,
                       r.date, r.comment,
                       p.id AS professor_id_internal, p.numeric_id, p.first_name, p.last_name,
                       p.department, p.avg_rating, p.avg_difficulty, p.num_ratings, p.rmp_url,
                       ({score_sql}) AS keyword_term_hits
                FROM reviews r
                JOIN professors p ON p.id = r.professor_id
                WHERE {where_sql}
                ORDER BY keyword_term_hits DESC, r.quality_rating DESC, r.date DESC
                LIMIT ?
                """,
                score_params + params + [candidate_limit],
            ).fetchall()
        finally:
            conn.close()

        ranked = []
        for row in rows:
            item = dict(row)
            matched_keywords = keywords_found(item.get("comment") or "", clean_keywords)
            item["matched_keywords"] = matched_keywords
            item["match_score"] = score_comment(item.get("comment") or "", clean_keywords)
            ranked.append(item)
        ranked.sort(key=lambda item: (item["match_score"], item.get("quality_rating") or 0), reverse=True)
        selected = ranked[:read_count]

        cards = []
        for row in selected:
            professor = {
                "id": row.get("professor_id_internal"),
                "numeric_id": row.get("numeric_id"),
                "first_name": row.get("first_name"),
                "last_name": row.get("last_name"),
                "department": row.get("department"),
                "avg_rating": row.get("avg_rating"),
                "avg_difficulty": row.get("avg_difficulty"),
                "num_ratings": row.get("num_ratings"),
                "rmp_url": row.get("rmp_url"),
            }
            review = {
                "review_id": row.get("review_id"),
                "professor_id": row.get("professor_id"),
                "course_name": row.get("course_name"),
                "normalized_course_code": row.get("normalized_course_code"),
                "quality_rating": row.get("quality_rating"),
                "difficulty_rating": row.get("difficulty_rating"),
                "rating_tags": row.get("rating_tags"),
                "grade": row.get("grade"),
                "date": row.get("date"),
                "comment": row.get("comment"),
                "matched_keywords": row.get("matched_keywords"),
                "match_score": row.get("match_score"),
                "professor_numeric_id": row.get("numeric_id"),
                "professor_name": f"{row.get('first_name') or ''} {row.get('last_name') or ''}".strip(),
            }
            cards.append(review_card(review, professor))

        return {
            "searched_keywords": clean_keywords,
            "total_matches": total_matches,
            "read_count": len(selected),
            "course_filter": normalized_course,
            "professor_filter": professor_numeric_id,
            "reviews": [
                {
                    "review_id": row.get("review_id"),
                    "professor": f"{row.get('first_name') or ''} {row.get('last_name') or ''}".strip(),
                    "professor_numeric_id": row.get("numeric_id"),
                    "course_name": row.get("course_name"),
                    "normalized_course_code": row.get("normalized_course_code"),
                    "quality_rating": row.get("quality_rating"),
                    "difficulty_rating": row.get("difficulty_rating"),
                    "date": row.get("date"),
                    "grade": row.get("grade"),
                    "matched_keywords": row.get("matched_keywords"),
                    "match_score": row.get("match_score"),
                    "comment": row.get("comment"),
                }
                for row in selected
            ],
            "cards": cards,
        }

    def query_rmp_table(
        self,
        table: str,
        filters: list[dict] | None = None,
        search: str | None = None,
        search_fields: list[str] | None = None,
        sort_by: str | None = None,
        sort_order: str = "desc",
        limit: int = 20,
    ) -> dict:
        table = (table or "").strip()
        if table not in TABLE_CONFIG:
            return {"error": f"Unsupported table: {table}", "rows": [], "cards": []}

        config = TABLE_CONFIG[table]
        params: list[object] = []
        where_parts = []

        for item in filters or []:
            clause, clause_params = build_filter_clause(config, item)
            if clause:
                where_parts.append(clause)
                params.extend(clause_params)

        if search:
            fields = search_fields or config["text_fields"]
            clauses = []
            for field in fields:
                sql_field = config["fields"].get(field)
                if not sql_field:
                    continue
                clauses.append(f"LOWER({sql_field}) LIKE ? ESCAPE '\\'")
                params.append(f"%{escape_like(str(search).lower())}%")
            if clauses:
                where_parts.append(f"({' OR '.join(clauses)})")

        requested_sort = sort_by or default_sort_field(table)
        sort_field = config["fields"].get(requested_sort)
        if not sort_field:
            requested_sort = default_sort_field(table)
            sort_field = config["fields"][requested_sort]
        order = "ASC" if str(sort_order).lower() == "asc" else "DESC"
        where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        limit = min(max(int(limit or 20), 1), 100)

        sql = f"""
            SELECT {', '.join(config['select'])}
            FROM {config['from']}
            {where_sql}
            ORDER BY {sort_field} {order}
            LIMIT ?
        """

        count_sql = f"""
            SELECT COUNT(*) AS count
            FROM {config['from']}
            {where_sql}
        """

        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            total_matches = conn.execute(count_sql, params).fetchone()["count"]
            rows = [dict(row) for row in conn.execute(sql, params + [limit]).fetchall()]
        finally:
            conn.close()

        cards = rows_to_cards(table, rows)
        return {
            "table": table,
            "filters": filters or [],
            "search": search,
            "search_fields": search_fields or config["text_fields"],
            "sort_by": requested_sort,
            "sort_order": order.lower(),
            "limit": limit,
            "total_matches": total_matches,
            "rows": rows,
            "cards": cards,
        }

    def card_context_summary(self, cards: list[dict]) -> str:
        if not cards:
            return ""
        compact = []
        for card in cards[:8]:
            compact.append({
                "type": card.get("type"),
                "title": card.get("title"),
                "subtitle": card.get("subtitle"),
                "metrics": card.get("metrics"),
                "data": card.get("data"),
            })
        return json.dumps(compact, ensure_ascii=False)


def professor_card(row: dict) -> dict:
    name = f"{row.get('first_name') or ''} {row.get('last_name') or ''}".strip()
    return {
        "id": f"professor:{row.get('numeric_id')}",
        "type": "professor",
        "title": name,
        "subtitle": row.get("department") or "UC Davis",
        "metrics": [
            {"label": "Rating", "value": value(row.get("avg_rating"))},
            {"label": "Difficulty", "value": value(row.get("avg_difficulty"))},
            {"label": "Reviews", "value": row.get("num_ratings") or 0},
        ],
        "data": {
            "professor_id": row.get("id"),
            "numeric_id": row.get("numeric_id"),
            "rmp_url": row.get("rmp_url"),
            "would_take_again_percent": row.get("would_take_again_percent"),
        },
    }


def course_professor_card(item: dict) -> dict:
    return {
        "id": f"course-professor:{item['normalized_course_code']}:{item['numeric_id']}",
        "type": "course_professor",
        "title": item["professor_name"],
        "subtitle": item["normalized_course_code"],
        "metrics": [
            {"label": "Course reviews", "value": item["course_review_count"]},
            {"label": "Course quality", "value": value(item["course_avg_quality_rating"])},
            {"label": "Course difficulty", "value": value(item["course_avg_difficulty_rating"])},
            {"label": "Overall", "value": value(item["professor_avg_rating"])},
        ],
        "data": item,
    }


def review_card(row: dict, professor: dict) -> dict:
    professor_name = f"{professor.get('first_name') or ''} {professor.get('last_name') or ''}".strip()
    return {
        "id": f"review:{row.get('review_id')}",
        "type": "review",
        "title": professor_name,
        "subtitle": row.get("normalized_course_code") or row.get("course_name") or "Review",
        "metrics": [
            {"label": "Quality", "value": value(row.get("quality_rating"))},
            {"label": "Difficulty", "value": value(row.get("difficulty_rating"))},
            {"label": "Grade", "value": row.get("grade") or "N/A"},
        ],
        "body": row.get("comment") or "",
        "data": row,
    }


def rows_to_cards(table: str, rows: list[dict]) -> list[dict]:
    if table == "professors":
        return [professor_card(row) for row in rows]
    if table == "reviews":
        cards = []
        for row in rows:
            first_name, last_name = split_name(row.get("professor_name") or "")
            professor = {
                "id": row.get("professor_id"),
                "numeric_id": row.get("professor_numeric_id"),
                "first_name": first_name,
                "last_name": last_name,
                "department": row.get("department"),
            }
            cards.append(review_card(row, professor))
        return cards
    if table == "professor_courses":
        return [course_professor_card({
            "normalized_course_code": row.get("normalized_course_code"),
            "numeric_id": row.get("professor_numeric_id"),
            "professor_name": row.get("professor_name"),
            "course_review_count": row.get("review_count"),
            "course_avg_quality_rating": row.get("avg_quality_rating"),
            "course_avg_difficulty_rating": row.get("avg_difficulty_rating"),
            "professor_avg_rating": None,
            **row,
        }) for row in rows]
    return []


def split_name(name: str) -> tuple[str, str]:
    parts = str(name or "").strip().split()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def build_filter_clause(config: dict, item: dict) -> tuple[str | None, list[object]]:
    field = str(item.get("field") or "").strip()
    op = str(item.get("op") or "contains").strip().lower()
    value = item.get("value")
    sql_field = config["fields"].get(field)
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
        placeholders = ", ".join(["?"] * len(value))
        return f"{sql_field} IN ({placeholders})", list(value)
    if op == "is_null":
        return f"{sql_field} IS NULL", []
    if op == "not_null":
        return f"{sql_field} IS NOT NULL", []
    return None, []


def default_sort_field(table: str) -> str:
    defaults = {
        "professors": "num_ratings",
        "reviews": "date",
        "professor_courses": "review_count",
    }
    return defaults.get(table, "id")


def value(raw):
    if raw is None:
        return "N/A"
    if isinstance(raw, float):
        return round(raw, 2)
    return raw


def normalize_keywords(keywords: list[str]) -> list[str]:
    seen = set()
    clean = []
    for raw in keywords or []:
        for keyword in re.split(r"[,;/|]+", str(raw)):
            keyword = re.sub(r"\s+", " ", keyword).strip().lower()
            if len(keyword) < 2 or keyword in seen:
                continue
            if keyword in GENERIC_REVIEW_KEYWORDS:
                continue
            seen.add(keyword)
            clean.append(keyword)
            if len(clean) >= 12:
                return clean
    return clean


def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def normalize_course_filter(course_code: str | None) -> str | None:
    if not course_code:
        return None
    compact = re.sub(r"[\s_\-./]+", "", course_code.strip().upper())
    match = re.match(r"^([A-Z]{2,6})0*(\d{1,3})([A-Z]{0,3})$", compact)
    if not match:
        return course_code.strip().upper()
    dept, number, suffix = match.groups()
    return f"{dept} {number.zfill(3)}{suffix}"


def keywords_found(comment: str, keywords: list[str]) -> list[str]:
    lower = comment.lower()
    return [keyword for keyword in keywords if keyword in lower]


def score_comment(comment: str, keywords: list[str]) -> int:
    lower = comment.lower()
    score = 0
    for keyword in keywords:
        hits = lower.count(keyword)
        if hits:
            score += 5 + min(hits, 8)
    return score
