package tools

import (
	"strings"
	"time"
)

type CalendarService struct {
	dbPath string
	now    func() time.Time
}

func NewCalendarService(dbPath string) *CalendarService {
	return &CalendarService{dbPath: dbPath, now: time.Now}
}

func (s *CalendarService) QueryEvents(query, term, academicYear, dateFrom, dateTo string, limit int, currentTerm bool) (QueryResult, error) {
	where := make([]string, 0)
	args := make([]any, 0)
	if strings.TrimSpace(query) != "" {
		var queryParts []string
		for _, field := range []string{"title", "note", "source", "original_date_text"} {
			queryParts = append(queryParts, "LOWER("+field+") LIKE ? ESCAPE '\\'")
			args = append(args, "%"+escapeLike(strings.ToLower(query))+"%")
		}
		where = append(where, "("+strings.Join(queryParts, " OR ")+")")
	}
	if strings.TrimSpace(term) != "" {
		where = append(where, "LOWER(term) = LOWER(?)")
		args = append(args, term)
	}
	if strings.TrimSpace(academicYear) != "" {
		where = append(where, "academic_year = ?")
		args = append(args, academicYear)
	}
	if strings.TrimSpace(dateFrom) != "" {
		where = append(where, "COALESCE(start_datetime, '') >= ?")
		args = append(args, dateFrom)
	}
	if strings.TrimSpace(dateTo) != "" {
		where = append(where, "COALESCE(start_datetime, '') <= ?")
		args = append(args, dateTo)
	}
	if currentTerm && term == "" {
		inferred := inferQuarter(s.now)
		if inferred != "" {
			where = append(where, "LOWER(term) = LOWER(?)")
			args = append(args, inferred)
		}
	}
	fields := []string{
		"id",
		"source",
		"source_url",
		"academic_year",
		"term",
		"title",
		"note",
		"original_date_text",
		"start_datetime",
		"end_datetime",
		"timezone",
	}
	return querySimpleDB(s.dbPath, "calendar_events", "calendar_events", fields, where, args, "start_datetime ASC, title ASC", clampLimit(limit, 8, 30))
}

func inferQuarter(now func() time.Time) string {
	month := now().Month()
	switch month {
	case time.January, time.February, time.March:
		return "Winter"
	case time.April, time.May, time.June:
		return "Spring"
	case time.July, time.August:
		return "Summer"
	default:
		return "Fall"
	}
}
