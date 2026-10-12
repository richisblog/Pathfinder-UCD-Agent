package agent

import (
	"strings"
	"testing"

	"reasonix/internal/event"
	"reasonix/internal/evidence"
	"reasonix/internal/provider"
)

func TestFinalReadinessFallsBackToCanonicalTodos(t *testing.T) {
	ran := evidence.Receipt{ToolName: "bash", Success: true, Command: "git push"}
	open := []evidence.TodoItem{{Content: "push", Status: "completed"}, {Content: "rebase", Status: "pending"}}

	// Turn did work (a successful bash) but issued no todo_write this turn, so the
	// per-turn ledger has no list — the canonical state must still gate.
	a := &Agent{evidence: readinessLedger(ran), todoState: open}
	if got := a.finalReadinessFailure(); !strings.Contains(got, "incomplete") {
		t.Fatalf("cross-turn gate = %q, want it to report incomplete canonical todos", got)
	}

	// A turn that touched nothing (pure Q&A) must never gate on stale canonical state.
	idle := &Agent{evidence: evidence.NewLedger(), todoState: open}
	if got := idle.finalReadinessFailure(); got != "" {
		t.Fatalf("no-work turn gated on canonical todos: %q", got)
	}

	// All canonical items completed → no gate even after work.
	done := &Agent{evidence: readinessLedger(ran), todoState: []evidence.TodoItem{{Content: "push", Status: "completed"}}}
	if got := done.finalReadinessFailure(); got != "" {
		t.Fatalf("completed canonical todos still gated: %q", got)
	}
}

func TestAdvanceCanonicalTodoCompletesAndPromotes(t *testing.T) {
	a := &Agent{
		sink: event.Discard,
		todoState: []evidence.TodoItem{
			{Content: "sync branch", Status: "in_progress"},
			{Content: "push to origin", Status: "pending"},
			{Content: "rebase", Status: "pending"},
		},
	}
	a.advanceCanonicalTodo("sync branch")

	if a.todoState[0].Status != "completed" {
		t.Fatalf("signed-off item not completed: %+v", a.todoState[0])
	}
	if a.todoState[1].Status != "in_progress" {
		t.Fatalf("next pending item not promoted: %+v", a.todoState[1])
	}
	if a.todoState[2].Status != "pending" {
		t.Fatalf("a later item was promoted out of order: %+v", a.todoState[2])
	}
}

func TestAdvanceCanonicalTodoMatchesByNumber(t *testing.T) {
	a := &Agent{sink: event.Discard, todoState: []evidence.TodoItem{
		{Content: "first", Status: "in_progress"},
		{Content: "second", Status: "pending"},
	}}
	a.advanceCanonicalTodo("2")
	if a.todoState[1].Status != "completed" {
		t.Fatalf("numeric step did not complete the second todo: %+v", a.todoState)
	}
}

func TestRebuildTodoStateReplaysCompleteSteps(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID: "t1", Name: "todo_write",
			Arguments: `{"todos":[{"content":"a","status":"in_progress"},{"content":"b","status":"pending"}]}`,
		}}},
		{Role: provider.RoleTool, ToolCallID: "t1", Name: "todo_write", Content: "Todos updated"},
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID: "c1", Name: "complete_step", Arguments: `{"step":"a"}`,
		}}},
		{Role: provider.RoleTool, ToolCallID: "c1", Name: "complete_step", Content: "signed off"},
	}
	a := &Agent{}
	a.rebuildTodoState(msgs)

	if len(a.todoState) != 2 {
		t.Fatalf("rebuilt %d todos, want 2", len(a.todoState))
	}
	if a.todoState[0].Status != "completed" {
		t.Fatalf("complete_step not replayed onto canonical state: %+v", a.todoState[0])
	}
	if a.todoState[1].Status != "in_progress" {
		t.Fatalf("next item not promoted on replay: %+v", a.todoState[1])
	}
}

func TestRebuildConsultationSnapshotPreservesKnowledge(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID: "t1", Name: "todo_write",
			Arguments: `{"todos":[{"content":"Check course","status":"in_progress"}],"known":["Student chose ECS 150"],"unknown":["Instructor not confirmed"]}`,
		}}},
		{Role: provider.RoleTool, ToolCallID: "t1", Name: "todo_write", Content: "Todos updated"},
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID: "c1", Name: "complete_step", Arguments: `{"step":"Check course"}`,
		}}},
		{Role: provider.RoleTool, ToolCallID: "c1", Name: "complete_step", Content: "signed off"},
	}
	a := &Agent{}
	a.rebuildTodoState(msgs)

	snapshot := a.canonicalConsultationState()
	if got := snapshot.Todos[0].Status; got != "completed" {
		t.Fatalf("rebuilt todo status = %q, want completed", got)
	}
	if len(snapshot.Known) != 1 || snapshot.Known[0] != "Student chose ECS 150" {
		t.Fatalf("rebuilt known = %#v, want preserved knowledge", snapshot.Known)
	}
	if len(snapshot.Unknown) != 1 || snapshot.Unknown[0] != "Instructor not confirmed" {
		t.Fatalf("rebuilt unknown = %#v, want preserved uncertainty", snapshot.Unknown)
	}
}

