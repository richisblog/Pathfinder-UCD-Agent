package governance

import "strings"

type Match struct {
	SOPID      string
	Confidence float64
	Reasons    []string
}

type MatchResult struct {
	Matches             []Match
	ActiveSOPs          []string
	UnsupportedConflict bool
	ReasonCodes         []string
}

// Match returns supported SOPs whose explicit intent phrases occur in text.
func (r Registry) Match(text string) MatchResult {
	normalized := strings.ToLower(strings.TrimSpace(text))
	if strings.Contains(normalized, "退课") || strings.Contains(normalized, "退掉") || strings.Contains(normalized, "加课") || strings.Contains(normalized, "drop class") || strings.Contains(normalized, "add class") {
		return MatchResult{
			Matches:    []Match{{SOPID: "add_drop_grading", Confidence: 0.75, Reasons: []string{"explicit_intent:add_drop_grading"}}},
			ActiveSOPs: []string{"add_drop_grading"},
		}
	}
	for _, phrase := range []string{"course description", "instructor", "course availability"} {
		if strings.Contains(normalized, phrase) {
			return MatchResult{
				Matches:    []Match{{SOPID: "course_information", Confidence: 0.75, Reasons: []string{"explicit_intent:course_information"}}},
				ActiveSOPs: []string{"course_information"},
			}
		}
	}
	return MatchResult{ReasonCodes: []string{"no_supported_sop"}}
}
