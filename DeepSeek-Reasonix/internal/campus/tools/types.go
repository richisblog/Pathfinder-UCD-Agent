package tools

type CourseQuery struct {
	Course            string   `json:"course,omitempty"`
	Filters           []Filter `json:"filters,omitempty"`
	Search            string   `json:"search,omitempty"`
	SearchFields      []string `json:"search_fields,omitempty"`
	SortBy            string   `json:"sort_by,omitempty"`
	SortOrder         string   `json:"sort_order,omitempty"`
	Limit             int      `json:"limit,omitempty"`
	IncludeLongFields bool     `json:"include_long_fields,omitempty"`
}

type Filter struct {
	Field string `json:"field"`
	Op    string `json:"op"`
	Value any    `json:"value,omitempty"`
}

type QueryResult struct {
	Table        string           `json:"table"`
	TotalMatches int              `json:"total_matches"`
	Rows         []map[string]any `json:"rows"`
	Query        any              `json:"query,omitempty"`
	Error        string           `json:"error,omitempty"`
}

type TextSearchResult struct {
	Query   string      `json:"query"`
	Matches []TextMatch `json:"matches"`
}

type TextMatch struct {
	Source  string `json:"source"`
	Excerpt string `json:"excerpt"`
	Score   int    `json:"score"`
}

type MajorTarget struct {
	Name       string `json:"name"`
	DegreeType string `json:"degree_type,omitempty"`
	College    string `json:"college,omitempty"`
}

type MajorComparisonResult struct {
	Targets        []MajorComparisonTarget `json:"targets"`
	ToolBudgetHint string                  `json:"tool_budget_hint"`
}

type MajorComparisonTarget struct {
	Input       MajorTarget       `json:"input"`
	ChangeMajor MajorMatchSummary `json:"change_major"`
	Catalog     MajorMatchSummary `json:"catalog"`
}

type MajorMatchSummary struct {
	Matched bool           `json:"matched"`
	Total   int            `json:"total"`
	Row     map[string]any `json:"row,omitempty"`
}