func TestRebuildTodoStateRejectsInterruptedToolResults(t *testing.T) {
	t.Run("cancelled todo_write cannot replace the base", func(t *testing.T) {
		msgs := []provider.Message{
			{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
				ID: "t1", Name: "todo_write", Arguments: `{"todos":[{"content":"Keep me","status":"in_progress"}]}`,
			}}},
			{Role: provider.RoleTool, ToolCallID: "t1", Name: "todo_write", Content: "Todos updated"},
			{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
				ID: "t2", Name: "todo_write", Arguments: `{"todos":[{"content":"Do not use","status":"in_progress"}]}`,
			}}},
			{Role: provider.RoleTool, ToolCallID: "t2", Name: "todo_write", Content: "cancelled: context cancelled before execution"},
		}
		a := &Agent{}
		a.rebuildTodoState(msgs)
		if len(a.todoState) != 1 || a.todoState[0].Content != "Keep me" {
			t.Fatalf("cancelled todo_write replaced canonical state: %+v", a.todoState)
		}
	})

	t.Run("no-result complete_step cannot advance the base", func(t *testing.T) {
		msgs := []provider.Message{
			{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
				ID: "t1", Name: "todo_write", Arguments: `{"todos":[{"content":"Keep open","status":"in_progress"}]}`,
			}}},
			{Role: provider.RoleTool, ToolCallID: "t1", Name: "todo_write", Content: "Todos updated"},
			{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
				ID: "c1", Name: "complete_step", Arguments: `{"step":"Keep open"}`,
			}}},
			{Role: provider.RoleTool, ToolCallID: "c1", Name: "complete_step", Content: "[no result: the previous turn was interrupted before this tool call completed]"},
		}
		a := &Agent{}
		a.rebuildTodoState(msgs)
		if got := a.todoState[0].Status; got != "in_progress" {
			t.Fatalf("no-result complete_step changed status to %q", got)
		}
	})
}

func TestRebuildTodoStateRejectsInvalidTodoWritePayloads(t *testing.T) {
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
					ID: "t1", Name: "todo_write", Arguments: `{"todos":[{"content":"Valid base","status":"in_progress"}]}`,
				}}},
				{Role: provider.RoleTool, ToolCallID: "t1", Name: "todo_write", Content: "Todos updated"},
				{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
					ID: "t2", Name: "todo_write", Arguments: tc.args,
				}}},
				{Role: provider.RoleTool, ToolCallID: "t2", Name: "todo_write", Content: "Todos updated"},
				{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
					ID: "c1", Name: "complete_step", Arguments: `{"step":"Valid base"}`,
				}}},
				{Role: provider.RoleTool, ToolCallID: "c1", Name: "complete_step", Content: "signed off"},
			}
			a := &Agent{}
			a.rebuildTodoState(msgs)
			if len(a.todoState) != 1 || a.todoState[0].Content != "Valid base" || a.todoState[0].Status != "completed" {
				t.Fatalf("invalid todo_write became replay base: %+v", a.todoState)
			}
		})
	}
}

func TestRebuildTodoStateRespectsSameMessageToolCallOrder(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID: "t1", Name: "todo_write",
			Arguments: `{"todos":[{"content":"Check course","status":"in_progress"}],"known":["old snapshot"]}`,
		}}},
		{Role: provider.RoleTool, ToolCallID: "t1", Name: "todo_write", Content: "Todos updated"},
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{
			{ID: "c1", Name: "complete_step", Arguments: `{"step":"Check course"}`},
			{ID: "t2", Name: "todo_write", Arguments: `{"todos":[{"content":"Check course","status":"in_progress"}],"known":["new snapshot"]}`},
		}},
		{Role: provider.RoleTool, ToolCallID: "c1", Name: "complete_step", Content: "signed off"},
		{Role: provider.RoleTool, ToolCallID: "t2", Name: "todo_write", Content: "Todos updated"},
	}
	a := &Agent{}
	a.rebuildTodoState(msgs)

	snapshot := a.canonicalConsultationState()
	if got := snapshot.Todos[0].Status; got != "in_progress" {
		t.Fatalf("complete_step before same-message todo_write advanced new base to %q", got)
	}
	if len(snapshot.Known) != 1 || snapshot.Known[0] != "new snapshot" {
		t.Fatalf("latest same-message snapshot knowledge = %#v", snapshot.Known)
	}
}

