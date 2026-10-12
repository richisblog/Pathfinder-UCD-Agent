package tools

import (
	"database/sql"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	_ "modernc.org/sqlite"
)

var courseFields = map[string]string{
	"dept_code":           "dept_code",
	"department":          "dept_code",
	"course_number":       "course_number",
	"number":              "course_number",
	"title":               "title",
	"units":               "units",
	"description":         "description",
	"prerequisites":       "prerequisites",
	"prereqs":             "prerequisites",
	"learning_activities": "learning_activities",
	"credit_limitations":  "credit_limitations",
	"grade_mode":          "grade_mode",
	"general_education":   "general_education",
	"updated_at":          "updated_at",
	"avg_rating":          "avg_rating",
	"rating":              "avg_rating",
	"avg_difficulty":      "avg_difficulty",
	"difficulty":          "avg_difficulty",
	"num_reviews":         "num_reviews",
	"reviews":             "num_reviews",
	"ge_AH":               "ge_AH",
	"ge_SE":               "ge_SE",
	"ge_SS":               "ge_SS",
	"ge_ACGH":             "ge_ACGH",
	"ge_DD":               "ge_DD",
	"ge_OL":               "ge_OL",
	"ge_QL":               "ge_QL",
	"ge_SL":               "ge_SL",
	"ge_VL":               "ge_VL",
	"ge_WC":               "ge_WC",
	"ge_WE":               "ge_WE",
}

var (
	courseShortFields = []string{
		"dept_code",
		"course_number",
		"title",
		"units",
		"prerequisites",
		"general_education",
		"avg_rating",
		"avg_difficulty",
		"num_reviews",
	}
	courseLongFields = []string{
		"description",
		"learning_activities",
		"credit_limitations",
		"grade_mode",
	}
	courseTextFields = []string{
		"dept_code",
		"course_number",
		"title",
		"description",
		"prerequisites",
		"general_education",
	}
)

type CourseService struct {
	dbPath string
}

func NewCourseService(dbPath string) *CourseService {
	return &CourseService{dbPath: dbPath}
}

func (s *CourseService) QueryCourses(q CourseQuery) (QueryResult, error) {
	filters := append([]Filter(nil), q.Filters...)
	if dept, number, ok := parseCourseCode(q.Course); ok {
		filters = append(filters,
			Filter{Field: "dept_code", Op: "exact", Value: dept},
			Filter{Field: "course_number", Op: "exact", Value: number},
		)
	}

	whereParts, args, err := buildWhere(filters, courseFields)
	if err != nil {
		return QueryResult{}, err
	}
	if strings.TrimSpace(q.Search) != "" {
		clauses := make([]string, 0)
		searchFields := q.SearchFields
		if len(searchFields) == 0 {
			searchFields = courseTextFields
		}
		for _, field := range searchFields {
			sqlField := courseFields[field]
			if sqlField == "" {
				continue
			}
			clauses = append(clauses, "LOWER("+sqlField+") LIKE ? ESCAPE '\\'")
			args = append(args, "%"+escapeLike(strings.ToLower(q.Search))+"%")
		}
		if len(clauses) > 0 {
			whereParts = append(whereParts, "("+strings.Join(clauses, " OR ")+")")
		}
	}

	whereSQL := ""
	if len(whereParts) > 0 {
		whereSQL = "WHERE " + strings.Join(whereParts, " AND ")
	}

	sortBy := q.SortBy
	if sortBy == "" {
		sortBy = "dept_code"
	}
	sortField := courseFields[sortBy]
	if sortField == "" {
		sortField = "dept_code"
	}
	order := "ASC"
	if strings.EqualFold(q.SortOrder, "desc") {
		order = "DESC"
	}
	limit := q.Limit
	if limit <= 0 {
		limit = 8
	}
	if limit > 25 {
		limit = 25
	}

	fields := append([]string(nil), courseShortFields...)
	if q.IncludeLongFields {
		fields = append(fields, courseLongFields...)
	}

	db, err := sql.Open("sqlite", "file:"+s.dbPath+"?mode=ro")
	if err != nil {
		return QueryResult{}, err
	}
	defer db.Close()

	var total int
	if err := db.QueryRow("SELECT COUNT(*) FROM courses "+whereSQL, args...).Scan(&total); err != nil {
		return QueryResult{}, err
	}

	queryArgs := append(append([]any(nil), args...), limit)
	rows, err := db.Query(
		fmt.Sprintf(
			"SELECT %s FROM courses %s ORDER BY %s %s, dept_code ASC, course_number ASC LIMIT ?",
			strings.Join(fields, ", "),
			whereSQL,
			sortField,
			order,
		),
		queryArgs...,
	)
	if err != nil {
		return QueryResult{}, err
	}
	defer rows.Close()

	outRows, err := scanRows(rows)
	if err != nil {
		return QueryResult{}, err
	}
	for _, row := range outRows {
		row["course_code"] = fmt.Sprintf("%s %s", valueString(row["dept_code"]), valueString(row["course_number"]))
		truncateMap(row, "prerequisites", 320)
		truncateMap(row, "general_education", 320)
		if q.IncludeLongFields {
			for _, field := range courseLongFields {
				truncateMap(row, field, 520)
			}
		}
	}

	return QueryResult{
		Table:        "courses",
		TotalMatches: total,
		Rows:         outRows,
		Query:        q,
	}, nil
}

