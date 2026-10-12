package main

import (
	"encoding/json"
	"testing"

	"reasonix/internal/provider"
)

func TestHistoryMessagesReplayCompleteStepsIntoTodoWrite(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID: "todo-1", Name: "todo_write",
			Arguments: `{"todos":[{"content":"Create the file","status":"in_progress"},{"content":"Update the file","status":"pending"}]}`,
		}}},
		{Role: provider.RoleTool, ToolCallID: "todo-1", Name: "todo_write", Content: "Todos updated"},
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID: "step-1", Name: "complete_step",
			Arguments: `{"step":"Create the file"}`,
		}}},
		{Role: provider.RoleTool, ToolCallID: "step-1", Name: "complete_step", Content: "signed off"},
	}

	payload := restoredTodoPayload(t, msgs, "todo-1")
	if got := payload.Todos[0].Status; got != "completed" {
		t.Fatalf("first todo status = %q, want completed", got)
	}
	if got := payload.Todos[1].Status; got != "in_progress" {
		t.Fatalf("second todo status = %q, want in_progress", got)
	}
}

func TestHistoryPreservesKnowledgeWhileReplayingCompleteSteps(t *testing.T) {
	args := `{"todos":[{"content":"Check course","status":"in_progress"}],"known":["Student chose ECS 150"],"unknown":["Instructor not confirmed"]}`
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID: "todo-1", Name: "todo_write", Arguments: args,
		}}},
		{Role: provider.RoleTool, ToolCallID: "todo-1", Name: "todo_write", Content: "Todos updated"},
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID: "step-1", Name: "complete_step", Arguments: `{"step":"Check course"}`,
		}}},
		{Role: provider.RoleTool, ToolCallID: "step-1", Name: "complete_step", Content: "signed off"},
	}

	payload := restoredTodoPayload(t, msgs, "todo-1")
	if got := payload.Todos[0].Status; got != "completed" {
		t.Fatalf("todo status = %q, want completed", got)
	}
	if len(payload.Known) != 1 || payload.Known[0] != "Student chose ECS 150" {
		t.Fatalf("known = %#v, want preserved knowledge", payload.Known)
	}
	if len(payload.Unknown) != 1 || payload.Unknown[0] != "Instructor not confirmed" {
		t.Fatalf("unknown = %#v, want preserved uncertainty", payload.Unknown)
	}
}

func TestHistoryRejectsInterruptedTodoTransitions(t *testing.T) {
	t.Run("cancelled todo_write cannot replace replay base", func(t *testing.T) {
		msgs := []provider.Message{
			{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
				ID: "todo-1", Name: "todo_write", Arguments: `{"todos":[{"content":"Keep me","status":"in_progress"}]}`,
			}}},
			{Role: provider.RoleTool, ToolCallID: "todo-1", Name: "todo_write", Content: "Todos updated"},
			{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
				ID: "todo-2", Name: "todo_write", Arguments: `{"todos":[{"content":"Do not use","status":"in_progress"}]}`,
			}}},
			{Role: provider.RoleTool, ToolCallID: "todo-2", Name: "todo_write", Content: "cancelled: context cancelled before execution"},
			{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
				ID: "step-1", Name: "complete_step", Arguments: `{"step":"Keep me"}`,
			}}},
			{Role: provider.RoleTool, ToolCallID: "step-1", Name: "complete_step", Content: "signed off"},
		}
		payload := restoredTodoPayload(t, msgs, "todo-1")
		if len(payload.Todos) != 1 || payload.Todos[0].Content != "Keep me" || payload.Todos[0].Status != "completed" {
			t.Fatalf("cancelled todo_write changed replay base: %+v", payload.Todos)
		}
	})

	t.Run("no-result complete_step cannot advance replay base", func(t *testing.T) {
		msgs := []provider.Message{
			{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
				ID: "todo-1", Name: "todo_write", Arguments: `{"todos":[{"content":"Keep open","status":"in_progress"}]}`,
			}}},
			{Role: provider.RoleTool, ToolCallID: "todo-1", Name: "todo_write", Content: "Todos updated"},
			{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
				ID: "step-1", Name: "complete_step", Arguments: `{"step":"Keep open"}`,
			}}},
			{Role: provider.RoleTool, ToolCallID: "step-1", Name: "complete_step", Content: "[no result: the previous turn was interrupted before this tool call completed]"},
		}
		payload := restoredTodoPayload(t, msgs, "todo-1")
		if got := payload.Todos[0].Status; got != "in_progress" {
			t.Fatalf("no-result complete_step changed replay status to %q", got)
		}
	})
}

