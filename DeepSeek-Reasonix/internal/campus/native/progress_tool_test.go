package native

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	campustools "reasonix/internal/campus/tools"
	"reasonix/internal/tool"
)

func TestToolsIncludeCampusTodoWrite(t *testing.T) {
	t.Parallel()

	var todo tool.Tool
	for _, candidate := range Tools(campustools.Paths{}) {
		if candidate.Name() == "todo_write" {
			todo = candidate
			break
		}
	}
	if todo == nil {
		t.Fatal("campus tools do not include todo_write")
	}
	safe, ok := todo.(interface{ PlanModeSafe() bool })
	if !todo.ReadOnly() || !ok || !safe.PlanModeSafe() {
		t.Fatal("campus todo_write must be read-only and plan-mode safe")
	}

	valid := json.RawMessage(`{"todos":[{"content":"核验转专业要求","status":"in_progress"},{"content":"生成下一步建议","status":"pending"}],"known":["学生计划于 2026 年春季转专业"],"unknown":["已完成哪些先修课？"]}`)
	if _, err := todo.Execute(context.Background(), valid); err != nil {
		t.Fatalf("valid todo list rejected: %v", err)
	}
	if _, err := todo.Execute(context.Background(), json.RawMessage(`{"todos":[]}`)); err != nil {
		t.Fatalf("explicit empty todo list rejected: %v", err)
	}
}

func TestCampusTodoWriteSchemaRequiresFullConsultationSnapshot(t *testing.T) {
	t.Parallel()

	var schema struct {
		Required []string `json:"required"`
	}
	if err := json.Unmarshal(campusTodoWrite{}.Schema(), &schema); err != nil {
		t.Fatalf("parse schema: %v", err)
	}
	required := make(map[string]bool, len(schema.Required))
	for _, name := range schema.Required {
		required[name] = true
	}
	for _, name := range []string{"todos", "known", "unknown"} {
		if !required[name] {
			t.Errorf("schema required fields = %v, missing %q", schema.Required, name)
		}
	}
}

func TestCampusTodoWriteAcceptsLegacyTodoOnlyPayload(t *testing.T) {
	t.Parallel()

	_, err := (campusTodoWrite{}).Execute(context.Background(), json.RawMessage(`{"todos":[{"content":"Review major requirements","status":"pending"}]}`))
	if err != nil {
		t.Fatalf("legacy todo-only payload rejected: %v", err)
	}
}

func TestCampusTodoWriteRejectsInvalidProgressShape(t *testing.T) {
	t.Parallel()

	todo := campusTodoWrite{}
	cases := []struct {
		name string
		args string
		want string
	}{
		{
			name: "two active items",
			args: `{"todos":[{"content":"A","status":"in_progress"},{"content":"B","status":"in_progress"}]}`,
			want: "at most one",
		},
		{
			name: "unknown status",
			args: `{"todos":[{"content":"A","status":"waiting"}]}`,
			want: "status",
		},
		{
			name: "empty content",
			args: `{"todos":[{"content":"  ","status":"pending"}]}`,
			want: "content",
		},
		{
			name: "too many items",
			args: `{"todos":[{"content":"1","status":"pending"},{"content":"2","status":"pending"},{"content":"3","status":"pending"},{"content":"4","status":"pending"},{"content":"5","status":"pending"},{"content":"6","status":"pending"},{"content":"7","status":"pending"},{"content":"8","status":"pending"},{"content":"9","status":"pending"}]}`,
			want: "at most 8",
		},
		{
			name: "empty known item",
			args: `{"todos":[],"known":["  "]}`,
			want: "known",
		},
		{
			name: "empty unknown item",
			args: `{"todos":[],"unknown":[""]}`,
			want: "unknown",
		},
		{
			name: "null known",
			args: `{"todos":[],"known":null}`,
			want: "known",
		},
		{
			name: "null unknown",
			args: `{"todos":[],"unknown":null}`,
			want: "unknown",
		},
		{
			name: "too many known items",
			args: `{"todos":[],"known":["1","2","3","4","5","6","7","8","9","10","11"]}`,
			want: "at most 10",
		},
		{
			name: "too many unknown items",
			args: `{"todos":[],"unknown":["1","2","3","4","5","6","7","8","9","10","11"]}`,
			want: "at most 10",
		},
		{
			name: "missing todos",
			args: `{}`,
			want: "todos",
		},
		{
			name: "null todos",
			args: `{"todos":null}`,
			want: "todos",
		},
		{
			name: "nested todos",
			args: `{"wrapper":{"todos":[]}}`,
			want: "todos",
		},
		{
			name: "non-array todos",
			args: `{"todos":"not an array"}`,
			want: "todos",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := todo.Execute(context.Background(), json.RawMessage(tc.args))
			if err == nil || !strings.Contains(strings.ToLower(err.Error()), strings.ToLower(tc.want)) {
				t.Fatalf("error = %v, want substring %q", err, tc.want)
			}
		})
	}
}

func TestSuccessCacheTreatsReorderedJSONAsIdentical(t *testing.T) {
	t.Parallel()

	cache := newSuccessCache()
	cache.store("query_course_db", json.RawMessage(`{"query":"ECS 150","limit":5}`), "first result")

	got, ok := cache.load("query_course_db", json.RawMessage(`{"limit":5,"query":"ECS 150"}`))
	if !ok || got != "first result" {
		t.Fatalf("load = %q, %v", got, ok)
	}
	if _, ok := cache.load("query_course_db", json.RawMessage(`{"limit":6,"query":"ECS 150"}`)); ok {
		t.Fatal("materially different arguments reused a cached result")
	}
}

func TestCampusToolReusesSuccessfulCachedResult(t *testing.T) {
	t.Parallel()

	cache := newSuccessCache()
	cache.store("query_course_db", json.RawMessage(`{"query":"ECS 150","limit":5}`), "grounded result")
	campus := campusTool{name: "query_course_db", cache: cache}

	got, err := campus.Execute(context.Background(), json.RawMessage(`{"limit":5,"query":"ECS 150"}`))
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if !strings.Contains(got, "reused cached result") || !strings.Contains(got, "grounded result") {
		t.Fatalf("cached output = %q", got)
	}
}
