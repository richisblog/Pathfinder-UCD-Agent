package tools

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"reasonix/internal/campus/openai"
)

type Paths struct {
	SQLiteDir string
	TextDir   string
}

type Runner struct {
	rmp      *RMPService
	courses  *CourseService
	text     *TextService
	majors   *MajorService
	calendar *CalendarService
	paths    Paths
}

func NewRunner(paths Paths) *Runner {
	return &Runner{
		rmp:      NewRMPService(filepath.Join(paths.SQLiteDir, "rmp.db")),
		courses:  NewCourseService(filepath.Join(paths.SQLiteDir, "courses.db")),
		text:     NewTextService(paths.TextDir),
		majors:   NewMajorService(filepath.Join(paths.SQLiteDir, "majors.db"), filepath.Join(paths.SQLiteDir, "changemajor.db")),
		calendar: NewCalendarService(filepath.Join(paths.SQLiteDir, "ucdavis_calendar.db")),
		paths:    paths,
	}
}

func (r *Runner) Schemas() []openai.Tool {
	return []openai.Tool{
		toolSchema("search_professors", "Search UC Davis professors by name or department.", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{"type": "string"},
				"limit": map[string]any{"type": "integer"},
			},
			"required": []string{"query"},
		}),
		toolSchema("professors_for_course", "Find professors who taught a course such as ECS 036A.", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"course": map[string]any{"type": "string"},
				"limit":  map[string]any{"type": "integer"},
			},
			"required": []string{"course"},
		}),
		toolSchema("professor_reviews", "Get recent RMP reviews for a professor.", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"professor_numeric_id": map[string]any{"type": "string"},
				"course_code":          map[string]any{"type": "string"},
				"limit":                map[string]any{"type": "integer"},
			},
			"required": []string{"professor_numeric_id"},
		}),
		toolSchema("search_reviews_by_keywords", "Search detailed RMP review comments by keywords.", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"keywords":             map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				"professor_numeric_id": map[string]any{"type": "string"},
				"course_code":          map[string]any{"type": "string"},
				"limit":                map[string]any{"type": "integer"},
			},
			"required": []string{"keywords"},
		}),
		toolSchema("query_rmp_table", "General safe RMP SQLite query tool over whitelisted fields.", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"table":         map[string]any{"type": "string", "enum": []string{"professors", "reviews", "professor_courses"}},
				"filters":       map[string]any{"type": "array"},
				"search":        map[string]any{"type": "string"},
				"search_fields": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				"sort_by":       map[string]any{"type": "string"},
				"sort_order":    map[string]any{"type": "string", "enum": []string{"asc", "desc"}},
				"limit":         map[string]any{"type": "integer"},
			},
			"required": []string{"table"},
		}),
		toolSchema("query_course_db", "Query local UC Davis course catalog facts.", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"course":              map[string]any{"type": "string"},
				"filters":             map[string]any{"type": "array"},
				"search":              map[string]any{"type": "string"},
				"search_fields":       map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				"sort_by":             map[string]any{"type": "string"},
				"sort_order":          map[string]any{"type": "string", "enum": []string{"asc", "desc"}},
				"limit":               map[string]any{"type": "integer"},
				"include_long_fields": map[string]any{"type": "boolean"},
			},
		}),
		toolSchema("query_ucdavis_calendar", "Query local UC Davis academic calendar events and deadlines.", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query":         map[string]any{"type": "string"},
				"term":          map[string]any{"type": "string"},
				"academic_year": map[string]any{"type": "string"},
				"date_from":     map[string]any{"type": "string"},
				"date_to":       map[string]any{"type": "string"},
				"limit":         map[string]any{"type": "integer"},
				"current_term":  map[string]any{"type": "boolean"},
			},
		}),
		toolSchema("search_txt_context", "Search local campus policy text files.", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{"type": "string"},
				"limit": map[string]any{"type": "integer"},
			},
			"required": []string{"query"},
		}),
		toolSchema("query_major_catalog", "Query UC Davis major catalog pages and requirements.", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"major_name":        map[string]any{"type": "string"},
				"search":            map[string]any{"type": "string"},
				"degree_type":       map[string]any{"type": "string"},
				"limit":             map[string]any{"type": "integer"},
				"include_full_text": map[string]any{"type": "boolean"},
			},
		}),
		toolSchema("compare_change_major_requirements", "Compare UC Davis change-of-major requirements for multiple target majors in one call. Use this before separate change-major/catalog lookups.", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"targets": map[string]any{
					"type": "array",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"name":        map[string]any{"type": "string", "description": "Major name, e.g. History or Psychology."},
							"degree_type": map[string]any{"type": "string", "description": "Optional degree variant, e.g. B.A. or B.S."},
							"college":     map[string]any{"type": "string", "description": "Optional college filter."},
						},
						"required": []string{"name"},
					},
				},
				"include_catalog_text": map[string]any{"type": "boolean", "description": "Only true when full catalog text is necessary; default false to save tokens."},
			},
			"required": []string{"targets"},
		}),
		toolSchema("query_change_major", "Query UC Davis change-of-major requirements.", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"major":   map[string]any{"type": "string"},
				"college": map[string]any{"type": "string"},
				"search":  map[string]any{"type": "string"},
				"limit":   map[string]any{"type": "integer"},
			},
		}),
	}
}

