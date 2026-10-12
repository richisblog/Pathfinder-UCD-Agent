import re
from dataclasses import dataclass
from pathlib import Path

from .TextClean import normalize_whitespace


DEGREES = {
    "Bachelor of Science": "B.S.",
    "Bachelor of Arts": "B.A.",
}


@dataclass(frozen=True)
class MajorPdfInfo:
    major_name: str
    degree_type: str
    filename: str


def parse_major_pdf_filename(filename: str | Path) -> MajorPdfInfo:
    filename = Path(filename).name
    name = filename.removesuffix(".pdf").replace("_", " ")
    degree_type = "Unknown"

    for label, value in DEGREES.items():
        if label in name:
            name = name.replace(label, "")
            degree_type = value

    return MajorPdfInfo(
        major_name=normalize_whitespace(name),
        degree_type=degree_type,
        filename=filename,
    )


def clean_pdf_text(text: str | None) -> str:
    text = (text or "").replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_pdf_text(pdf_path: str | Path) -> str:
    import fitz

    with fitz.open(pdf_path) as doc:
        return clean_pdf_text("\n".join(page.get_text() for page in doc))

