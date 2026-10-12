import re
from dataclasses import dataclass

from .CourseInfoParse import parse_source_url
from .TextClean import clean_markdown_text, normalize_whitespace


TITLE_RE = re.compile(r"^\s*#\s+(.+?)\s*$", re.MULTILINE)
SECTION_RE = re.compile(r"^\s*#{1,3}\s+(.+?)\s*$", re.MULTILINE)


@dataclass(frozen=True)
class CatalogDocument:
    title: str
    source_url: str
    full_text: str


def parse_catalog_title(markdown_text: str) -> str:
    match = TITLE_RE.search(markdown_text or "")
    return normalize_whitespace(match.group(1)) if match else ""


def parse_catalog_document(markdown_text: str, fallback_title: str = "") -> CatalogDocument:
    return CatalogDocument(
        title=parse_catalog_title(markdown_text) or fallback_title,
        source_url=parse_source_url(markdown_text),
        full_text=clean_markdown_text(markdown_text),
    )


def catalog_sections(markdown_text: str) -> list[str]:
    return [normalize_whitespace(match.group(1)) for match in SECTION_RE.finditer(markdown_text or "")]


def is_requirement_document(name: str) -> bool:
    text = (name or "").lower()
    return any(token in text for token in ["bachelor", "minor", "major", "degree"])


def search_variants_for_catalog(name: str) -> list[str]:
    cleaned = normalize_whitespace(name)
    variants = {cleaned}
    for suffix in [", Bachelor of Science", ", Bachelor of Arts", " Bachelor", " Minor"]:
        variants.add(cleaned.replace(suffix, ""))
    return sorted(value for value in variants if value)

