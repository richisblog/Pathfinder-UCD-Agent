import re
from dataclasses import dataclass
from typing import Iterable


COURSE_WITH_DEPT_RE = re.compile(r"^\s*([A-Za-z]{2,6})\s*0*(\d{1,3})([A-Za-z]{0,3})\s*$")
COURSE_NUMBER_ONLY_RE = re.compile(r"^\s*0*(\d{1,3})([A-Za-z]{0,3})\s*$")

DEPT_ALIASES = {
    "MATH": "MAT",
    "CHEM": "CHE",
    "STAT": "STA",
    "ECON": "ECN",
    "POLI": "POL",
    "PSY": "PSC",
    "PSYC": "PSC",
    "BIO": "BIS",
}


@dataclass(frozen=True)
class ParsedCourseName:
    raw: str
    dept: str | None
    number: str
    suffix: str
    has_dept: bool

    @property
    def padded_number(self) -> str:
        return self.number.zfill(3)

    @property
    def number_key(self) -> str:
        return f"{self.padded_number}{self.suffix}"

    @property
    def base_number_key(self) -> str:
        return self.padded_number


@dataclass(frozen=True)
class NormalizedCourseName:
    raw: str
    normalized_course_code: str | None
    confidence: float
    method: str
    reason: str = ""


def parse_rmp_course_name(raw_course_name: str | None) -> ParsedCourseName | None:
    raw = (raw_course_name or "").strip().upper()
    if not raw:
        return None

    compact = re.sub(r"[\s_\-./]+", "", raw)
    match = COURSE_WITH_DEPT_RE.match(compact)
    if match:
        dept, number, suffix = match.groups()
        return ParsedCourseName(raw=raw, dept=canonical_dept(dept), number=str(int(number)), suffix=suffix, has_dept=True)

    match = COURSE_NUMBER_ONLY_RE.match(compact)
    if match:
        number, suffix = match.groups()
        return ParsedCourseName(raw=raw, dept=None, number=str(int(number)), suffix=suffix, has_dept=False)

    return None


def canonical_dept(dept: str) -> str:
    dept = (dept or "").upper().strip()
    return DEPT_ALIASES.get(dept, dept)


def canonical_course_code(dept: str, number_key: str) -> str:
    return f"{canonical_dept(dept)} {number_key}"


def build_explicit_number_index(parsed_courses: Iterable[ParsedCourseName], official_courses: set[tuple[str, str]]):
    index: dict[str, set[str]] = {}
    for parsed in parsed_courses:
        if not parsed.has_dept or not parsed.dept:
            continue
        index.setdefault(parsed.number_key, set()).add(parsed.dept)
    return index


def build_explicit_base_number_index(parsed_courses: Iterable[ParsedCourseName]):
    index: dict[str, set[str]] = {}
    for parsed in parsed_courses:
        if not parsed.has_dept or not parsed.dept:
            continue
        index.setdefault(parsed.base_number_key, set()).add(parsed.dept)
    return index


def normalize_explicit_course(parsed: ParsedCourseName, official_courses: set[tuple[str, str]]) -> NormalizedCourseName:
    if not parsed.dept:
        return NormalizedCourseName(parsed.raw, None, 0.0, "unresolved", "missing department")

    code = canonical_course_code(parsed.dept, parsed.number_key)
    if not official_courses:
        return NormalizedCourseName(parsed.raw, code, 0.80, "parsed_without_catalog")

    if (parsed.dept, parsed.number_key) in official_courses:
        return NormalizedCourseName(parsed.raw, code, 1.0, "official_exact")

    return NormalizedCourseName(parsed.raw, code, 0.45, "parsed_not_in_catalog", "course not found in official catalog")


def normalize_number_only_course(
    parsed: ParsedCourseName,
    explicit_number_index: dict[str, set[str]],
    explicit_base_number_index: dict[str, set[str]] | None = None,
) -> NormalizedCourseName:
    candidate_depts = explicit_number_index.get(parsed.number_key, set())
    if len(candidate_depts) == 1:
        dept = next(iter(candidate_depts))
        return NormalizedCourseName(
            parsed.raw,
            canonical_course_code(dept, parsed.number_key),
            0.90,
            "professor_context_unique",
        )

    if len(candidate_depts) > 1:
        return NormalizedCourseName(parsed.raw, None, 0.0, "ambiguous_number_only", f"candidate departments: {sorted(candidate_depts)}")

    base_candidate_depts = (explicit_base_number_index or {}).get(parsed.base_number_key, set())
    if len(base_candidate_depts) == 1:
        dept = next(iter(base_candidate_depts))
        return NormalizedCourseName(
            parsed.raw,
            canonical_course_code(dept, parsed.number_key),
            0.72,
            "professor_context_sequence",
        )

    if len(base_candidate_depts) > 1:
        return NormalizedCourseName(parsed.raw, None, 0.0, "ambiguous_number_sequence", f"candidate departments: {sorted(base_candidate_depts)}")

    return NormalizedCourseName(parsed.raw, None, 0.0, "unresolved_number_only", "no explicit course with same number for this professor")
