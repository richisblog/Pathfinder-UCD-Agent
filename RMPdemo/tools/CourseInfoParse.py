import re
from dataclasses import dataclass


COURSE_RE = re.compile(r"^\s*([A-Za-z]+)\s*0*(\d+)([A-Za-z]*)\s*$")
SOURCE_RE = re.compile(r"^Source:\s*(https?://\S+)", re.MULTILINE)


@dataclass(frozen=True)
class CourseCode:
    department: str
    number: str
    suffix: str = ""

    @property
    def compact(self) -> str:
        return f"{self.department}{self.number}{self.suffix}"

    @property
    def spaced(self) -> str:
        return f"{self.department} {self.number}{self.suffix}"

    @property
    def padded_number(self) -> str:
        return self.number.zfill(3)

    @property
    def padded_spaced(self) -> str:
        return f"{self.department} {self.padded_number}{self.suffix}"

    @property
    def padded_compact(self) -> str:
        return f"{self.department}{self.padded_number}{self.suffix}"


def parse_course_code(course_input: str) -> CourseCode | None:
    match = COURSE_RE.match(course_input or "")
    if not match:
        return None
    department, number, suffix = match.groups()
    return CourseCode(department.upper(), str(int(number)), suffix.upper())


def normalize_course_code(course_input: str) -> str:
    course = parse_course_code(course_input)
    return course.spaced if course else " ".join((course_input or "").upper().split())


def course_code_variants(course_input: str) -> list[str]:
    course = parse_course_code(course_input)
    if not course:
        text = (course_input or "").strip().upper()
        return [text, text.replace(" ", "")] if text else []

    variants = {
        course.compact,
        course.spaced,
        course.padded_compact,
        course.padded_spaced,
    }
    return sorted(variants)


def compact_course_code(course_input: str) -> str:
    return normalize_course_code(course_input).replace(" ", "")


def parse_source_url(markdown_text: str) -> str:
    match = SOURCE_RE.search(markdown_text or "")
    return match.group(1).strip() if match else ""


def clean_catalog_markdown(markdown_text: str) -> str:
    lines = []
    previous_blank = False

    for raw_line in (markdown_text or "").splitlines():
        line = re.sub(r"^\s*#{3,}\s*", "", raw_line).replace("**", "").rstrip()
        blank = not line.strip()
        if blank and previous_blank:
            continue
        lines.append(line)
        previous_blank = blank

    return "\n".join(lines).strip()

