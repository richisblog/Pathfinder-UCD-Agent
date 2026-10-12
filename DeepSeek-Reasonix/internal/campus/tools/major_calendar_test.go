package tools

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestMajorAndCalendarTools(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	majorsDB := filepath.Join(dir, "majors.db")
	changeDB := filepath.Join(dir, "changemajor.db")
	calendarDB := filepath.Join(dir, "ucdavis_calendar.db")

	createDB(t, majorsDB, `
CREATE TABLE majors (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	major_name TEXT NOT NULL,
	degree_type TEXT,
	filename TEXT,
	full_text TEXT,
	created_at TEXT
);
INSERT INTO majors (major_name, degree_type, filename, full_text) VALUES ('Computer Science', 'B.S.', 'cs.pdf', 'Computer Science major requirements include ECS courses.');`)
	createDB(t, changeDB, `
CREATE TABLE majors (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	full_name TEXT,
	major_code TEXT,
	college TEXT,
	college_en TEXT,
	description TEXT,
	search_keywords TEXT
);
INSERT INTO majors (full_name, major_code, college, college_en, description, search_keywords) VALUES ('Computer Science', 'ECS', '工程学院', 'College of Engineering', 'Complete required ECS courses before changing major.', 'CS ECS computer science');`)
	createDB(t, calendarDB, `
CREATE TABLE calendar_events (
	id TEXT PRIMARY KEY,
	source TEXT NOT NULL,
	source_url TEXT NOT NULL,
	academic_year TEXT NOT NULL,
	term TEXT NOT NULL,
	title TEXT NOT NULL,
	note TEXT NOT NULL,
	original_date_text TEXT NOT NULL,
	start_datetime TEXT,
	end_datetime TEXT,
	timezone TEXT NOT NULL,
	scraped_at TEXT NOT NULL
);
INSERT INTO calendar_events VALUES ('e1', 'registrar', 'https://example.test', '2026-2027', 'Fall', 'P/NP Deadline', 'Pass/no pass deadline.', 'Nov 1', '2026-11-01', NULL, 'America/Los_Angeles', '2026-01-01');`)

	majors := NewMajorService(majorsDB, changeDB)
	catalog, err := majors.QueryMajorCatalog("Computer Science", "", "", 5, false)
	if err != nil {
		t.Fatalf("query major catalog: %v", err)
	}
	if catalog.TotalMatches != 1 || catalog.Rows[0]["major_name"] != "Computer Science" {
		t.Fatalf("catalog = %+v", catalog)
	}

	change, err := majors.QueryChangeMajor("Computer Science", "", "", 5)
	if err != nil {
		t.Fatalf("query change major: %v", err)
	}
	if change.TotalMatches != 1 || change.Rows[0]["full_name"] != "Computer Science" {
		t.Fatalf("change = %+v", change)
	}

	calendar := NewCalendarService(calendarDB)
	events, err := calendar.QueryEvents("P/NP", "", "", "", "", 5, false)
	if err != nil {
		t.Fatalf("query calendar: %v", err)
	}
	if events.TotalMatches != 1 || events.Rows[0]["title"] != "P/NP Deadline" {
		t.Fatalf("events = %+v", events)
	}
}

func TestMajorCatalogRanksExactNameBeforeFullTextMatches(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	majorsDB := filepath.Join(dir, "majors.db")
	changeDB := filepath.Join(dir, "changemajor.db")
	createDB(t, majorsDB, `
CREATE TABLE majors (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	major_name TEXT NOT NULL,
	degree_type TEXT,
	filename TEXT,
	full_text TEXT,
	created_at TEXT
);
INSERT INTO majors (major_name, degree_type, filename, full_text) VALUES
	('African American & African Studies', 'B.A.', 'aaas.pdf', 'This program discusses psychology and social science.'),
	('Psychology', 'B.A.', 'psychology_ba.pdf', 'Psychology BA requirements.'),
	('Psychology', 'B.S.', 'psychology_bs.pdf', 'Psychology BS requirements.');`)
	createDB(t, changeDB, `
CREATE TABLE majors (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	full_name TEXT,
	major_code TEXT,
	college TEXT,
	college_en TEXT,
	description TEXT,
	search_keywords TEXT
);`)

	majors := NewMajorService(majorsDB, changeDB)
	catalog, err := majors.QueryMajorCatalog("Psychology", "", "", 5, false)
	if err != nil {
		t.Fatalf("query major catalog: %v", err)
	}
	if len(catalog.Rows) < 2 {
		t.Fatalf("catalog rows = %+v", catalog.Rows)
	}
	if catalog.Rows[0]["major_name"] != "Psychology" || catalog.Rows[1]["major_name"] != "Psychology" {
		t.Fatalf("exact Psychology rows should rank first, got %+v", catalog.Rows)
	}
}

func TestCompareChangeMajorRequirementsBatchesMajorLookup(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	majorsDB := filepath.Join(dir, "majors.db")
	changeDB := filepath.Join(dir, "changemajor.db")
	createDB(t, majorsDB, `
CREATE TABLE majors (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	major_name TEXT NOT NULL,
	degree_type TEXT,
	filename TEXT,
	full_text TEXT,
	created_at TEXT
);
INSERT INTO majors (major_name, degree_type, filename, full_text) VALUES
	('History', 'B.A.', 'history_ba.pdf', 'History major catalog requirements.'),
	('Psychology', 'B.A.', 'psychology_ba.pdf', 'Psychology BA catalog requirements.'),
	('Psychology', 'B.S.', 'psychology_bs.pdf', 'Psychology BS catalog requirements.');`)
	createDB(t, changeDB, `
CREATE TABLE majors (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	full_name TEXT,
	major_code TEXT,
	college TEXT,
	college_en TEXT,
	description TEXT,
	search_keywords TEXT
);
INSERT INTO majors (full_name, major_code, college, college_en, description, search_keywords) VALUES
	('History', 'HIS', '文理学院', 'College of Letters and Science', 'Complete HIS lower division courses.', 'history transfer change major'),
	('Psychology Bachelor of Arts', 'PSC', '文理学院', 'College of Letters and Science', 'Complete PSC 001 and statistics for BA.', 'psychology ba change major'),
	('Psychology Bachelor of Science', 'PSC', '文理学院', 'College of Letters and Science', 'Complete PSC 001, statistics, and science prep for BS.', 'psychology bs change major');`)

	majors := NewMajorService(majorsDB, changeDB)
	result, err := majors.CompareChangeMajorRequirements([]MajorTarget{
		{Name: "History"},
		{Name: "Psychology", DegreeType: "B.A."},
		{Name: "Psychology", DegreeType: "B.S."},
	}, false)
	if err != nil {
		t.Fatalf("compare change major: %v", err)
	}
	if len(result.Targets) != 3 {
		t.Fatalf("targets = %+v", result.Targets)
	}
	if result.Targets[1].Catalog.Row["degree_type"] != "B.A." {
		t.Fatalf("BA target catalog = %+v", result.Targets[1].Catalog)
	}
	if result.Targets[2].Catalog.Row["degree_type"] != "B.S." {
		t.Fatalf("BS target catalog = %+v", result.Targets[2].Catalog)
	}
	if result.ToolBudgetHint != "single_call" {
		t.Fatalf("budget hint = %q", result.ToolBudgetHint)
	}
}

func createDB(t *testing.T, path, schema string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(schema); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
}
