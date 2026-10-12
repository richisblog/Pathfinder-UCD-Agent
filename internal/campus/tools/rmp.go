package tools

import (
	"database/sql"
	"fmt"
	"strings"

	_ "modernc.org/sqlite"
)

var rmpTableConfigs = map[string]struct {
	from       string
	selects    []string
	fields     map[string]string
	textFields []string
}{
	"professors": {
		from: "professors p",
		selects: []string{
			"p.id",
			"p.numeric_id",
			"p.first_name",
			"p.last_name",
			"(p.first_name || ' ' || p.last_name) AS professor_name",
			"p.department",
			"p.school",
			"p.avg_rating",
			"p.num_ratings",
			"p.avg_difficulty",
			"p.would_take_again_percent",
			"p.rmp_url",
		},
		fields: map[string]string{
			"id": "p.id", "numeric_id": "p.numeric_id", "first_name": "p.first_name", "last_name": "p.last_name",
			"professor_name": "(p.first_name || ' ' || p.last_name)", "name": "(p.first_name || ' ' || p.last_name)",
			"department": "p.department", "school": "p.school", "avg_rating": "p.avg_rating", "rating": "p.avg_rating",
			"num_ratings": "p.num_ratings", "reviews": "p.num_ratings", "avg_difficulty": "p.avg_difficulty",
			"difficulty": "p.avg_difficulty", "would_take_again_percent": "p.would_take_again_percent",
			"would_take_again": "p.would_take_again_percent",
		},
		textFields: []string{"professor_name", "first_name", "last_name", "department", "school"},
	},
	"reviews": {
		from: "reviews r LEFT JOIN professors p ON p.id = r.professor_id",
		selects: []string{
			"r.review_id",
			"r.professor_id",
			"p.numeric_id AS professor_numeric_id",
			"(p.first_name || ' ' || p.last_name) AS professor_name",
			"p.department",
			"r.course_name",
			"r.normalized_course_code",
			"r.rating_tags",
			"r.difficulty_rating",
			"r.quality_rating",
			"r.comment",
			"r.date",
			"r.is_online",
			"r.is_for_credit",
			"r.attendance_mandatory",
			"r.textbook_used",
			"r.would_take_again",
			"r.grade",
		},
		fields: map[string]string{
			"review_id": "r.review_id", "professor_id": "r.professor_id", "professor_numeric_id": "p.numeric_id",
			"professor_name": "(p.first_name || ' ' || p.last_name)", "name": "(p.first_name || ' ' || p.last_name)",
			"department": "p.department", "course_name": "r.course_name", "normalized_course_code": "r.normalized_course_code",
			"course": "r.normalized_course_code", "rating_tags": "r.rating_tags", "difficulty_rating": "r.difficulty_rating",
			"difficulty": "r.difficulty_rating", "quality_rating": "r.quality_rating", "quality": "r.quality_rating",
			"comment": "r.comment", "date": "r.date", "is_online": "r.is_online", "is_for_credit": "r.is_for_credit",
			"attendance_mandatory": "r.attendance_mandatory", "textbook_used": "r.textbook_used",
			"would_take_again": "r.would_take_again", "grade": "r.grade",
		},
		textFields: []string{"professor_name", "department", "course_name", "normalized_course_code", "rating_tags", "comment", "grade"},
	},
	"professor_courses": {
		from: "professor_courses pc LEFT JOIN professors p ON p.id = pc.professor_id",
		selects: []string{
			"pc.professor_id",
			"p.numeric_id AS professor_numeric_id",
			"(p.first_name || ' ' || p.last_name) AS professor_name",
			"p.department",
			"pc.normalized_course_code",
			"pc.display_course_name",
			"pc.raw_course_names_json",
			"pc.review_count",
			"pc.avg_quality_rating",
			"pc.avg_difficulty_rating",
		},
		fields: map[string]string{
			"professor_id": "pc.professor_id", "professor_numeric_id": "p.numeric_id",
			"professor_name": "(p.first_name || ' ' || p.last_name)", "name": "(p.first_name || ' ' || p.last_name)",
			"department": "p.department", "normalized_course_code": "pc.normalized_course_code",
			"course": "pc.normalized_course_code", "display_course_name": "pc.display_course_name",
			"raw_course_names_json": "pc.raw_course_names_json", "review_count": "pc.review_count",
			"reviews": "pc.review_count", "avg_quality_rating": "pc.avg_quality_rating",
			"quality": "pc.avg_quality_rating", "avg_difficulty_rating": "pc.avg_difficulty_rating",
			"difficulty": "pc.avg_difficulty_rating",
		},
		textFields: []string{"professor_name", "department", "normalized_course_code", "display_course_name", "raw_course_names_json"},
	},
}