func (r *Runner) RunTool(name string, args map[string]any) (map[string]any, error) {
	if err := r.requireAcademicData(name); err != nil {
		return nil, err
	}
	switch name {
	case "search_professors":
		rows, err := r.rmp.SearchProfessors(stringArg(args, "query"), intArg(args, "limit", 8))
		return map[string]any{"cards": rows, "count": len(rows), "query": stringArg(args, "query")}, err
	case "professors_for_course":
		return asMap(r.rmp.ProfessorsForCourse(stringArg(args, "course"), intArg(args, "limit", 8)))
	case "professor_reviews":
		return asMap(r.rmp.ProfessorReviews(stringArg(args, "professor_numeric_id"), stringArg(args, "course_code"), intArg(args, "limit", 6)))
	case "search_reviews_by_keywords":
		return asMap(r.rmp.SearchReviewsByKeywords(stringSliceArg(args, "keywords"), stringArg(args, "professor_numeric_id"), stringArg(args, "course_code"), intArg(args, "limit", 20)))
	case "query_rmp_table":
		return asMap(r.rmp.QueryTable(
			stringArg(args, "table"),
			filtersArg(args, "filters"),
			stringArg(args, "search"),
			stringSliceArg(args, "search_fields"),
			stringArg(args, "sort_by"),
			stringArg(args, "sort_order"),
			intArg(args, "limit", 20),
		))
	case "query_course_db":
		return asMap(r.courses.QueryCourses(CourseQuery{
			Course:            stringArg(args, "course"),
			Filters:           filtersArg(args, "filters"),
			Search:            stringArg(args, "search"),
			SearchFields:      stringSliceArg(args, "search_fields"),
			SortBy:            stringArg(args, "sort_by"),
			SortOrder:         stringArg(args, "sort_order"),
			Limit:             intArg(args, "limit", 8),
			IncludeLongFields: boolArg(args, "include_long_fields"),
		}))
	case "query_ucdavis_calendar":
		return asMap(r.calendar.QueryEvents(
			stringArg(args, "query"),
			stringArg(args, "term"),
			stringArg(args, "academic_year"),
			stringArg(args, "date_from"),
			stringArg(args, "date_to"),
			intArg(args, "limit", 8),
			boolArg(args, "current_term"),
		))
	case "search_txt_context":
		return asMap(r.text.Search(stringArg(args, "query"), intArg(args, "limit", 4)))
	case "query_major_catalog":
		return asMap(r.majors.QueryMajorCatalog(
			stringArg(args, "major_name"),
			stringArg(args, "search"),
			stringArg(args, "degree_type"),
			intArg(args, "limit", 8),
			boolArg(args, "include_full_text"),
		))
	case "compare_change_major_requirements":
		return asMap(r.majors.CompareChangeMajorRequirements(
			majorTargetsArg(args, "targets"),
			boolArg(args, "include_catalog_text"),
		))
	case "query_change_major":
		return asMap(r.majors.QueryChangeMajor(
			stringArg(args, "major"),
			stringArg(args, "college"),
			stringArg(args, "search"),
			intArg(args, "limit", 5),
		))
	default:
		return nil, fmt.Errorf("unknown tool %q", name)
	}
}

