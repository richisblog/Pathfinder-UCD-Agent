import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from pathfinder_ucd_modern.core.config import UCDAVIS_CALENDAR_DB_PATH


class CalendarQueryService:
    def __init__(self, db_path: Path = UCDAVIS_CALENDAR_DB_PATH):
        self.db_path = Path(db_path)

    def query_events(
        self,
        query: str | None = None,
        term: str | None = None,
        academic_year: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        limit: int = 8,
        current_term: bool = False,
    ) -> dict[str, Any]:
        now = pacific_now()
        resolved_term = normalize_term(term)
        resolved_year = normalize_academic_year(academic_year)

        conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            if current_term and not (resolved_term and resolved_year):
                inferred = self.current_term(conn, now)
                if inferred:
                    resolved_year = resolved_year or inferred["academic_year"]
                    resolved_term = resolved_term or inferred["term"]

            if (
                is_holiday_query(query)
                and resolved_term
                and resolved_year
                and not date_from
                and not date_to
            ):
                bounds = self.term_bounds(conn, resolved_year, resolved_term)
                if bounds:
                    date_from = bounds["date_from"]
                    date_to = bounds["date_to"]

            rows, total = self._query_rows(
                conn=conn,
                query=query,
                term=resolved_term,
                academic_year=resolved_year,
                date_from=date_from,
                date_to=date_to,
                limit=limit,
            )
        finally:
            conn.close()

        return {
            "table": "calendar_events",
            "query": query,
            "term": resolved_term,
            "academic_year": resolved_year,
            "date_from": date_from,
            "date_to": date_to,
            "current_term": current_term,
            "current_time": now.strftime("%Y-%m-%d %H:%M:%S %Z"),
            "timezone": "America/Los_Angeles",
            "total_matches": total,
            "rows": rows,
        }

    def current_term(self, conn: sqlite3.Connection, now: datetime) -> dict[str, str] | None:
        now_text = now.strftime("%Y-%m-%d %H:%M:%S")
        terms = conn.execute(
            """
            SELECT academic_year, term,
                   MIN(CASE WHEN title = 'Quarter Begins' THEN start_datetime END) AS quarter_begin,
                   MAX(CASE WHEN title = 'Quarter Ends' THEN end_datetime END) AS quarter_end
            FROM calendar_events
            WHERE term IN ('Fall', 'Winter', 'Spring', 'Summer')
            GROUP BY academic_year, term
            HAVING quarter_begin IS NOT NULL AND quarter_end IS NOT NULL
            ORDER BY quarter_begin
            """
        ).fetchall()
        for item in terms:
            if item["quarter_begin"] <= now_text <= item["quarter_end"]:
                return {"academic_year": item["academic_year"], "term": item["term"]}

        upcoming = conn.execute(
            """
            SELECT academic_year, term, MIN(start_datetime) AS starts
            FROM calendar_events
            WHERE title = 'Quarter Begins'
              AND start_datetime >= ?
            GROUP BY academic_year, term
            ORDER BY starts
            LIMIT 1
            """,
            (now_text,),
        ).fetchone()
        if upcoming:
            return {"academic_year": upcoming["academic_year"], "term": upcoming["term"]}
        return None

    def term_bounds(
        self,
        conn: sqlite3.Connection,
        academic_year: str,
        term: str,
    ) -> dict[str, str] | None:
        row = conn.execute(
            """
            SELECT
                MIN(CASE WHEN title = 'Quarter Begins' THEN start_datetime END) AS quarter_begin,
                MAX(CASE WHEN title = 'Quarter Ends' THEN end_datetime END) AS quarter_end
            FROM calendar_events
            WHERE academic_year = ?
              AND LOWER(term) = LOWER(?)
            """,
            (academic_year, term),
        ).fetchone()
        if not row or not row["quarter_begin"] or not row["quarter_end"]:
            return None
        return {
            "date_from": row["quarter_begin"],
            "date_to": row["quarter_end"],
        }

    def _query_rows(
        self,
        conn: sqlite3.Connection,
        query: str | None,
        term: str | None,
        academic_year: str | None,
        date_from: str | None,
        date_to: str | None,
        limit: int,
    ) -> tuple[list[dict[str, Any]], int]:
        clauses = []
        params: list[Any] = []

        if query:
            query_clauses = []
            for token in expand_calendar_query(query):
                query_clauses.append("(LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(note) LIKE ? ESCAPE '\\' OR LOWER(source) LIKE ? ESCAPE '\\')")
                pattern = f"%{escape_like(token.lower())}%"
                params.extend([pattern, pattern, pattern])
            if query_clauses:
                clauses.append(f"({' OR '.join(query_clauses)})")
        if term:
            clauses.append("LOWER(term) = LOWER(?)")
            params.append(term)
        if academic_year:
            clauses.append("academic_year = ?")
            params.append(academic_year)
        if date_from:
            clauses.append("COALESCE(end_datetime, start_datetime) >= ?")
            params.append(normalize_date_bound(date_from, end=False))
        if date_to:
            clauses.append("COALESCE(start_datetime, end_datetime) <= ?")
            params.append(normalize_date_bound(date_to, end=True))

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        limit = min(max(int(limit or 8), 1), 30)
        count_sql = f"SELECT COUNT(*) AS count FROM calendar_events {where_sql}"
        sql = f"""
            SELECT source, source_url, academic_year, term, title, note,
                   original_date_text, start_datetime, end_datetime, timezone
            FROM calendar_events
            {where_sql}
            ORDER BY
                CASE WHEN start_datetime IS NULL THEN 1 ELSE 0 END,
                start_datetime ASC,
                academic_year ASC,
                term ASC,
                title ASC
            LIMIT ?
        """

        total = conn.execute(count_sql, params).fetchone()["count"]
        rows = [compact_calendar_row(dict(row)) for row in conn.execute(sql, params + [limit]).fetchall()]
        return rows, total