type RMPService struct {
	dbPath string
}

func NewRMPService(dbPath string) *RMPService {
	return &RMPService{dbPath: dbPath}
}

func (s *RMPService) SearchProfessors(query string, limit int) ([]map[string]any, error) {
	result, err := s.QueryTable(
		"professors",
		nil,
		query,
		[]string{"first_name", "last_name", "professor_name", "department"},
		"num_ratings",
		"desc",
		limit,
	)
	if err != nil {
		return nil, err
	}
	return result.Rows, nil
}

func (s *RMPService) ProfessorsForCourse(course string, limit int) (QueryResult, error) {
	return s.QueryTable(
		"professor_courses",
		[]Filter{{Field: "course", Op: "exact", Value: normalizeCourseForRMP(course)}},
		"",
		nil,
		"review_count",
		"desc",
		limit,
	)
}

func (s *RMPService) ProfessorReviews(professorID, courseCode string, limit int) (QueryResult, error) {
	filters := []Filter{{Field: "professor_numeric_id", Op: "exact", Value: professorID}}
	if strings.TrimSpace(courseCode) != "" {
		filters = append(filters, Filter{Field: "course", Op: "exact", Value: normalizeCourseForRMP(courseCode)})
	}
	return s.QueryTable("reviews", filters, "", nil, "date", "desc", limit)
}

func (s *RMPService) SearchReviewsByKeywords(keywords []string, professorID, courseCode string, limit int) (QueryResult, error) {
	filters := make([]Filter, 0)
	if strings.TrimSpace(professorID) != "" {
		filters = append(filters, Filter{Field: "professor_numeric_id", Op: "exact", Value: professorID})
	}
	if strings.TrimSpace(courseCode) != "" {
		filters = append(filters, Filter{Field: "course", Op: "exact", Value: normalizeCourseForRMP(courseCode)})
	}
	search := strings.Join(keywords, " ")
	return s.QueryTable("reviews", filters, search, []string{"comment", "rating_tags"}, "date", "desc", limit)
}

func (s *RMPService) QueryTable(table string, filters []Filter, search string, searchFields []string, sortBy, sortOrder string, limit int) (QueryResult, error) {
	cfg, ok := rmpTableConfigs[table]
	if !ok {
		return QueryResult{}, fmt.Errorf("unknown RMP table %q", table)
	}
	whereParts, args, err := buildWhere(filters, cfg.fields)
	if err != nil {
		return QueryResult{}, err
	}
	if strings.TrimSpace(search) != "" {
		fields := searchFields
		if len(fields) == 0 {
			fields = cfg.textFields
		}
		terms := tokenize(search)
		if len(terms) == 0 {
			terms = []string{strings.ToLower(search)}
		}
		for _, term := range terms {
			var clauses []string
			for _, field := range fields {
				sqlField := cfg.fields[field]
				if sqlField == "" {
					continue
				}
				clauses = append(clauses, "LOWER("+sqlField+") LIKE ? ESCAPE '\\'")
				args = append(args, "%"+escapeLike(strings.ToLower(term))+"%")
			}
			if len(clauses) > 0 {
				whereParts = append(whereParts, "("+strings.Join(clauses, " OR ")+")")
			}
		}
	}
	whereSQL := ""
	if len(whereParts) > 0 {
		whereSQL = "WHERE " + strings.Join(whereParts, " AND ")
	}
	sortField := cfg.fields[sortBy]
	if sortField == "" {
		sortField = cfg.fields["professor_name"]
		if sortField == "" {
			sortField = cfg.selects[0]
		}
	}
	order := "DESC"
	if strings.EqualFold(sortOrder, "asc") {
		order = "ASC"
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}

	db, err := sql.Open("sqlite", "file:"+s.dbPath+"?mode=ro")
	if err != nil {
		return QueryResult{}, err
	}
	defer db.Close()

	var total int
	if err := db.QueryRow("SELECT COUNT(*) FROM "+cfg.from+" "+whereSQL, args...).Scan(&total); err != nil {
		return QueryResult{}, err
	}
	rows, err := db.Query(
		fmt.Sprintf("SELECT %s FROM %s %s ORDER BY %s %s LIMIT ?", strings.Join(cfg.selects, ", "), cfg.from, whereSQL, sortField, order),
		append(append([]any(nil), args...), limit)...,
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
		truncateMap(row, "comment", 700)
		truncateMap(row, "raw_course_names_json", 260)
	}
	return QueryResult{Table: table, TotalMatches: total, Rows: outRows}, nil
}

func normalizeCourseForRMP(raw string) string {
	if dept, number, ok := parseCourseCode(raw); ok {
		return dept + " " + number
	}
	return strings.ToUpper(strings.TrimSpace(raw))
}