func (r *Runner) requireAcademicData(name string) error {
	var required []string
	switch name {
	case "search_professors", "professors_for_course", "professor_reviews", "search_reviews_by_keywords", "query_rmp_table":
		required = []string{filepath.Join(r.paths.SQLiteDir, "rmp.db")}
	case "query_course_db":
		required = []string{filepath.Join(r.paths.SQLiteDir, "courses.db")}
	case "query_ucdavis_calendar":
		required = []string{filepath.Join(r.paths.SQLiteDir, "ucdavis_calendar.db")}
	case "query_major_catalog":
		required = []string{filepath.Join(r.paths.SQLiteDir, "majors.db")}
	case "compare_change_major_requirements":
		required = []string{
			filepath.Join(r.paths.SQLiteDir, "majors.db"),
			filepath.Join(r.paths.SQLiteDir, "changemajor.db"),
		}
	case "query_change_major":
		required = []string{filepath.Join(r.paths.SQLiteDir, "changemajor.db")}
	case "search_txt_context":
		info, err := os.Stat(r.paths.TextDir)
		if err != nil || !info.IsDir() {
			return fmt.Errorf("Pathfinder academic data is missing: text policy directory")
		}
		return nil
	default:
		return nil
	}
	for _, path := range required {
		info, err := os.Stat(path)
		if err != nil || info.IsDir() {
			return fmt.Errorf("Pathfinder academic data is missing: %s", filepath.Base(path))
		}
	}
	return nil
}

func majorTargetsArg(args map[string]any, key string) []MajorTarget {
	if args == nil {
		return nil
	}
	raw, ok := args[key]
	if !ok {
		return nil
	}
	b, err := json.Marshal(raw)
	if err != nil {
		return nil
	}
	var targets []MajorTarget
	if err := json.Unmarshal(b, &targets); err != nil {
		return nil
	}
	return targets
}

func (r *Runner) DataStatus() map[string]bool {
	return map[string]bool{
		"rmp":      fileExists(filepath.Join(r.paths.SQLiteDir, "rmp.db")),
		"courses":  fileExists(filepath.Join(r.paths.SQLiteDir, "courses.db")),
		"majors":   fileExists(filepath.Join(r.paths.SQLiteDir, "majors.db")),
		"change":   fileExists(filepath.Join(r.paths.SQLiteDir, "changemajor.db")),
		"calendar": fileExists(filepath.Join(r.paths.SQLiteDir, "ucdavis_calendar.db")),
		"text":     r.paths.TextDir != "",
	}
}

func toolSchema(name, description string, parameters map[string]any) openai.Tool {
	return openai.Tool{
		Type: "function",
		Function: openai.ToolFunction{
			Name:        name,
			Description: description,
			Parameters:  parameters,
		},
	}
}

func asMap[T any](value T, err error) (map[string]any, error) {
	if err != nil {
		return nil, err
	}
	b, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func stringArg(args map[string]any, key string) string {
	if args == nil {
		return ""
	}
	if value, ok := args[key].(string); ok {
		return value
	}
	return ""
}

func intArg(args map[string]any, key string, def int) int {
	if args == nil {
		return def
	}
	switch value := args[key].(type) {
	case int:
		return value
	case int64:
		return int(value)
	case float64:
		return int(value)
	case json.Number:
		n, err := strconv.Atoi(value.String())
		if err == nil {
			return n
		}
	}
	return def
}

func boolArg(args map[string]any, key string) bool {
	if args == nil {
		return false
	}
	value, _ := args[key].(bool)
	return value
}

func stringSliceArg(args map[string]any, key string) []string {
	if args == nil {
		return nil
	}
	switch values := args[key].(type) {
	case []string:
		return values
	case []any:
		out := make([]string, 0, len(values))
		for _, value := range values {
			if s, ok := value.(string); ok {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}

func filtersArg(args map[string]any, key string) []Filter {
	if args == nil {
		return nil
	}
	values, ok := args[key].([]any)
	if !ok {
		return nil
	}
	out := make([]Filter, 0, len(values))
	for _, value := range values {
		m, ok := value.(map[string]any)
		if !ok {
			continue
		}
		out = append(out, Filter{
			Field: stringArg(m, "field"),
			Op:    stringArg(m, "op"),
			Value: m["value"],
		})
	}
	return out
}

func fileExists(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
