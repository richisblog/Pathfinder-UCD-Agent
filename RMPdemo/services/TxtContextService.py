import math
import re
from pathlib import Path
from typing import Any

from pathfinder_ucd_modern.core.config import DATA_ROOT


class TxtContextService:
    def __init__(self, txt_root: Path | None = None):
        self.txt_root = txt_root or DATA_ROOT / "txt"

    def search(self, query: str, limit: int = 4) -> dict[str, Any]:
        query = (query or "").strip()
        if not query:
            return {"query": query, "matches": [], "count": 0}

        terms = self._query_terms(query)
        matches = []
        for path in self._source_paths():
            text = path.read_text(encoding="utf-8", errors="ignore")
            doc_name = self._display_name(path)
            for index, chunk in enumerate(self._chunks(text)):
                score = self._score(query, terms, doc_name, chunk)
                if score <= 0:
                    continue
                matches.append({
                    "source": path.name,
                    "title": doc_name,
                    "chunk_index": index,
                    "score": round(score, 3),
                    "text": chunk[:2400],
                })

        matches.sort(key=lambda item: item["score"], reverse=True)
        selected = matches[:max(1, int(limit or 4))]
        return {
            "query": query,
            "matches": selected,
            "count": len(selected),
            "total_matches": len(matches),
        }

    def _chunks(self, text: str) -> list[str]:
        sections = re.split(r"\n(?=#{1,4}\s+)", text)
        chunks = []
        for section in sections:
            section = section.strip()
            if not section:
                continue
            if len(section) <= 2600:
                chunks.append(section)
                continue
            lines = section.splitlines()
            current = []
            current_len = 0
            for line in lines:
                if current and current_len + len(line) > 2200:
                    chunks.append("\n".join(current).strip())
                    current = []
                    current_len = 0
                current.append(line)
                current_len += len(line) + 1
            if current:
                chunks.append("\n".join(current).strip())
        return chunks

    def _score(self, query: str, terms: list[str], doc_name: str, chunk: str) -> float:
        haystack = f"{doc_name}\n{chunk}".lower()
        query_lower = query.lower()
        score = 0.0
        for term in terms:
            if term in haystack:
                score += 1.0 + min(3, haystack.count(term)) * 0.25
        if query_lower in haystack:
            score += 3.0
        for alias, boost_terms in DOC_ALIASES.items():
            if any(term in query_lower for term in boost_terms) and alias in doc_name.lower():
                score += DOC_ALIAS_BOOSTS.get(alias, 5.0)
        return score / math.sqrt(max(1, len(chunk) / 800))

    def _query_terms(self, query: str) -> list[str]:
        words = re.findall(r"[A-Za-z0-9]+|[\u4e00-\u9fff]{2,}", query.lower())
        normalized = []
        for word in words:
            if word in STOP_WORDS or len(word) < 2:
                continue
            normalized.append(word)
        return sorted(set(normalized), key=len, reverse=True)

    def _display_name(self, path: Path) -> str:
        name = path.name
        while name.lower().endswith(".txt"):
            name = name[:-4]
        if name.lower().endswith(".md"):
            name = name[:-3]
        return name.replace("_", " ").strip()

    def _source_paths(self) -> list[Path]:
        candidates = []
        for pattern in ("*.txt", "*.txt.txt", "*.md"):
            candidates.extend(self.txt_root.glob(pattern))
        return sorted(set(candidates))


STOP_WORDS = {
    "about", "what", "when", "where", "which", "with", "does", "the", "and",
    "for", "can", "how", "into", "uc", "ucd", "ucdavis", "davis",
}

DOC_ALIASES = {
    "ap": ["ap", "advanced placement", "credit", "credits"],
    "ib": ["ib", "international baccalaureate", "credit", "credits"],
    "math placement": ["math placement", "mra", "math readiness", "placement", "honorlock"],
    "chemistry placement": ["chemistry placement", "chem placement", "placement"],
    "writing requirements": [
        "writing", "elwr", "entry level writing", "writing placement",
        "english composition", "uwp", "uwp 1", "uwp 7", "uwp 7m",
        "uwp 21", "uwp 22", "writing experience", "multilingual",
    ],
    "course selection policies": [
        "schedule builder", "pass one", "pass two", "waitlist", "waitlists",
        "drop", "add", "10-day", "20-day", "p/np", "pass no pass",
        "prerequisite", "registration", "unit cap", "full-time",
    ],
    "international student course planning": [
        "international", "f-1", "f1", "j-1", "j1", "siss", "visa",
        "i-20", "ds-2019", "reduced course load", "rcl", "online course",
        "full-time enrollment", "12 units",
    ],
    "ucdavis common resources index": [
        "myucdavis", "mybill", "canvas", "oasis", "assist", "advising",
        "financial aid", "student accounting", "housing", "dining",
        "transportation", "unitrans", "health", "counseling",
        "health-e-messaging", "immunization", "hold", "basic needs",
        "student disability", "servicehub", "career", "internship",
        "research", "police", "ossja", "where do i find",
        "petition", "petitions", "retroactive", "retroactive drop",
        "retroactive add", "general appeal", "late drop", "ptd", "pta",
        "readmission", "return to uc davis", "returning", "withdrawal",
        "pelp", "ferpa", "privacy", "student privacy", "education records",
        "conduct", "student conduct", "academic misconduct",
        "pass time", "pass times", "unit cap", "waitlist grace",
        "grace period", "course changes",
    ],
}

DOC_ALIAS_BOOSTS = {
    "ucdavis common resources index": 14.0,
}
