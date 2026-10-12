package agent

import (
	"encoding/json"
	"strings"
	"testing"

	"reasonix/internal/event"
	"reasonix/internal/evidence"
)

func TestProgressReadToolBlocksFinalWithIncompleteTodo(t *testing.T) {
	t.Parallel()

	agent := New(nil, echoRegistry(), NewSession(""), Options{ProgressReadTools: []string{"query_course_db"}}, event.Discard)
	todos := []evidence.TodoItem{{Content: "核验课程要求", Status: "in_progress"}}
	agent.setTodoState(todos)
	todoArgs, err := json.Marshal(map[string]any{"todos": todos})
	if err != nil {
		t.Fatal(err)
	}
	agent.evidence.Record(evidence.Receipt{ToolName: "todo_write", Args: todoArgs, Success: true, Todos: todos})
	agent.evidence.Record(evidence.Receipt{ToolName: "query_course_db", Success: true, Read: true})

	got := agent.finalReadinessCheck().reason
	if !strings.Contains(got, "核验课程要求") || !strings.Contains(got, "in_progress") {
		t.Fatalf("readiness reason = %q", got)
	}
}

func TestMissingInputQuestionAllowedBeforeProgressRead(t *testing.T) {
	t.Parallel()

	agent := New(nil, echoRegistry(), NewSession(""), Options{ProgressReadTools: []string{"query_course_db"}}, event.Discard)
	todos := []evidence.TodoItem{{Content: "等待学生补充 GPA", Status: "in_progress"}}
	agent.setTodoState(todos)
	agent.evidence.Record(evidence.Receipt{ToolName: "todo_write", Success: true, Todos: todos})

	if got := agent.finalReadinessCheck().reason; got != "" {
		t.Fatalf("missing-input question was blocked before any campus query: %q", got)
	}
}