func TestHistoryRejectsInvalidTodoWritePayloads(t *testing.T) {
	for _, tc := range []struct {
		name string
		args string
	}{
		{name: "malformed", args: `{"todos":[`},
		{name: "missing todos", args: `{}`},
		{name: "null todos", args: `{"todos":null}`},
		{name: "non-array todos", args: `{"todos":{}}`},
		{name: "invalid known type", args: `{"todos":[{"content":"A","status":"in_progress"}],"known":"invalid"}`},
		{name: "invalid unknown type", args: `{"todos":[{"content":"A","status":"in_progress"}],"unknown":{"question":"invalid"}}`},
		{name: "null known", args: `{"todos":[{"content":"A","status":"in_progress"}],"known":null}`},
		{name: "null unknown", args: `{"todos":[{"content":"A","status":"in_progress"}],"unknown":null}`},
		{name: "invalid todo item", args: `{"todos":["invalid"]}`},
		{name: "invalid todo field type", args: `{"todos":[{"content":7,"status":"in_progress"}]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			msgs := []provider.Message{
				{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
					ID: "todo-1", Name: "todo_write", Arguments: `{"todos":[{"content":"Valid base","status":"in_progress"}]}`,
				}}},
				{Role: provider.RoleTool, ToolCallID: "todo-1", Name: "todo_write", Content: "Todos updated"},
				{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
					ID: "todo-2", Name: "todo_write", Arguments: tc.args,
				}}},
				{Role: provider.RoleTool, ToolCallID: "todo-2", Name: "todo_write", Content: "Todos updated"},
				{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
					ID: "step-1", Name: "complete_step", Arguments: `{"step":"Valid base"}`,
				}}},
				{Role: provider.RoleTool, ToolCallID: "step-1", Name: "complete_step", Content: "signed off"},
			}
			replayed := historyTodoArgsWithCompleteSteps(msgs)
			if _, ok := replayed["todo-2"]; ok {
				t.Fatalf("invalid todo_write received rewritten replay args: %q", replayed["todo-2"])
			}
			payload := restoredTodoPayload(t, msgs, "todo-1")
			if len(payload.Todos) != 1 || payload.Todos[0].Content != "Valid base" || payload.Todos[0].Status != "completed" {
				t.Fatalf("invalid todo_write replaced replay base: %+v", payload.Todos)
			}
		})
	}
}

func TestHistoryAcceptsExplicitEmptyTodoWriteClear(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID: "todo-1", Name: "todo_write", Arguments: `{"todos":[{"content":"Do not resurrect","status":"in_progress"}]}`,
		}}},
		{Role: provider.RoleTool, ToolCallID: "todo-1", Name: "todo_write", Content: "Todos updated"},
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID: "todo-2", Name: "todo_write", Arguments: `{"todos":[]}`,
		}}},
		{Role: provider.RoleTool, ToolCallID: "todo-2", Name: "todo_write", Content: "Todos updated"},
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID: "step-1", Name: "complete_step", Arguments: `{"step":"Do not resurrect"}`,
		}}},
		{Role: provider.RoleTool, ToolCallID: "step-1", Name: "complete_step", Content: "signed off"},
	}

	oldPayload := restoredTodoPayload(t, msgs, "todo-1")
	if got := oldPayload.Todos[0].Status; got != "in_progress" {
		t.Fatalf("complete_step after explicit clear rewrote old base to %q", got)
	}
	clearPayload := restoredTodoPayload(t, msgs, "todo-2")
	if len(clearPayload.Todos) != 0 {
		t.Fatalf("explicit empty todo_write restored %+v, want clear", clearPayload.Todos)
	}
}

func TestHistoryMessagesRequireSuccessfulCompleteStepResult(t *testing.T) {
	tests := []struct {
		name       string
		toolResult *provider.Message
	}{
		{
			name: "failed complete_step",
			toolResult: &provider.Message{
				Role: provider.RoleTool, ToolCallID: "step-1", Name: "complete_step", Content: "error: no evidence",
			},
		},
		{name: "missing complete_step result"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			msgs := []provider.Message{
				{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
					ID: "todo-1", Name: "todo_write",
					Arguments: `{"todos":[{"content":"Create the file","status":"in_progress"},{"content":"Update the file","status":"pending"}]}`,
				}}},
				{Role: provider.RoleTool, ToolCallID: "todo-1", Name: "todo_write", Content: "Todos updated"},
				{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
					ID: "step-1", Name: "complete_step",
					Arguments: `{"step":"Create the file"}`,
				}}},
			}
			if tc.toolResult != nil {
				msgs = append(msgs, *tc.toolResult)
			}

			payload := restoredTodoPayload(t, msgs, "todo-1")
			if got := payload.Todos[0].Status; got != "in_progress" {
				t.Fatalf("complete_step without success changed first todo to %q", got)
			}
			if got := payload.Todos[1].Status; got != "pending" {
				t.Fatalf("complete_step without success changed second todo to %q", got)
			}
		})
	}
}

func TestHistoryMessagesIgnoreFailedTodoWriteAsReplayBase(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID: "todo-1", Name: "todo_write",
			Arguments: `{"todos":[{"content":"Create the file","status":"in_progress"}]}`,
		}}},
		{Role: provider.RoleTool, ToolCallID: "todo-1", Name: "todo_write", Content: "Todos updated"},
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID: "todo-2", Name: "todo_write",
			Arguments: `{"todos":[{"content":"Bad replacement","status":"in_progress"}]}`,
		}}},
		{Role: provider.RoleTool, ToolCallID: "todo-2", Name: "todo_write", Content: "error: rejected todo transition"},
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID: "step-1", Name: "complete_step", Arguments: `{"step":"Create the file"}`,
		}}},
		{Role: provider.RoleTool, ToolCallID: "step-1", Name: "complete_step", Content: "signed off"},
	}

	good := restoredTodoPayload(t, msgs, "todo-1")
	if got := good.Todos[0].Status; got != "completed" {
		t.Fatalf("successful base was not replayed: %q", got)
	}

	bad := restoredTodoPayload(t, msgs, "todo-2")
	if got := bad.Todos[0].Content; got != "Bad replacement" {
		t.Fatalf("failed todo_write arguments should stay original, got %q", got)
	}
	if got := bad.Todos[0].Status; got != "in_progress" {
		t.Fatalf("failed todo_write should not be replayed, status = %q", got)
	}
}

func restoredTodoPayload(t *testing.T, msgs []provider.Message, todoID string) struct {
	Todos []struct {
		Content string `json:"content"`
		Status  string `json:"status"`
	} `json:"todos"`
	Known   []string `json:"known"`
	Unknown []string `json:"unknown"`
} {
	t.Helper()
	history := historyMessages(msgs, func(s string) string { return s })
	var todoArgs string
	for _, m := range history {
		for _, tc := range m.ToolCalls {
			if tc.ID == todoID {
				todoArgs = tc.Arguments
			}
		}
	}
	if todoArgs == "" {
		t.Fatalf("todo_write %q arguments missing from history", todoID)
	}
	var payload struct {
		Todos []struct {
			Content string `json:"content"`
			Status  string `json:"status"`
		} `json:"todos"`
		Known   []string `json:"known"`
		Unknown []string `json:"unknown"`
	}
	if err := json.Unmarshal([]byte(todoArgs), &payload); err != nil {
		t.Fatalf("todo args are not JSON: %v", err)
	}
	return payload
}
