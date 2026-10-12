package tools

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestQueryCourseDBExactCourse(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "courses.db")
	db, err := sql.Open("sqlite", dbPath)
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
	VALUES ('ECS', '036A', 'Programming and Problem Solving', '4', 'ECS 032A', 'SE, QL', 4.2, 3.1, 18);`)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	svc := NewCourseService(dbPath)
	got, err := svc.QueryCourses(CourseQuery{Course: "ecs36a", Limit: 5})
	if err != nil {
		t.Fatalf("query courses: %v", err)
	}
	if got.TotalMatches != 1 || len(got.Rows) != 1 {
		t.Fatalf("result = %+v", got)
	}
	if got.Rows[0]["course_code"] != "ECS 036A" {
		t.Fatalf("course_code = %v", got.Rows[0]["course_code"])
	}
}

func TestQueryCourseDBIgnoresUnknownFilterFields(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "courses.db")
	db, err := sql.Open("sqlite", dbPath)
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
	VALUES ('MAT', '021A', 'Calculus', '4', '', 'QL', 4.0, 2.8, 10);`)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	svc := NewCourseService(dbPath)
	got, err := svc.QueryCourses(CourseQuery{
		Filters: []Filter{{Field: "dept_code); DROP TABLE courses; --", Op: "exact", Value: "MAT"}},
		Limit:   5,
	})
	if err != nil {
		t.Fatalf("query courses: %v", err)
	}
	if got.TotalMatches != 1 {
		t.Fatalf("result = %+v", got)
	}
}
