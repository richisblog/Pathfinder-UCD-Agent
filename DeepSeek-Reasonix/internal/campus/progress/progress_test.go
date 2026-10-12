package progress

import (
	"strings"
	"testing"
	"unicode/utf8"

	"reasonix/internal/evidence"
	"reasonix/internal/provider"
)

func TestManagedConsultationClassification(t *testing.T) {
	t.Parallel()

	if ManagedConsultation("你好", nil) {
		t.Fatal("greeting should stay a direct answer")
	}
	if !ManagedConsultation("比较 CS 和 Data Science 转专业要求并给我下学期计划", nil) {
		t.Fatal("multi-step academic planning should be managed")
	}
	if !ManagedConsultation("继续", []evidence.TodoItem{{Content: "核验转专业要求", Status: "in_progress"}}) {
		t.Fatal("existing consultation progress should keep the next turn managed")
	}
}

func TestBuildContextIncludesTodoAndSuccessfulCampusObservation(t *testing.T) {
	t.Parallel()

	history := []provider.Message{
		{
			Role: provider.RoleAssistant,
			ToolCalls: []provider.ToolCall{{
				ID:        "c1",
				Name:      "compare_change_major_requirements",
				Arguments: `{"majors":["CS","Data Science"]}`,
			}},
		},
		{
			Role:       provider.RoleTool,
			ToolCallID: "c1",
			Name:       "compare_change_major_requirements",
			Content:    `{"ok":true,"summary":"requirements found"}`,
		},
	}
	todos := []evidence.TodoItem{{Content: "核验转专业要求", Status: "in_progress"}}

	got := BuildContext("继续规划", history, todos)
	for _, want := range []string{
		"<consultation-progress>",
		"核验转专业要求",
		"compare_change_major_requirements",
		"requirements found",
		"next_action",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("context missing %q:\n%s", want, got)
		}
	}
}

func TestBuildContextIgnoresNonCampusToolsAndFailedResultsAreLabeled(t *testing.T) {
	t.Parallel()

	history := []provider.Message{
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{
			{ID: "shell", Name: "bash", Arguments: `{"command":"pwd"}`},
			{ID: "course", Name: "query_course_db", Arguments: `{"query":"ECS 150"}`},
		}},
		{Role: provider.RoleTool, ToolCallID: "shell", Name: "bash", Content: "/private/path"},
		{Role: provider.RoleTool, ToolCallID: "course", Name: "query_course_db", Content: "error: database unavailable"},
	}

	got := BuildContext("帮我规划 ECS 150", history, nil)
	if strings.Contains(got, "bash") || strings.Contains(got, "/private/path") {
		t.Fatalf("non-campus tool leaked into progress context: %s", got)
	}
	if !strings.Contains(got, "status=failed") {
		t.Fatalf("failed campus result was not labeled: %s", got)
	}
}

func TestBuildContextIsBoundedAndValidUTF8(t *testing.T) {
	t.Parallel()

	long := strings.Repeat("课程证据很长。", 1000)
	history := []provider.Message{
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{ID: "c1", Name: "query_course_db", Arguments: `{"query":"ECS"}`}}},
		{Role: provider.RoleTool, ToolCallID: "c1", Name: "query_course_db", Content: long},
	}

	got := BuildContext("制定四年课程计划", history, nil)
	if !utf8.ValidString(got) {
		t.Fatal("bounded context is not valid UTF-8")
	}
	if utf8.RuneCountInString(got) > maxContextRunes {
		t.Fatalf("context has %d runes, want <= %d", utf8.RuneCountInString(got), maxContextRunes)
	}
}
