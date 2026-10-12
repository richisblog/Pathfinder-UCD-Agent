import re
from html import unescape
from typing import Iterable


TOOL_STATUS_RE = re.compile(r"<div class=['\"]tool-status['\"]>.*?</div>", re.DOTALL)
FINAL_ANSWER_RE = re.compile(r"&lt;final_answer&gt;|<final_answer>", re.IGNORECASE)


def normalize_whitespace(text: str | None) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def normalize_line_breaks(text: str | None) -> str:
    return (text or "").replace("\r\n", "\n").replace("\r", "\n")


def strip_tool_status_html(text: str | None) -> str:
    return TOOL_STATUS_RE.sub("", text or "").strip()


def strip_final_answer_marker(text: str | None) -> str:
    if not text:
        return ""
    parts = FINAL_ANSWER_RE.split(text, maxsplit=1)
    return unescape(parts[-1]).strip()


def clean_review_comment(comment: str | None) -> str:
    return normalize_whitespace(normalize_line_breaks(comment))


def squeeze_blank_lines(lines: Iterable[str]) -> list[str]:
    output = []
    previous_blank = False
    for line in lines:
        blank = not line.strip()
        if not blank or not previous_blank:
            output.append(line)
        previous_blank = blank
    return output


def clean_markdown_text(markdown_text: str | None) -> str:
    lines = normalize_line_breaks(markdown_text).splitlines()
    cleaned = []
    for line in lines:
        line = re.sub(r"^\s*#{3,}\s*", "", line).replace("**", "").rstrip()
        cleaned.append(line)
    return "\n".join(squeeze_blank_lines(cleaned)).strip()


def truncate_text(text: str | None, limit: int, suffix: str = "...") -> str:
    text = text or ""
    if len(text) <= limit:
        return text
    return text[: max(0, limit - len(suffix))].rstrip() + suffix

