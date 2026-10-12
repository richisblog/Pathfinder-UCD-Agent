package evidence

import (
	"encoding/json"
	"testing"
)

func TestHasSuccessfulNamedTool(t *testing.T) {
	t.Parallel()

	ledger := NewLedger()
	ledger.Record(Receipt{ToolName: "read_file", Success: true, Read: true})
	ledger.Record(Receipt{ToolName: "query_course_db", Args: json.RawMessage(`{"query":"ECS 150"}`), Success: true, Read: true})

	if !ledger.HasSuccessfulNamedTool(map[string]bool{"query_course_db": true}) {
		t.Fatal("successful configured campus tool was not found")
	}
	if ledger.HasSuccessfulNamedTool(map[string]bool{"query_major_catalog": true}) {
		t.Fatal("unseen campus tool reported as successful")
	}
}
