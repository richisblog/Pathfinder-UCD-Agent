package tools

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestRMPToolsSearchProfessorsAndReviews(t *testing.T) {
	t.Parallel()
	dbPath := filepath.Join(t.TempDir(), "rmp.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`
CREATE TABLE professors (
	id TEXT PRIMARY KEY, numeric_id TEXT, first_name TEXT, last_name TEXT,
	department TEXT, school TEXT, avg_rating REAL, num_ratings INTEGER,
	avg_difficulty REAL, would_take_again_percent REAL, rmp_url TEXT
);
CREATE TABLE reviews (
	review_id TEXT PRIMARY KEY, professor_id TEXT, course_name TEXT,
	normalized_course_code TEXT, rating_tags TEXT, difficulty_rating INTEGER,
	quality_rating REAL, comment TEXT, date TEXT, is_online BOOLEAN,
	is_for_credit BOOLEAN, attendance_mandatory TEXT, textbook_used BOOLEAN,
	would_take_again TEXT, grade TEXT
);
CREATE TABLE professor_courses (
	professor_id TEXT NOT NULL, normalized_course_code TEXT NOT NULL,
	display_course_name TEXT NOT NULL, raw_course_names_json TEXT NOT NULL,
	review_count INTEGER NOT NULL, avg_quality_rating REAL, avg_difficulty_rating REAL,
	PRIMARY KEY (professor_id, normalized_course_code)
);
INSERT INTO professors VALUES ('p1', '101', 'Jane', 'Smith', 'Computer Science', 'UC Davis', 4.8, 20, 2.1, 95, 'https://rmp.example/smith');
INSERT INTO reviews VALUES ('r1', 'p1', 'ECS 036A', 'ECS 036A', 'Clear lectures', 2, 5.0, 'Very clear lectures and fair exam.', '2026-01-01', 0, 1, 'No', 0, 'Yes', 'A');
INSERT INTO professor_courses VALUES ('p1', 'ECS 036A', 'ECS 036A', '["ECS 036A"]', 1, 5.0, 2.0);
`)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	svc := NewRMPService(dbPath)
	profs, err := svc.SearchProfessors("Smith", 5)
	if err != nil {
		t.Fatalf("search professors: %v", err)
	}
	if len(profs) != 1 || profs[0]["professor_name"] != "Jane Smith" {
		t.Fatalf("professors = %+v", profs)
	}

	reviews, err := svc.SearchReviewsByKeywords([]string{"clear", "exam"}, "", "", 10)
	if err != nil {
		t.Fatalf("search reviews: %v", err)
	}
	if reviews.TotalMatches != 1 || len(reviews.Rows) != 1 || reviews.Rows[0]["professor_name"] != "Jane Smith" {
		t.Fatalf("reviews = %+v", reviews)
	}
}