func parseCourseCode(raw string) (string, string, bool) {
	if strings.TrimSpace(raw) == "" {
		return "", "", false
	}
	re := regexp.MustCompile(`(?i)(^|[^A-Za-z0-9])([A-Za-z]{2,4})\s*0*(\d{1,3}[A-Za-z]{0,2})([^A-Za-z0-9]|$)`)
	m := re.FindStringSubmatch(raw)
	if len(m) != 5 {
		return "", "", false
	}
	numRe := regexp.MustCompile(`(?i)^(\d{1,3})([A-Za-z]{0,2})$`)
	n := numRe.FindStringSubmatch(m[3])
	if len(n) != 3 {
		return "", "", false
	}
	number, err := strconv.Atoi(n[1])
	if err != nil {
		return "", "", false
	}
	return strings.ToUpper(m[2]), fmt.Sprintf("%03d%s", number, strings.ToUpper(n[2])), true
}

func buildWhere(filters []Filter, fields map[string]string) ([]string, []any, error) {
	var clauses []string
	var args []any
	for _, filter := range filters {
		clause, clauseArgs, err := buildFilter(filter, fields)
		if err != nil {
			return nil, nil, err
		}
		if clause == "" {
			continue
		}
		clauses = append(clauses, clause)
		args = append(args, clauseArgs...)
	}
	return clauses, args, nil
}

func buildFilter(filter Filter, fields map[string]string) (string, []any, error) {
	sqlField := fields[filter.Field]
	if sqlField == "" {
		return "", nil, nil
	}
	op := strings.ToLower(strings.TrimSpace(filter.Op))
	if op == "" {
		op = "contains"
	}
	switch op {
	case "contains", "like", "fuzzy", "approx":
		return "LOWER(" + sqlField + ") LIKE ? ESCAPE '\\'", []any{"%" + escapeLike(strings.ToLower(fmt.Sprint(filter.Value))) + "%"}, nil
	case "exact", "eq", "=":
		return "LOWER(" + sqlField + ") = LOWER(?)", []any{fmt.Sprint(filter.Value)}, nil
	case "startswith", "prefix":
		return "LOWER(" + sqlField + ") LIKE ? ESCAPE '\\'", []any{escapeLike(strings.ToLower(fmt.Sprint(filter.Value))) + "%"}, nil
	case "gt", ">":
		return sqlField + " > ?", []any{filter.Value}, nil
	case "gte", ">=":
		return sqlField + " >= ?", []any{filter.Value}, nil
	case "lt", "<":
		return sqlField + " < ?", []any{filter.Value}, nil
	case "lte", "<=":
		return sqlField + " <= ?", []any{filter.Value}, nil
	case "between":
		values, ok := filter.Value.([]any)
		if !ok {
			return "", nil, nil
		}
		if len(values) < 2 {
			return "", nil, nil
		}
		return sqlField + " BETWEEN ? AND ?", []any{values[0], values[1]}, nil
	case "in":
		values, ok := filter.Value.([]any)
		if !ok || len(values) == 0 {
			return "", nil, nil
		}
		placeholders := make([]string, len(values))
		for i := range placeholders {
			placeholders[i] = "?"
		}
		return sqlField + " IN (" + strings.Join(placeholders, ",") + ")", values, nil
	case "is_null":
		return sqlField + " IS NULL", nil, nil
	case "not_null":
		return sqlField + " IS NOT NULL", nil, nil
	default:
		return "", nil, nil
	}
}

func escapeLike(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `%`, `\%`)
	value = strings.ReplaceAll(value, `_`, `\_`)
	return value
}

func scanRows(rows *sql.Rows) ([]map[string]any, error) {
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	var out []map[string]any
	for rows.Next() {
		values := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		row := make(map[string]any, len(cols))
		for i, col := range cols {
			row[col] = normalizeSQLValue(values[i])
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func normalizeSQLValue(value any) any {
	switch v := value.(type) {
	case []byte:
		return string(v)
	default:
		return v
	}
}

func truncateMap(row map[string]any, key string, limit int) {
	value, ok := row[key]
	if !ok || value == nil {
		return
	}
	text := valueString(value)
	if len([]rune(text)) <= limit {
		row[key] = text
		return
	}
	runes := []rune(text)
	row[key] = strings.TrimSpace(string(runes[:limit-3])) + "..."
}

func valueString(value any) string {
	if value == nil {
		return ""
	}
	return fmt.Sprint(value)
}
