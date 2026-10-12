package evidence

import (
	"context"
	"encoding/json"
	"testing"
)

func TestParseConsultationSnapshot(t *testing.T) {
	got := ParseConsultationSnapshot(json.RawMessage(`{
		"todos":[{"content":"Check prerequisites","status":"in_progress"}],
		"known":["  Student is planning Spring 2026  "],
		"unknown":["Completed prerequisites?"]
	}`))
	if got.Known[0] != "Student is planning Spring 2026" || got.Unknown[0] != "Completed prerequisites?" {
		t.Fatalf("snapshot = %#v", got)
	}
	legacy := ParseConsultationSnapshot(json.RawMessage(`{"todos":[{"content":"A","status":"pending"}]}`))
	if len(legacy.Todos) != 1 || len(legacy.Known) != 0 || len(legacy.Unknown) != 0 {
		t.Fatalf("legacy snapshot = %#v", legacy)
	}
}

func TestParseConsultationSnapshotCheckedRejectsInvalidContent(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		args string
	}{
		{name: "too many todos", args: `{"todos":[{"content":"1","status":"pending"},{"content":"2","status":"pending"},{"content":"3","status":"pending"},{"content":"4","status":"pending"},{"content":"5","status":"pending"},{"content":"6","status":"pending"},{"content":"7","status":"pending"},{"content":"8","status":"pending"},{"content":"9","status":"pending"}]}`},
		{name: "blank todo content", args: `{"todos":[{"content":"  ","status":"pending"}]}`},
		{name: "invalid todo status", args: `{"todos":[{"content":"Review","status":"blocked"}]}`},
		{name: "multiple active todos", args: `{"todos":[{"content":"Review","status":"in_progress"},{"content":"Plan","status":"in_progress"}]}`},
		{name: "invalid active form type", args: `{"todos":[{"content":"Review","status":"pending","activeForm":7}]}`},
		{name: "null active form", args: `{"todos":[{"content":"Review","status":"pending","activeForm":null}]}`},
		{name: "invalid level type", args: `{"todos":[{"content":"Review","status":"pending","level":"high"}]}`},
		{name: "null level", args: `{"todos":[{"content":"Review","status":"pending","level":null}]}`},
		{name: "too many known entries", args: `{"todos":[],"known":["1","2","3","4","5","6","7","8","9","10","11"]}`},
		{name: "blank known entry", args: `{"todos":[],"known":["  "]}`},
		{name: "too many unknown entries", args: `{"todos":[],"unknown":["1","2","3","4","5","6","7","8","9","10","11"]}`},
		{name: "blank unknown entry", args: `{"todos":[],"unknown":["\t"]}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if snapshot, ok := ParseConsultationSnapshotChecked(json.RawMessage(tt.args)); ok {
				t.Fatalf("ParseConsultationSnapshotChecked() = %#v, true; want invalid", snapshot)
			}
		})
	}
}

func TestParseConsultationSnapshotCheckedAcceptsLegacyAndExplicitClear(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		args      string
		wantTodos int
	}{
		{name: "legacy todo-only payload", args: `{"todos":[{"content":"Review","status":"pending"}]}`, wantTodos: 1},
		{name: "explicit clear", args: `{"todos":[]}`, wantTodos: 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			snapshot, ok := ParseConsultationSnapshotChecked(json.RawMessage(tt.args))
			if !ok || len(snapshot.Todos) != tt.wantTodos || len(snapshot.Known) != 0 || len(snapshot.Unknown) != 0 {
				t.Fatalf("ParseConsultationSnapshotChecked() = %#v, %v; want %d todos and empty knowledge", snapshot, ok, tt.wantTodos)
			}
		})
	}
}

func TestMarshalConsultationSnapshotNormalizesNonEmptyStrings(t *testing.T) {
	raw, err := MarshalConsultationSnapshot(ConsultationSnapshot{
		Todos:   []TodoItem{{Content: "  Check prerequisites  ", Status: " pending "}},
		Known:   []string{"  Student is planning Spring 2026  ", "   "},
		Unknown: []string{"  Completed prerequisites?  ", ""},
	})
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	var got ConsultationSnapshot
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal snapshot: %v", err)
	}
	if len(got.Known) != 1 || got.Known[0] != "Student is planning Spring 2026" || len(got.Unknown) != 1 || got.Unknown[0] != "Completed prerequisites?" {
		t.Fatalf("snapshot = %#v", got)
	}
}

func TestLedgerRecordsSuccessAndFailureReceipts(t *testing.T) {
	ledger := NewLedger()
	ledger.Record(Receipt{
		ToolName: "bash",
		Args:     json.RawMessage(`{"command":"go test ./..."}`),
		Success:  true,
		Command:  "go test ./...",
	})
	ledger.Record(Receipt{
		ToolName: "bash",
		Args:     json.RawMessage(`{"command":"go test ./internal/..."}`),
		Success:  false,
		Command:  "go test ./internal/...",
	})

	if !ledger.HasSuccessfulCommand("go test ./...") {
		t.Fatal("successful bash command should verify")
	}
	if ledger.HasSuccessfulCommand("go test ./internal/...") {
		t.Fatal("failed bash command must not verify")
	}
}

func TestLedgerMatchesFileReadAndWriteReceipts(t *testing.T) {
	ledger := NewLedger()
	ledger.Record(Receipt{ToolName: "read_file", Success: true, Paths: []string{`internal/tool/builtin/completestep.go`}, Read: true})
	ledger.Record(Receipt{ToolName: "write_file", Success: true, Paths: []string{`internal/evidence/evidence.go`}, Write: true})
	ledger.Record(Receipt{ToolName: "edit_file", Success: false, Paths: []string{`failed.go`}, Write: true})

	if !ledger.HasSuccessfulReadOrWrite([]string{`internal\tool\builtin\completestep.go`}) {
		t.Fatal("read receipt should verify the same path across separators")
	}
	if !ledger.HasSuccessfulWrite([]string{`internal/evidence/evidence.go`}) {
		t.Fatal("write receipt should verify written path")
	}
	if ledger.HasSuccessfulWrite([]string{`failed.go`}) {
		t.Fatal("failed write receipt must not verify")
	}
}

func TestLedgerReportsFinalReadinessReceiptsAfterWriter(t *testing.T) {
	ledger := NewLedger()
	ledger.Record(Receipt{ToolName: "bash", Success: true, Command: "go test ./..."})
	ledger.Record(Receipt{ToolName: "write_file", Success: true, Paths: []string{"changed.go"}, Write: true})
	ledger.Record(Receipt{ToolName: "bash", Success: false, Command: "git diff --check"})
	ledger.Record(Receipt{ToolName: "todo_write", Success: true, Todos: []TodoItem{{Content: "Edit code", Status: "in_progress"}}})

	writer, ok := ledger.LatestSuccessfulWriterIndex()
	if !ok {
		t.Fatal("expected latest successful writer")
	}
	if ledger.HasSuccessfulCommandAfter("go test ./...", writer) {
		t.Fatal("command before latest writer must not satisfy final readiness")
	}
	if ledger.HasSuccessfulCommandAfter("git diff --check", writer) {
		t.Fatal("failed command must not satisfy final readiness")
	}
	if ledger.HasSuccessfulCompleteStepAfter(writer) {
		t.Fatal("missing complete_step must not satisfy final readiness")
	}
	if !ledger.HasSuccessfulTodoWrite() {
		t.Fatal("successful todo_write receipt should be reported")
	}

	ledger.Record(Receipt{ToolName: "bash", Success: true, Command: "git diff --check"})
	ledger.Record(Receipt{ToolName: "complete_step", Success: true, Step: "Edit code"})
	if !ledger.HasSuccessfulCommandAfter("git diff --check", writer) {
		t.Fatal("command after latest writer should satisfy final readiness")
	}
	if !ledger.HasSuccessfulCompleteStepAfter(writer) {
		t.Fatal("complete_step after latest writer should satisfy final readiness")
	}
}

func TestLedgerResetClearsTurnReceipts(t *testing.T) {
	ledger := NewLedger()
	ledger.Record(Receipt{ToolName: "bash", Success: true, Command: "go test ./..."})

	ledger.Reset()

	if ledger.HasSuccessfulCommand("go test ./...") {
		t.Fatal("reset should clear prior-turn evidence")
	}
}

func TestContextCarriesLedger(t *testing.T) {
	ledger := NewLedger()
	ctx := WithLedger(context.Background(), ledger)

	got, ok := FromContext(ctx)
	if !ok {
		t.Fatal("ledger missing from context")
	}
	if got != ledger {
		t.Fatal("context returned a different ledger")
	}
}

func TestReceiptFromToolCallExtractsEvidenceFields(t *testing.T) {
	bash := ReceiptFromToolCall("bash", json.RawMessage(`{"command":"git diff --check"}`), true, false)
	if bash.Command != "git diff --check" {
		t.Fatalf("bash command = %q", bash.Command)
	}
	if bash.Write {
		t.Fatal("bash should not be treated as a verified file writer")
	}

	write := ReceiptFromToolCall("write_file", json.RawMessage(`{"path":"internal/evidence/evidence.go","content":"x"}`), true, false)
	if !write.Write || len(write.Paths) != 1 || write.Paths[0] != `internal/evidence/evidence.go` {
		t.Fatalf("write receipt not extracted: %+v", write)
	}

	read := ReceiptFromToolCall("read_file", json.RawMessage(`{"path":"internal/tool/builtin/completestep.go"}`), true, true)
	if !read.Read || len(read.Paths) != 1 {
		t.Fatalf("read receipt not extracted: %+v", read)
	}

	glob := ReceiptFromToolCall("glob", json.RawMessage(`{"pattern":"**/*.go"}`), true, true)
	if !glob.Read {
		t.Fatalf("generic read-only tool should be treated as read context: %+v", glob)
	}
}

func TestReceiptFromToolCallExtractsTodoWriteItems(t *testing.T) {
	receipt := ReceiptFromToolCall("todo_write", json.RawMessage(`{"todos":[
		{"content":"Add parser","status":"in_progress","activeForm":"Adding parser"},
		{"content":"Wire parser","status":"pending","level":1}
	],"known":["  Requirements located  "],"unknown":["  Prerequisites completed?  "]}`), true, true)

	if len(receipt.Todos) != 2 {
		t.Fatalf("todos not extracted: %+v", receipt)
	}
	if receipt.Todos[0].Content != "Add parser" || receipt.Todos[0].Status != "in_progress" || receipt.Todos[0].ActiveForm != "Adding parser" {
		t.Fatalf("first todo not extracted: %+v", receipt.Todos[0])
	}
	if receipt.Todos[1].Level != 1 {
		t.Fatalf("todo level not extracted: %+v", receipt.Todos[1])
	}
	if len(receipt.Known) != 1 || receipt.Known[0] != "Requirements located" || len(receipt.Unknown) != 1 || receipt.Unknown[0] != "Prerequisites completed?" {
		t.Fatalf("knowledge not extracted: %+v", receipt)
	}
}

func TestReceiptFromToolCallExtractsCompleteStep(t *testing.T) {
	receipt := ReceiptFromToolCall("complete_step", json.RawMessage(`{
		"step":"Add parser",
		"result":"parser added",
		"evidence":[{"kind":"manual","summary":"checked manually"}]
	}`), true, true)

	if receipt.Step != "Add parser" {
		t.Fatalf("complete_step step = %q", receipt.Step)
	}
	if !receipt.StepProof {
		t.Fatalf("complete_step evidence proof not extracted: %+v", receipt)
	}
	if receipt.Read {
		t.Fatalf("complete_step should not be treated as read-only context: %+v", receipt)
	}

	missingResult := ReceiptFromToolCall("complete_step", json.RawMessage(`{
		"step":"Add parser",
		"evidence":[{"kind":"manual","summary":"checked manually"}]
	}`), false, true)
	if missingResult.StepProof {
		t.Fatalf("complete_step without result should not count as proof: %+v", missingResult)
	}

	missingCommand := ReceiptFromToolCall("complete_step", json.RawMessage(`{
		"step":"Add parser",
		"result":"parser added",
		"evidence":[{"kind":"verification","summary":"checked manually"}]
	}`), false, true)
	if missingCommand.StepProof {
		t.Fatalf("verification evidence without command should not count as proof: %+v", missingCommand)
	}

	emptyProof := ReceiptFromToolCall("complete_step", json.RawMessage(`{
		"step":"Add parser",
		"result":"parser added",
		"evidence":[]
	}`), false, true)
	if emptyProof.StepProof {
		t.Fatalf("empty complete_step evidence should not count as proof: %+v", emptyProof)
	}
}

func TestReceiptFromToolCallExtractsCompleteStepIndex(t *testing.T) {
	receipt := ReceiptFromToolCall("complete_step", json.RawMessage(`{
		"step_index":2,
		"result":"done",
		"evidence":[{"kind":"manual","summary":"checked"}]
	}`), true, true)

	if receipt.Step != "2" {
		t.Fatalf("step index not extracted as step identity: %+v", receipt)
	}
	if !receipt.StepProof {
		t.Fatalf("step proof not detected: %+v", receipt)
	}
}

func TestLedgerMatchesLatestSuccessfulTodoStep(t *testing.T) {
	ledger := NewLedger()
	ledger.Record(Receipt{
		ToolName: "todo_write",
		Success:  false,
		Todos:    []TodoItem{{Content: "Failed only", Status: "in_progress"}},
	})
	ledger.Record(Receipt{
		ToolName: "todo_write",
		Success:  true,
		Todos: []TodoItem{
			{Content: "Add parser", Status: "in_progress", ActiveForm: "Adding parser"},
			{Content: "Wire parser", Status: "completed"},
			{Content: "Document parser", Status: "pending"},
		},
	})

	for _, step := range []string{"Add parser", "Adding parser", "2"} {
		match, ok := ledger.MatchLatestTodoStep(step)
		if !ok {
			t.Fatalf("latest todo receipt missing for %q", step)
		}
		if !match.Found {
			t.Fatalf("step %q did not match latest todo list", step)
		}
		if step == "2" && match.Content != "Wire parser" {
			t.Fatalf("numeric step matched %q, want Wire parser", match.Content)
		}
	}

	match, ok := ledger.MatchLatestTodoStep("Failed only")
	if !ok {
		t.Fatal("successful todo receipt should exist")
	}
	if match.Found {
		t.Fatal("failed todo_write receipt must not match")
	}
}

func TestMatchTodoStepToleratesCitationDrift(t *testing.T) {
	// Verbatim shape from discussion #3970: todo authored with a fullwidth
	// colon, cited back with a halfwidth one — and stuck forever.
	ledger := NewLedger()
	ledger.Record(Receipt{
		ToolName: "todo_write",
		Success:  true,
		Todos: []TodoItem{
			{Content: "Phase 4：环境准备", Status: "completed"},
			{Content: "Phase 5：脚本编辑与执行代码", Status: "in_progress"},
			{Content: "Review notes", Status: "pending"},
		},
	})

	matches := map[string]int{
		"Phase 5: 脚本编辑与执行代码":  2,
		"phase 5：脚本编辑与执行代码":   2,
		"  Phase　5：脚本编辑与执行代码": 2,
		"脚本编辑与执行代码":           2,
		"Phase 4：环境":          1,
		"REVIEW NOTES":        3,
		"２":                   2,
	}
	for step, want := range matches {
		match, ok := ledger.MatchLatestTodoStep(step)
		if !ok || !match.Found {
			t.Fatalf("step %q should match todo %d, got found=%v", step, want, match.Found)
		}
		if match.Index != want {
			t.Errorf("step %q matched todo %d, want %d", step, match.Index, want)
		}
	}

	for _, step := range []string{"deploy backend", "代码", "Phase 9：不存在的阶段"} {
		if match, _ := ledger.MatchLatestTodoStep(step); match.Found {
			t.Errorf("step %q should not match, got todo %d (%q)", step, match.Index, match.Content)
		}
	}
}

func TestMatchTodoStepAmbiguousContainmentStaysUnmatched(t *testing.T) {
	ledger := NewLedger()
	ledger.Record(Receipt{
		ToolName: "todo_write",
		Success:  true,
		Todos: []TodoItem{
			{Content: "Deploy backend service", Status: "in_progress"},
			{Content: "Deploy backend worker", Status: "pending"},
		},
	})
	if match, _ := ledger.MatchLatestTodoStep("Deploy backend"); match.Found {
		t.Fatalf("ambiguous citation should stay unmatched, got todo %d (%q)", match.Index, match.Content)
	}
	if match, _ := ledger.MatchLatestTodoStep("Deploy backend worker"); !match.Found || match.Index != 2 {
		t.Fatal("exact citation must still resolve despite shared prefix")
	}
}

func TestLedgerRequiresCompleteStepForNewCompletedTodos(t *testing.T) {
	ledger := NewLedger()
	ledger.Record(Receipt{
		ToolName: "todo_write",
		Success:  true,
		Todos: []TodoItem{
			{Content: "Add parser", Status: "in_progress"},
			{Content: "Already done", Status: "completed"},
		},
	})

	current := []TodoItem{
		{Content: "Add parser", Status: "completed"},
		{Content: "Already done", Status: "completed"},
	}
	missing, hasBaseline := ledger.UnverifiedCompletedTodos(current)
	if !hasBaseline {
		t.Fatal("expected prior todo_write baseline")
	}
	if len(missing) != 1 || missing[0].Content != "Add parser" {
		t.Fatalf("missing = %+v, want only Add parser", missing)
	}

	ledger.Record(Receipt{ToolName: "complete_step", Success: false, Step: "Add parser"})
	missing, hasBaseline = ledger.UnverifiedCompletedTodos(current)
	if !hasBaseline {
		t.Fatal("expected prior todo_write baseline after failed complete_step")
	}
	if len(missing) != 1 || missing[0].Content != "Add parser" {
		t.Fatalf("failed complete_step without proof-bearing recovery should not authorize completion, missing = %+v", missing)
	}

	ledger.Record(Receipt{ToolName: "complete_step", Success: true, Step: "Add parser"})
	missing, hasBaseline = ledger.UnverifiedCompletedTodos(current)
	if !hasBaseline {
		t.Fatal("expected prior todo_write baseline after successful complete_step")
	}
	if len(missing) != 0 {
		t.Fatalf("successful complete_step should authorize completion, missing = %+v", missing)
	}
}

func TestLedgerMatchesCompletionByActiveFormAndNumber(t *testing.T) {
	ledger := NewLedger()
	ledger.Record(Receipt{
		ToolName: "todo_write",
		Success:  true,
		Todos: []TodoItem{
			{Content: "Add parser", Status: "in_progress", ActiveForm: "Adding parser"},
			{Content: "Wire parser", Status: "in_progress"},
		},
	})

	current := []TodoItem{
		{Content: "Add parser", Status: "completed", ActiveForm: "Adding parser"},
		{Content: "Wire parser", Status: "in_progress"},
	}
	ledger.Record(Receipt{ToolName: "complete_step", Success: true, Step: "Adding parser"})
	missing, hasBaseline := ledger.UnverifiedCompletedTodos(current)
	if !hasBaseline {
		t.Fatal("expected prior todo_write baseline")
	}
	if len(missing) != 0 {
		t.Fatalf("activeForm complete_step should authorize completion, missing = %+v", missing)
	}

	current = []TodoItem{
		{Content: "Add parser", Status: "completed", ActiveForm: "Adding parser"},
		{Content: "Wire parser", Status: "completed"},
	}
	ledger.Record(Receipt{ToolName: "complete_step", Success: true, Step: "2"})
	missing, hasBaseline = ledger.UnverifiedCompletedTodos(current)
	if !hasBaseline {
		t.Fatal("expected prior todo_write baseline")
	}
	if len(missing) != 0 {
		t.Fatalf("numeric complete_step should authorize completion, missing = %+v", missing)
	}
}

func TestLedgerNumericCompleteStepDoesNotAuthorizeReplacedTodo(t *testing.T) {
	ledger := NewLedger()
	ledger.Record(Receipt{
		ToolName: "todo_write",
		Success:  true,
		Todos:    []TodoItem{{Content: "Add parser", Status: "in_progress"}},
	})
	ledger.Record(Receipt{ToolName: "complete_step", Success: true, Step: "1"})

	missing, hasBaseline := ledger.UnverifiedCompletedTodos([]TodoItem{
		{Content: "Ship parser", Status: "completed"},
	})
	if !hasBaseline {
		t.Fatal("expected prior todo_write baseline")
	}
	if len(missing) != 1 || missing[0].Content != "Ship parser" {
		t.Fatalf("numeric complete_step should not authorize a replaced todo, missing = %+v", missing)
	}
}

func TestLedgerNumericCompleteStepFollowsReorderedSignedTodo(t *testing.T) {
	ledger := NewLedger()
	ledger.Record(Receipt{
		ToolName: "todo_write",
		Success:  true,
		Todos: []TodoItem{
			{Content: "Add parser", Status: "in_progress"},
			{Content: "Write tests", Status: "pending"},
		},
	})
	ledger.Record(Receipt{ToolName: "complete_step", Success: true, Step: "1"})

	missing, hasBaseline := ledger.UnverifiedCompletedTodos([]TodoItem{
		{Content: "Write tests", Status: "pending"},
		{Content: "Add parser", Status: "completed"},
	})
	if !hasBaseline {
		t.Fatal("expected prior todo_write baseline")
	}
	if len(missing) != 0 {
		t.Fatalf("numeric complete_step should follow the signed todo identity after reorder, missing = %+v", missing)
	}
}

func TestLedgerNoBaselineDoesNotConstrainCompletedTodos(t *testing.T) {
	ledger := NewLedger()
	missing, hasBaseline := ledger.UnverifiedCompletedTodos([]TodoItem{
		{Content: "Add parser", Status: "completed"},
	})

	if hasBaseline {
		t.Fatal("empty ledger should not report a prior todo_write baseline")
	}
	if len(missing) != 0 {
		t.Fatalf("no baseline should not report missing completions, got %+v", missing)
	}
}

func TestLedgerNumericCompleteStepAuthorizesRephrasedTodo(t *testing.T) {
	ledger := NewLedger()
	ledger.Record(Receipt{
		ToolName: "todo_write",
		Success:  true,
		Todos: []TodoItem{
			{Content: "Add parser", Status: "in_progress"},
			{Content: "Write tests", Status: "pending"},
		},
	})
	ledger.Record(Receipt{ToolName: "complete_step", Success: true, Step: "1"})

	// The model rephrased item 1 (added detail) but it's the same task.
	missing, hasBaseline := ledger.UnverifiedCompletedTodos([]TodoItem{
		{Content: "Add parser with streaming support", Status: "completed"},
		{Content: "Write tests", Status: "pending"},
	})
	if !hasBaseline {
		t.Fatal("expected prior todo_write baseline")
	}
	if len(missing) != 0 {
		t.Fatalf("rephrased todo at same index should be authorized by content overlap, missing = %+v", missing)
	}

	// The model also rephrased item 2; still ok because the new text contains the old.
	missing, hasBaseline = ledger.UnverifiedCompletedTodos([]TodoItem{
		{Content: "Add parser with streaming support", Status: "completed"},
		{Content: "Write tests and benchmarks", Status: "completed"},
	})
	if !hasBaseline {
		t.Fatal("expected prior todo_write baseline for second rephrase")
	}
	// Item 1 is already authorized; item 2 is also rephrased but lacks a
	// complete_step — so it should still be flagged.
	if len(missing) != 1 || missing[0].Content != "Write tests and benchmarks" {
		t.Fatalf("rephrased todo without complete_step should still be missing, got %+v", missing)
	}
}
