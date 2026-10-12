package governance

import "testing"

func TestMatchCourseInformation(t *testing.T) {
	t.Parallel()

	result := DefaultRegistry().Match("Can you compare the instructors for ECS 36A?")
	if result.UnsupportedConflict {
		t.Fatal("Match() marked an ordinary course-information request unsupported")
	}
	if len(result.Matches) != 1 {
		t.Fatalf("Match() returned %d matches, want 1", len(result.Matches))
	}
	if got := result.Matches[0].SOPID; got != "course_information" {
		t.Errorf("Match().Matches[0].SOPID = %q, want course_information", got)
	}
	if result.Matches[0].Confidence <= 0 {
		t.Errorf("Match().Matches[0].Confidence = %v, want positive", result.Matches[0].Confidence)
	}
}

func TestMatchAddDrop(t *testing.T) {
	t.Parallel()

	result := DefaultRegistry().Match("我想退掉这门课，并了解截止日期。")
	if result.UnsupportedConflict {
		t.Fatal("Match() marked an ordinary add/drop request unsupported")
	}
	if len(result.Matches) != 1 {
		t.Fatalf("Match() returned %d matches, want 1", len(result.Matches))
	}
	if got := result.Matches[0].SOPID; got != "add_drop_grading" {
		t.Errorf("Match().Matches[0].SOPID = %q, want add_drop_grading", got)
	}
}
