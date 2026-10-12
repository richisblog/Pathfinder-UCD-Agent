package tools

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
)

type TextService struct {
	dir string
}

func NewTextService(dir string) *TextService {
	return &TextService{dir: dir}
}

func (s *TextService) Search(query string, limit int) (TextSearchResult, error) {
	if limit <= 0 {
		limit = 4
	}
	if limit > 10 {
		limit = 10
	}
	terms := tokenize(query)
	var matches []TextMatch
	if len(terms) == 0 {
		return TextSearchResult{Query: query, Matches: matches}, nil
	}
	err := filepath.WalkDir(s.dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		source := d.Name()
		lower := strings.ToLower(source)
		if !strings.HasSuffix(lower, ".txt") && !strings.HasSuffix(lower, ".md") {
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		text := string(b)
		score := scoreText(text, terms)
		if score == 0 {
			return nil
		}
		matches = append(matches, TextMatch{
			Source:  source,
			Excerpt: excerpt(text, terms, 700),
			Score:   score,
		})
		return nil
	})
	if err != nil {
		return TextSearchResult{}, err
	}
	sort.Slice(matches, func(i, j int) bool {
		if matches[i].Score == matches[j].Score {
			return matches[i].Source < matches[j].Source
		}
		return matches[i].Score > matches[j].Score
	})
	if len(matches) > limit {
		matches = matches[:limit]
	}
	return TextSearchResult{Query: query, Matches: matches}, nil
}

func tokenize(s string) []string {
	parts := strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		if len([]rune(part)) < 2 || seen[part] {
			continue
		}
		seen[part] = true
		out = append(out, part)
	}
	return out
}

func scoreText(text string, terms []string) int {
	lower := strings.ToLower(text)
	score := 0
	for _, term := range terms {
		score += strings.Count(lower, term)
	}
	return score
}

func excerpt(text string, terms []string, limit int) string {
	if limit <= 0 {
		return ""
	}
	lower := strings.ToLower(text)
	first := -1
	for _, term := range terms {
		if idx := strings.Index(lower, term); idx >= 0 && (first == -1 || idx < first) {
			first = idx
		}
	}
	runes := []rune(text)
	if len(runes) <= limit {
		return strings.TrimSpace(text)
	}
	start := 0
	if first > 0 {
		prefixRunes := len([]rune(text[:first]))
		start = prefixRunes - limit/4
		if start < 0 {
			start = 0
		}
	}
	end := start + limit
	if end > len(runes) {
		end = len(runes)
		start = end - limit
		if start < 0 {
			start = 0
		}
	}
	out := strings.TrimSpace(string(runes[start:end]))
	if start > 0 {
		out = "..." + out
	}
	if end < len(runes) {
		out += "..."
	}
	return out
}
