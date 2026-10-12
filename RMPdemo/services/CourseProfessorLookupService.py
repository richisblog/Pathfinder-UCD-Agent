import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from pathfinder_ucd_modern.core.config import DB_ROOT
from pathfinder_ucd_modern.tools.CourseNormalize import canonical_course_code, parse_rmp_course_name


RMP_DB_PATH = DB_ROOT / "rmp.db"


@dataclass(frozen=True)
class CourseProfessorResult:
    professor_id: str
    numeric_id: str
    professor_name: str
    department: str | None
    rmp_url: str | None
    professor_avg_rating: float | None
    professor_avg_difficulty: float | None
    professor_num_ratings: int | None
    normalized_course_code: str
    course_review_count: int
    course_avg_quality_rating: float | None
    course_avg_difficulty_rating: float | None
    raw_course_names: list[str]


class CourseProfessorLookupService:
    def __init__(self, rmp_db_path: Path = RMP_DB_PATH):
        self.rmp_db_path = Path(rmp_db_path)

    def find_professors_for_course(self, course_input: str, limit: int = 50) -> dict:
        parsed = parse_rmp_course_name(course_input)
        if not parsed:
            return {
                "query": course_input,
                "normalized_course_code": None,
                "status": "unparseable",
                "candidates": [],
                "professors": [],
            }

        if not parsed.has_dept:
            candidates = self.find_candidate_courses_by_number(parsed.number_key)
            return {
                "query": course_input,
                "normalized_course_code": None,
                "status": "needs_department",
                "candidates": candidates,
                "professors": [],
            }

        normalized_course_code = canonical_course_code(parsed.dept, parsed.number_key)
        return {
            "query": course_input,
            "normalized_course_code": normalized_course_code,
            "status": "ok",
            "candidates": [],
            "professors": [
                result.__dict__
                for result in self.query_professors(normalized_course_code, limit=limit)
            ],
        }

    def query_professors(self, normalized_course_code: str, limit: int = 50) -> list[CourseProfessorResult]:
        conn = sqlite3.connect(self.rmp_db_path)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                """
                SELECT
                    p.id AS professor_id,
                    p.numeric_id,
                    p.first_name,
                    p.last_name,
                    p.department,
                    p.rmp_url,
                    p.avg_rating AS professor_avg_rating,
                    p.avg_difficulty AS professor_avg_difficulty,
                    p.num_ratings AS professor_num_ratings,
                    pc.normalized_course_code,
                    pc.review_count AS course_review_count,
                    pc.avg_quality_rating AS course_avg_quality_rating,
                    pc.avg_difficulty_rating AS course_avg_difficulty_rating,
                    pc.raw_course_names_json
                FROM professor_courses pc
                JOIN professors p ON p.id = pc.professor_id
                WHERE pc.normalized_course_code = ?
                ORDER BY
                    pc.review_count DESC,
                    pc.avg_quality_rating DESC,
                    p.avg_rating DESC
                LIMIT ?
                """,
                (normalized_course_code, limit),
            ).fetchall()
        finally:
            conn.close()

        return [self.row_to_result(row) for row in rows]

    def find_candidate_courses_by_number(self, number_key: str, limit: int = 30) -> list[dict]:
        conn = sqlite3.connect(self.rmp_db_path)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                """
                SELECT
                    normalized_course_code,
                    COUNT(*) AS professor_count,
                    SUM(review_count) AS total_course_reviews
                FROM professor_courses
                WHERE normalized_course_code LIKE ?
                GROUP BY normalized_course_code
                ORDER BY total_course_reviews DESC, professor_count DESC
                LIMIT ?
                """,
                (f"% {number_key}", limit),
            ).fetchall()
        finally:
            conn.close()

        return [dict(row) for row in rows]

    @staticmethod
    def row_to_result(row) -> CourseProfessorResult:
        return CourseProfessorResult(
            professor_id=row["professor_id"],
            numeric_id=row["numeric_id"],
            professor_name=f"{row['first_name']} {row['last_name']}".strip(),
            department=row["department"],
            rmp_url=row["rmp_url"],
            professor_avg_rating=row["professor_avg_rating"],
            professor_avg_difficulty=row["professor_avg_difficulty"],
            professor_num_ratings=row["professor_num_ratings"],
            normalized_course_code=row["normalized_course_code"],
            course_review_count=row["course_review_count"],
            course_avg_quality_rating=row["course_avg_quality_rating"],
            course_avg_difficulty_rating=row["course_avg_difficulty_rating"],
            raw_course_names=json.loads(row["raw_course_names_json"] or "[]"),
        )

