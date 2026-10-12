import re


SHORT_MAJOR_CODES = {
    "CS": "Computer Science",
    "CSE": "Computer Science & Engineering",
    "DS": "Data Science",
    "ECON": "Economics",
    "ECN": "Economics",
}


def normalize_major_query(query: str) -> str:
    text = " ".join((query or "").strip().split())
    return text.replace("B.S.", "Bachelor of Science").replace("B.A.", "Bachelor of Arts")


def tokenize_major_query(query: str) -> list[str]:
    normalized = normalize_major_query(query)
    return [token for token in re.split(r"[^A-Za-z0-9&]+", normalized) if token]


def build_major_search_variants(query: str) -> list[str]:
    normalized = normalize_major_query(query)
    if not normalized:
        return []

    variants = {normalized}
    upper = normalized.upper()
    if upper in SHORT_MAJOR_CODES:
        variants.add(SHORT_MAJOR_CODES[upper])

    if "Bachelor" not in normalized and "Minor" not in normalized:
        variants.add(f"{normalized} Bachelor")
        variants.add(f"{normalized} Bachelor of Science")
        variants.add(f"{normalized} Bachelor of Arts")

    return sorted(variants, key=lambda value: (len(value), value))


def build_change_major_keywords(query: str) -> list[str]:
    tokens = tokenize_major_query(query)
    if len(query.strip()) <= 3:
        return [query.strip().upper()]
    return tokens


def normalize_requirement_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "")
    return text.strip()
