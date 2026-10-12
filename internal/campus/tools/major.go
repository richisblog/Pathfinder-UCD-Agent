package tools

import (
	"database/sql"
	"fmt"
	"strings"

	_ "modernc.org/sqlite"
)

type MajorService struct {
	majorsDB      string
	changeMajorDB string
}

func NewMajorService(majorsDB, changeMajorDB string) *MajorService {
	return &MajorService{majorsDB: majorsDB, changeMajorDB: changeMajorDB}
}

func (s *MajorService) QueryMajorCatalog(majorName, search, degreeType string, limit int, includeFullText bool) (QueryResult, error) {
	fields := []string{"id", "major_name", "degree_type", "filename"}
	if includeFullText {
		fields = append(fields, "full_text")
	} else {
		fields = append(fields, "substr(full_text, 1, 900) AS full_text")
	}
	where, args := textQueryWhere([]string{"major_name", "full_text", "degree_type"}, majorName, search)
	if strings.TrimSpace(degreeType) != "" {
		where = append(where, "LOWER(degree_type) = LOWER(?)")
		args = append(args, degreeType)
	}
	orderBy := majorCatalogOrderBy(majorName, search)
	return querySimpleDB(s.majorsDB, "major_catalog", "majors", fields, where, args, orderBy, clampLimit(limit, 8, 25))
}

func (s *MajorService) QueryChangeMajor(major, college, search string, limit int) (QueryResult, error) {
	fields := []string{"id", "full_name", "major_code", "college", "college_en", "description", "search_keywords"}
	where, args := textQueryWhere([]string{"full_name", "major_code", "description", "search_keywords", "college", "college_en"}, major, search)
	if strings.TrimSpace(college) != "" {
		where = append(where, "(LOWER(college) LIKE ? ESCAPE '\\' OR LOWER(college_en) LIKE ? ESCAPE '\\')")
		value := "%" + escapeLike(strings.ToLower(college)) + "%"
		args = append(args, value, value)
	}
	return querySimpleDB(s.changeMajorDB, "change_major", "majors", fields, where, args, "full_name ASC", clampLimit(limit, 5, 25))
}

func (s *MajorService) CompareChangeMajorRequirements(targets []MajorTarget, includeCatalogText bool) (MajorComparisonResult, error) {
	out := MajorComparisonResult{ToolBudgetHint: "single_call"}
	for _, target := range targets {
		name := strings.TrimSpace(target.Name)
		if name == "" {
			continue
		}
		change, err := s.QueryChangeMajor(changeMajorSearchName(target), target.College, "", 1)
		if err != nil {
			return MajorComparisonResult{}, err
		}
		catalog, err := s.QueryMajorCatalog(name, "", target.DegreeType, 1, includeCatalogText)
		if err != nil {
			return MajorComparisonResult{}, err
		}
		out.Targets = append(out.Targets, MajorComparisonTarget{
			Input:       target,
			ChangeMajor: summarizeMajorMatch(change),
			Catalog:     summarizeMajorMatch(catalog),
		})
	}
	return out, nil
}

func summarizeMajorMatch(result QueryResult) MajorMatchSummary {
	summary := MajorMatchSummary{Matched: len(result.Rows) > 0, Total: result.TotalMatches}
	if len(result.Rows) > 0 {
		summary.Row = result.Rows[0]
	}
	return summary
}

func changeMajorSearchName(target MajorTarget) string {
	name := strings.TrimSpace(target.Name)
	degree := strings.ToLower(strings.TrimSpace(target.DegreeType))
	if degree == "" {
		return name
	}
	if strings.EqualFold(name, "psychology") {
		if strings.Contains(degree, "b.a") || strings.Contains(degree, "ba") {
			return "Psychology Bachelor of Arts"
		}
		if strings.Contains(degree, "b.s") || strings.Contains(degree, "bs") {
			return "Psychology Bachelor of Science"
		}
	}
	return name + " " + target.DegreeType
}

func majorCatalogOrderBy(majorName, search string) string {
	query := strings.TrimSpace(firstNonEmpty(majorName, search))
	if query == "" {
		return "major_name ASC"
	}
	escaped := strings.ReplaceAll(query, "'", "''")
	return fmt.Sprintf(`CASE
	WHEN LOWER(major_name) = LOWER('%[1]s') THEN 0
	WHEN LOWER(major_name) LIKE LOWER('%[1]s %%') ESCAPE '\' THEN 1
	WHEN LOWER(major_name) LIKE LOWER('%% %[1]s') ESCAPE '\' THEN 2
	WHEN LOWER(filename) LIKE LOWER('%%' || '%[1]s' || '%%') ESCAPE '\' THEN 3
	ELSE 4
END, major_name ASC, degree_type ASC`, escaped)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func textQueryWhere(fields []string, exactish string, search string) ([]string, []any) {
	var where []string
	var args []any
	if strings.TrimSpace(exactish) != "" {
		var clauses []string
		for _, field := range fields {
			clauses = append(clauses, "LOWER("+field+") LIKE ? ESCAPE '\\'")
			args = append(args, "%"+escapeLike(strings.ToLower(exactish))+"%")
		}
		where = append(where, "("+strings.Join(clauses, " OR ")+")")
	}
	if strings.TrimSpace(search) != "" {
		for _, term := range tokenize(search) {
			var clauses []string
			for _, field := range fields {
				clauses = append(clauses, "LOWER("+field+") LIKE ? ESCAPE '\\'")
				args = append(args, "%"+escapeLike(term)+"%")
			}
			where = append(where, "("+strings.Join(clauses, " OR ")+")")
		}
	}
	return where, args
}

func querySimpleDB(dbPath, resultTable, sourceTable string, fields []string, where []string, args []any, orderBy string, limit int) (QueryResult, error) {
	whereSQL := ""
	if len(where) > 0 {
		whereSQL = "WHERE " + strings.Join(where, " AND ")
	}
	db, err := sql.Open("sqlite", "file:"+dbPath+"?mode=ro")
	if err != nil {
		return QueryResult{}, err
	}
	defer db.Close()
	var total int
	if err := db.QueryRow("SELECT COUNT(*) FROM "+sourceTable+" "+whereSQL, args...).Scan(&total); err != nil {
		return QueryResult{}, err
	}
	rows, err := db.Query(
		fmt.Sprintf("SELECT %s FROM %s %s ORDER BY %s LIMIT ?", strings.Join(fields, ", "), sourceTable, whereSQL, orderBy),
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
		truncateMap(row, "full_text", 1200)
		truncateMap(row, "description", 900)
		truncateMap(row, "search_keywords", 400)
	}
	return QueryResult{Table: resultTable, TotalMatches: total, Rows: outRows}, nil
}

func clampLimit(value, def, max int) int {
	if value <= 0 {
		return def
	}
	if value > max {
		return max
	}
	return value
}
