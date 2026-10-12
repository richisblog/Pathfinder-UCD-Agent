package agent

import (
	"context"
	"strings"
	"testing"

	"reasonix/internal/agent/testutil"
	"reasonix/internal/event"
	"reasonix/internal/evidence"
	"reasonix/internal/provider"
)

func TestRunInjectsTurnContextAndKeepsVisibleUserTextClean(t *testing.T) {
	t.Parallel()

	providerMock := testutil.NewMock("progress", testutil.Turn{Text: "done"})
	builder := func(input string, history []provider.Message, todos []evidence.TodoItem) string {
		if input != "比较两个专业" {
			t.Fatalf("builder input = %q", input)
		}
		if len(history) != 1 || history[0].Role != provider.RoleSystem {
			t.Fatalf("builder history = %+v", history)
		}
		if len(todos) != 1 || todos[0].Content != "核验要求" {
			t.Fatalf("builder todos = %+v", todos)
		}
		return "<consultation-progress>next: query</consultation-progress>"
	}
	agent := New(providerMock, echoRegistry(), NewSession("system"), Options{TurnContextBuilder: builder}, event.Discard)
	agent.SeedTodoState([]evidence.TodoItem{{Content: "核验要求", Status: "in_progress"}})

	if err := agent.Run(context.Background(), "比较两个专业"); err != nil {
		t.Fatalf("Run: %v", err)
	}

	requests := providerMock.Requests()
	if len(requests) != 1 {
		t.Fatalf("requests = %d, want 1", len(requests))
	}
	user := lastUserMessage(t, requests)
	if !strings.Contains(user.Content, "<consultation-progress>") || !strings.HasSuffix(user.Content, "比较两个专业") {
		t.Fatalf("provider user turn missing transient context or original input:\n%s", user.Content)
	}

	messages := agent.Session().Snapshot()
	stored := messages[len(messages)-2]
	if stored.Role != provider.RoleUser {
		t.Fatalf("stored message role = %s, want user", stored.Role)
	}
	if got := StripTransientUserBlocks(stored.Content); got != "比较两个专业" {
		t.Fatalf("visible stored text = %q, want original input", got)
	}
}

func TestStripTransientUserBlocksRemovesConsultationProgress(t *testing.T) {
	t.Parallel()

	in := "<consultation-progress>\ngoal: compare majors\n</consultation-progress>\n\n比较两个专业"
	if got := StripTransientUserBlocks(in); got != "比较两个专业" {
		t.Fatalf("StripTransientUserBlocks = %q", got)
	}
}