func TestRebuildTodoStateSkipsFailedCompleteStep(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID: "t1", Name: "todo_write",
			Arguments: `{"todos":[{"content":"a","status":"in_progress"}]}`,
		}}},
		{Role: provider.RoleTool, ToolCallID: "t1", Name: "todo_write", Content: "Todos updated"},
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID: "c1", Name: "complete_step", Arguments: `{"step":"a"}`,
		}}},
		{Role: provider.RoleTool, ToolCallID: "c1", Name: "complete_step", Content: "error: no evidence"},
	}
	a := &Agent{}
	a.rebuildTodoState(msgs)

	if a.todoState[0].Status == "completed" {
		t.Fatalf("a failed complete_step must not advance canonical state: %+v", a.todoState[0])
	}
}

func TestRebuildTodoStateRequiresToolResults(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID: "t1", Name: "todo_write",
			Arguments: `{"todos":[{"content":"a","status":"in_progress"}]}`,
		}}},
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID: "c1", Name: "complete_step", Arguments: `{"step":"a"}`,
		}}},
	}
	a := &Agent{}
	a.rebuildTodoState(msgs)
	if len(a.todoState) != 0 {
		t.Fatalf("todo_write without tool result rebuilt canonical state: %+v", a.todoState)
	}

	msgs = append(msgs[:1],
		provider.Message{Role: provider.RoleTool, ToolCallID: "t1", Name: "todo_write", Content: "Todos updated"},
		msgs[1],
	)
	a.rebuildTodoState(msgs)
	if len(a.todoState) != 1 {
		t.Fatalf("successful todo_write did not rebuild canonical state: %+v", a.todoState)
	}
	if got := a.todoState[0].Status; got != "in_progress" {
		t.Fatalf("complete_step without tool result changed status to %q", got)
	}
}

func TestRebuildTodoStateHonorsEmptyTodoWriteClear(t *testing.T) {
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID:        "t1",
			Name:      "todo_write",
			Arguments: `{"todos":[{"content":"a","status":"in_progress"}]}`,
		}}},
		{Role: provider.RoleTool, ToolCallID: "t1", Name: "todo_write", Content: "Todos updated"},
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{
			ID:        "t2",
			Name:      "todo_write",
			Arguments: `{"todos":[]}`,
		}}},
		{Role: provider.RoleTool, ToolCallID: "t2", Name: "todo_write", Content: "Todos updated"},
	}
	a := &Agent{}
	a.rebuildTodoState(msgs)
	if len(a.todoState) != 0 {
		t.Fatalf("empty todo_write should clear rebuilt canonical state: %+v", a.todoState)
	}
}

func TestSeedTodoState(t *testing.T) {
	a := &Agent{sink: event.Discard}
	todos := []evidence.TodoItem{
		{Content: "step 1", Status: "in_progress"},
		{Content: "step 2", Status: "pending"},
	}
	a.SeedTodoState(todos)
	if len(a.todoState) != 2 {
		t.Fatalf("SeedTodoState: got %d items, want 2", len(a.todoState))
	}
	if a.todoState[0].Status != "in_progress" {
		t.Fatalf("SeedTodoState: first item status = %q, want in_progress", a.todoState[0].Status)
	}
}

func TestSeedTodoStateReplacesExisting(t *testing.T) {
	a := &Agent{sink: event.Discard, todoState: []evidence.TodoItem{
		{Content: "existing", Status: "in_progress"},
	}}
	a.SeedTodoState([]evidence.TodoItem{
		{Content: "new", Status: "in_progress"},
	})
	if len(a.todoState) != 1 || a.todoState[0].Content != "new" {
		t.Fatalf("SeedTodoState did not replace existing state: %+v", a.todoState)
	}
}

func TestSeedTodoStateAllowsAdvanceAfterSeed(t *testing.T) {
	a := &Agent{sink: event.Discard}
	a.SeedTodoState([]evidence.TodoItem{
		{Content: "step 1", Status: "in_progress"},
		{Content: "step 2", Status: "pending"},
	})
	a.advanceCanonicalTodo("step 1")
	if a.todoState[0].Status != "completed" {
		t.Fatalf("advance after seed: item 0 status = %q, want completed", a.todoState[0].Status)
	}
	if a.todoState[1].Status != "in_progress" {
		t.Fatalf("advance after seed: item 1 status = %q, want in_progress", a.todoState[1].Status)
	}
}