def pacific_now() -> datetime:
    utc_now = datetime.now(timezone.utc)
    tz = pacific_timezone_for_utc(utc_now)
    return utc_now.astimezone(tz)


def pacific_timezone_for_utc(utc_now: datetime) -> timezone:
    year = utc_now.year
    dst_start_local = second_sunday(year, 3).replace(hour=2)
    dst_end_local = first_sunday(year, 11).replace(hour=2)
    dst_start_utc = (dst_start_local + timedelta(hours=8)).replace(tzinfo=timezone.utc)
    dst_end_utc = (dst_end_local + timedelta(hours=7)).replace(tzinfo=timezone.utc)
    if dst_start_utc <= utc_now < dst_end_utc:
        return timezone(timedelta(hours=-7), "PDT")
    return timezone(timedelta(hours=-8), "PST")


def first_sunday(year: int, month: int) -> datetime:
    day = datetime(year, month, 1)
    days_until_sunday = (6 - day.weekday()) % 7
    return day + timedelta(days=days_until_sunday)


def second_sunday(year: int, month: int) -> datetime:
    return first_sunday(year, month) + timedelta(days=7)


def normalize_term(term: str | None) -> str | None:
    if not term:
        return None
    text = str(term).strip().lower()
    aliases = {
        "fall": "Fall",
        "autumn": "Fall",
        "winter": "Winter",
        "spring": "Spring",
        "summer": "Summer",
    }
    return aliases.get(text, str(term).strip().title())


def normalize_academic_year(value: str | None) -> str | None:
    if not value:
        return None
    text = str(value).strip()
    if len(text) == 4 and text.isdigit():
        start = int(text)
        return f"{start}-{start + 1}"
    return text


def expand_calendar_query(query: str) -> list[str]:
    text = str(query or "").strip()
    lowered = text.lower()
    tokens = [text]
    if "student fee payment deadline" in lowered:
        return ["Student Fee Payment Deadline"]
    if "holiday" in lowered:
        return ["Holiday"]
    if lowered == "quarter":
        return ["Quarter Begins", "Quarter Ends", "Finals Begin/End", "Instruction Begins"]
    if any(item in lowered for item in ["p/np", "pnp", "pass/no pass", "pass no pass"]):
        tokens.extend(["P/NP", "Opt for P/NP grading"])
    if any(item in lowered for item in ["deadline", "last day", "截止", "时间"]):
        tokens.extend(["Last day", "Deadline"])
    if any(item in lowered for item in ["drop", "退课"]):
        tokens.append("Drop")
    if any(item in lowered for item in ["add", "加课"]):
        tokens.append("add courses")
    return dedupe([token for token in tokens if token])


def compact_calendar_row(row: dict[str, Any]) -> dict[str, Any]:
    note = row.get("note")
    if note and len(str(note)) > 700:
        row["note"] = str(note)[:697].rstrip() + "..."
    return row


def is_holiday_query(query: str | None) -> bool:
    if not query:
        return False
    return "holiday" in str(query).lower()


def normalize_date_bound(value: str, end: bool) -> str:
    text = str(value).strip()
    if len(text) == 10:
        return f"{text} {'23:59:59' if end else '00:00:00'}"
    return text


def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def dedupe(items: list[str]) -> list[str]:
    seen = set()
    clean = []
    for item in items:
        key = item.lower()
        if key not in seen:
            seen.add(key)
            clean.append(item)
    return clean
