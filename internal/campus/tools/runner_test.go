package tools

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestRunnerReportsMissingAcademicData(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	runner := NewRunner(Paths{
		SQLiteDir: filepath.Join(root, "sqlite"),
		TextDir:   filepath.Join(root, "txt"),
	})
	tests := []struct {
		tool string
		args map[string]any
		file string
	}{
		{"query_course_db", map[string]any{"course": "ECS 150"}, "courses.db"},
		{"query_rmp_table", map[string]any{"table": "professors"}, "rmp.db"},
		{"query_ucdavis_calendar", map[string]any{}, "ucdavis_calendar.db"},
		{"query_major_catalog", map[string]any{"major_name": "Computer Science"}, "majors.db"},
		{"query_change_major", map[string]any{"major": "Computer Science"}, "changemajor.db"},
	}
	for _, test := range tests {
		test := test
		t.Run(test.tool, func(t *testing.T) {
			t.Parallel()
			_, err := runner.RunTool(test.tool, test.args)
			if err == nil {
				t.Fatal("expected missing academic data error")
			}
			message := strings.ToLower(err.Error())
			if !strings.Contains(message, "pathfinder academic data is missing") || !strings.Contains(message, test.file) {
				t.Fatalf("error = %v; want clear missing-resource error for %s", err, test.file)
			}
		})
	}
}

func TestRunnerUnknownToolStillReportsUnknownTool(t *testing.T) {
	t.Parallel()
	runner := NewRunner(Paths{})
	_, err := runner.RunTool("not_a_tool", nil)
	if err == nil || !strings.Contains(err.Error(), "unknown tool") {
		t.Fatalf("err = %v", err)
	}
}

func TestRunnerRunsCourseAndTextTools(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	sqliteDir := filepath.Join(root, "sqlite")
	textDir := filepath.Join(root, "txt")
	if err := os.MkdirAll(sqliteDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(textDir, 0o700); err != nil {
		t.Fatal(err)
	}
	createRunnerCourseDB(t, filepath.Join(sqliteDir, "courses.db"))
	if err := os.WriteFile(filepath.Join(textDir, "writing.md"), []byte("Writing Placement Survey and ELWR policy."), 0o600); err != nil {
		t.Fatal(err)
	}

	runner := NewRunner(Paths{SQLiteDir: sqliteDir, TextDir: textDir})
	result, err := runner.RunTool("query_course_db", map[string]any{"course": "ECS 036A"})
	if err != nil {
		t.Fatalf("run course tool: %v", err)
	}
	if result["table"] != "courses" {
		t.Fatalf("result = %+v", result)
	}

	text, err := runner.RunTool("search_txt_context", map[string]any{"query": "writing placement"})
	if err != nil {
		t.Fatalf("run text tool: %v", err)
	}
	if text["query"] != "writing placement" {
		t.Fatalf("text = %+v", text)
	}

	names := map[string]bool{}
	for _, schema := range runner.Schemas() {
		names[schema.Function.Name] = true
	}
	for _, name := range []string{"query_course_db", "search_txt_context", "query_rmp_table", "query_major_catalog", "query_change_major", "query_ucdavis_calendar"} {
		if !names[name] {
			t.Fatalf("missing schema %s in %+v", name, names)
		}
	}
}

func TestRunnerExposesCompareChangeMajorRequirements(t *testing.T) {
	runner := NewRunner(Paths{})
	found := false
	for _, schema := range runner.Schemas() {
		if schema.Function.Name == "compare_change_major_requirements" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("compare_change_major_requirements schema missing")
	}
}

func createRunnerCourseDB(t *testing.T, path string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE courses (
		dept_code TEXT, course_number TEXT, title TEXT, units TEXT,
		description TEXT, prerequisites TEXT, learning_activities TEXT,
		credit_limitations TEXT, grade_mode TEXT, general_education TEXT,
		avg_rating REAL, avg_difficulty REAL, num_reviews INTEGER,
		ge_AH INTEGER, ge_SE INTEGER, ge_SS INTEGER, ge_ACGH INTEGER, ge_DD INTEGER,
		ge_OL INTEGER, ge_QL INTEGER, ge_SL INTEGER, ge_VL INTEGER, ge_WC INTEGER, ge_WE INTEGER,
		updated_at TEXT
	);
	INSERT INTO courses (dept_code, course_number, title, units, prerequisites, general_education, avg_rating, avg_difficulty, num_reviews)
	VALUES ('ECS', '036A', 'Programming and Problem Solving', '4', '', 'SE', 4.2, 3.1, 18);`)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
}
