import json
import sqlite3
from collections import defaultdict
from pathlib import Path

from pathfinder_ucd_modern.core.config import DB_ROOT, PROJECT_ROOT
from pathfinder_ucd_modern.tools.CourseNormalize import (
    NormalizedCourseName,
    build_explicit_base_number_index,
    build_explicit_number_index,
    normalize_explicit_course,
    normalize_number_only_course,
    parse_rmp_course_name,
)


RMP_DB_PATH = DB_ROOT / "rmp.db"
COURSES_DB_PATH = PROJECT_ROOT / "data" / "courses.db"


class CourseMergeService:
    def __init__(self, rmp_db_path: Path = RMP_DB_PATH, courses_db_path: Path = COURSES_DB_PATH):
        self.rmp_db_path = Path(rmp_db_path)
        self.courses_db_path = Path(courses_db_path)

    def merge_all_professor_courses(self) -> dict:
        official_courses = self.load_official_courses()
        conn = sqlite3.connect(self.rmp_db_path)
        conn.row_factory = sqlite3.Row
        try:
            self.ensure_schema(conn)
            professor_ids = [row["id"] for row in conn.execute("SELECT id FROM professors ORDER BY id")]

            stats = {
                "professors": len(professor_ids),
                "reviews_seen": 0,
                "reviews_normalized": 0,
                "aliases": 0,
                "professor_courses": 0,
            }

            for professor_id in professor_ids:
                professor_stats = self.merge_professor(conn, professor_id, official_courses)
                for key, value in professor_stats.items():
                    stats[key] += value

            conn.commit()
            return stats
        finally:
            conn.close()

    def merge_professor(self, conn, professor_id: str, official_courses: set[tuple[str, str]]) -> dict:
        rows = conn.execute(
            """
            SELECT review_id, course_name, quality_rating, difficulty_rating
            FROM reviews
            WHERE professor_id = ?
            """,
            (professor_id,),
        ).fetchall()

        parsed_by_review = []
        explicit_parsed = []
        for row in rows:
            parsed = parse_rmp_course_name(row["course_name"])
            parsed_by_review.append((row, parsed))
            if parsed and parsed.has_dept:
                explicit_parsed.append(parsed)

        explicit_number_index = build_explicit_number_index(explicit_parsed, official_courses)
        explicit_base_number_index = build_explicit_base_number_index(explicit_parsed)
        aliases: dict[str, dict] = {}
        course_groups: dict[str, dict] = {}
        reviews_seen = len(rows)
        reviews_normalized = 0

        for row, parsed in parsed_by_review:
            normalized = self.normalize(parsed, official_courses, explicit_number_index, explicit_base_number_index)
            if normalized.normalized_course_code:
                reviews_normalized += 1

            conn.execute(
                """
                UPDATE reviews
                SET normalized_course_code = ?,
                    course_normalization_confidence = ?,
                    course_normalization_method = ?
                WHERE review_id = ?
                """,
                (
                    normalized.normalized_course_code,
                    normalized.confidence,
                    normalized.method,
                    row["review_id"],
                ),
            )

            raw_name = row["course_name"] or ""
            alias_key = raw_name.strip()
            if alias_key:
                alias = aliases.setdefault(alias_key, {
                    "raw_course_name": alias_key,
                    "normalized_course_code": normalized.normalized_course_code,
                    "review_count": 0,
                    "confidence": normalized.confidence,
                    "method": normalized.method,
                })
                alias["review_count"] += 1
                alias["confidence"] = max(alias["confidence"], normalized.confidence)

            if normalized.normalized_course_code:
                group = course_groups.setdefault(normalized.normalized_course_code, {
                    "review_count": 0,
                    "quality_values": [],
                    "difficulty_values": [],
                    "raw_course_names": set(),
                })
                group["review_count"] += 1
                group["raw_course_names"].add(alias_key)
                if row["quality_rating"] is not None:
                    group["quality_values"].append(row["quality_rating"])
                if row["difficulty_rating"] is not None:
                    group["difficulty_values"].append(row["difficulty_rating"])

        conn.execute("DELETE FROM rmp_course_aliases WHERE professor_id = ?", (professor_id,))
        conn.execute("DELETE FROM professor_courses WHERE professor_id = ?", (professor_id,))

        for alias in aliases.values():
            conn.execute(
                """
                INSERT INTO rmp_course_aliases (
                    professor_id, raw_course_name, normalized_course_code,
                    review_count, confidence, method
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    professor_id,
                    alias["raw_course_name"],
                    alias["normalized_course_code"],
                    alias["review_count"],
                    alias["confidence"],
                    alias["method"],
                ),
            )

        for course_code, group in course_groups.items():
            conn.execute(
                """
                INSERT INTO professor_courses (
                    professor_id, normalized_course_code, display_course_name,
                    raw_course_names_json, review_count, avg_quality_rating,
                    avg_difficulty_rating
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    professor_id,
                    course_code,
                    course_code,
                    json.dumps(sorted(group["raw_course_names"]), ensure_ascii=False),
                    group["review_count"],
                    average(group["quality_values"]),
                    average(group["difficulty_values"]),
                ),
            )

        return {
            "reviews_seen": reviews_seen,
            "reviews_normalized": reviews_normalized,
            "aliases": len(aliases),
            "professor_courses": len(course_groups),
        }

    @staticmethod
    def normalize(parsed, official_courses, explicit_number_index, explicit_base_number_index) -> NormalizedCourseName:
        if not parsed:
            return NormalizedCourseName("", None, 0.0, "unparseable")
        if parsed.has_dept:
            return normalize_explicit_course(parsed, official_courses)
        return normalize_number_only_course(parsed, explicit_number_index, explicit_base_number_index)

    def load_official_courses(self) -> set[tuple[str, str]]:
        if not self.courses_db_path.exists():
            return set()
        conn = sqlite3.connect(self.courses_db_path)
        try:
            return {
                (row[0].upper(), row[1].upper())
                for row in conn.execute("SELECT dept_code, course_number FROM courses")
            }
        finally:
            conn.close()

    @staticmethod
    def ensure_schema(conn):
        existing_columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(reviews)")
        }
        for column, definition in {
            "normalized_course_code": "TEXT",
            "course_normalization_confidence": "REAL",
            "course_normalization_method": "TEXT",
        }.items():
            if column not in existing_columns:
                conn.execute(f"ALTER TABLE reviews ADD COLUMN {column} {definition}")

        conn.executescript("""
            CREATE TABLE IF NOT EXISTS rmp_course_aliases (
                professor_id TEXT NOT NULL,
                raw_course_name TEXT NOT NULL,
                normalized_course_code TEXT,
                review_count INTEGER NOT NULL,
                confidence REAL,
                method TEXT,
                PRIMARY KEY (professor_id, raw_course_name)
            );

            CREATE TABLE IF NOT EXISTS professor_courses (
                professor_id TEXT NOT NULL,
                normalized_course_code TEXT NOT NULL,
                display_course_name TEXT NOT NULL,
                raw_course_names_json TEXT NOT NULL,
                review_count INTEGER NOT NULL,
                avg_quality_rating REAL,
                avg_difficulty_rating REAL,
                PRIMARY KEY (professor_id, normalized_course_code)
            );

            CREATE INDEX IF NOT EXISTS idx_reviews_normalized_course_code
            ON reviews(normalized_course_code);

            CREATE INDEX IF NOT EXISTS idx_professor_courses_course
            ON professor_courses(normalized_course_code);
        """)


def average(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 3) if values else None
