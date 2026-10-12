package native

import (
	"strings"
	"testing"
)

func TestNormalizeUCDTerm(t *testing.T) {
	t.Parallel()
	tests := map[string]string{
		"202601":                      "202601",
		"Winter Quarter 2026":         "202601",
		"Winter Qtr 2026":             "202601",
		"Spring Semester 2026":        "202602",
		"Spring Sem 2026":             "202602",
		"Spring Quarter 2026":         "202603",
		"Spring Qtr 2026":             "202603",
		"Summer Session 1 2026":       "202605",
		"Sum Ses 1 2026":              "202605",
		"Summer Special Session 2026": "202606",
		"Sm Sp Ses 2026":              "202606",
		"Summer Session 2 2026":       "202607",
		"Sum Ses 2 2026":              "202607",
		"Summer Quarter 2026":         "202608",
		"Sum Qtr 2026":                "202608",
		"Fall Semester 2026":          "202609",
		"Fall Sem 2026":               "202609",
		"Fall Quarter 2026":           "202610",
		"Fall Qtr 2026":               "202610",
		"2026 Fall Quarter":           "202610",
		"2026-fall":                   "202610",
		"spring-2026":                 "202603",
		"2026 winter":                 "202601",
		"2026年秋季学期":                   "202610",
		"2026 秋季 Quarter":             "202610",
		"2026年春季学期":                   "202603",
		"2026年冬季学期":                   "202601",
		"2026年夏季第一期":                  "202605",
		"2026年夏季特殊学期":                 "202606",
		"2026年夏季第二期":                  "202607",
		"2026年夏季Quarter":              "202608",
		"2026年秋季Semester":             "202609",
	}
	for input, want := range tests {
		input, want := input, want
		t.Run(input, func(t *testing.T) {
			t.Parallel()
			got, err := normalizeUCDTerm(input)
			if err != nil || got != want {
				t.Fatalf("normalizeUCDTerm(%q) = %q, %v; want %q", input, got, err, want)
			}
		})
	}
}

func TestNormalizeUCDTermRejectsAmbiguousOrUnsupportedTerms(t *testing.T) {
	t.Parallel()
	tests := []struct {
		input   string
		message string
	}{
		{"Summer 2026", "ambiguous"},
		{"2026 夏季", "ambiguous"},
		{"202604", "unsupported"},
		{"202611", "unsupported"},
		{"Fall Quarter 26", "four-digit year"},
		{"", "term is required"},
	}
	for _, test := range tests {
		test := test
		t.Run(test.input, func(t *testing.T) {
			t.Parallel()
			_, err := normalizeUCDTerm(test.input)
			if err == nil || !strings.Contains(strings.ToLower(err.Error()), test.message) {
				t.Fatalf("normalizeUCDTerm(%q) error = %v; want message containing %q", test.input, err, test.message)
			}
		})
	}
}
