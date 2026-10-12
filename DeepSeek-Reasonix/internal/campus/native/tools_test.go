package native

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"reasonix/internal/campus/tools"
)

func TestToolsExposeReasonixNativeCampusTools(t *testing.T) {
	dir := t.TempDir()
	textDir := filepath.Join(dir, "txt")
	if err := os.MkdirAll(textDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(textDir, "policy.txt"), []byte("AP credit may satisfy some campus requirements."), 0o644); err != nil {
		t.Fatal(err)
	}

	nativeTools := Tools(tools.Paths{TextDir: textDir})
	if len(nativeTools) == 0 {
		t.Fatal("expected campus tools")
	}
	var search toolLike
	for _, candidate := range nativeTools {
		if candidate.Name() == "search_txt_context" {
			search = candidate
			break
		}
	}
	if search == nil {
		t.Fatal("search_txt_context not registered")
	}
	if !search.ReadOnly() {
		t.Fatal("campus tools must be read-only")
	}
	if !json.Valid(search.Schema()) {
		t.Fatalf("invalid schema: %s", search.Schema())
	}
	out, err := search.Execute(context.Background(), json.RawMessage(`{"query":"AP credit","limit":2}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "AP credit") {
		t.Fatalf("tool output = %s", out)
	}
}

func TestSystemPromptDefinesProgressAwareAcademicContract(t *testing.T) {
	t.Parallel()

	for _, want := range []string{
		"Pathfinder",
		"Consultation modes",
		"Progress-aware loop",
		"Tool planning",
		"Missing information",
		"Completion check",
		"todo_write",
		"compare_change_major_requirements",
		"student-friendly",
		"untrusted evidence",
	} {
		if !strings.Contains(SystemPromptAddon, want) {
			t.Errorf("SystemPromptAddon missing %q", want)
		}
	}
	for _, want := range []string{
		"known and unknown",
		"full todo_write snapshot",
		"successful tool evidence",
		"failed tool results",
		"remove it from unknown",
		"student's selected response language",
		"each known entry must come only from an explicit user fact or answer or successful tool evidence",
		"inference or general experience",
		"relevant user answer, successful, empty, or failed tool results, and todo status change",
	} {
		if !strings.Contains(strings.ToLower(SystemPromptAddon), want) {
			t.Errorf("SystemPromptAddon missing %q", want)
		}
	}
	for _, obsolete := range []string{
		"output the content directly in the chat and instruct the user to copy-paste it",
		"read custom skills",
	} {
		if strings.Contains(SystemPromptAddon, obsolete) {
			t.Errorf("SystemPromptAddon contains obsolete instruction %q", obsolete)
		}
	}
}

func TestSystemPromptRejectsUnsupportedCampusGuesses(t *testing.T) {
	t.Parallel()
	for _, want := range []string{
		"Never invent campus-specific facts",
		"ambiguous Summer",
	} {
		if !strings.Contains(SystemPromptAddon, want) {
			t.Errorf("SystemPromptAddon missing %q", want)
		}
	}
}

func TestSystemPromptDefinesPassAndPacificTimeContract(t *testing.T) {
	t.Parallel()
	for _, want := range []string{
		"Pass 1",
		"Pass 2",
		"convert_pacific_time",
		"America/Los_Angeles",
		"PST or PDT",
		"registration deadline",
		"offset arithmetic",
		"Zoom",
		"advising",
	} {
		if !strings.Contains(SystemPromptAddon, want) {
			t.Errorf("SystemPromptAddon missing %q", want)
		}
	}
}

func TestDataToolNamesExcludeProgressTool(t *testing.T) {
	t.Parallel()

	names := DataToolNames(tools.Paths{})
	joined := strings.Join(names, ",")
	if strings.Contains(joined, "todo_write") {
		t.Fatalf("progress tool included in data tools: %v", names)
	}
	for _, want := range []string{"query_course_db", "search_professors", "compare_change_major_requirements"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("data tool %q missing from %v", want, names)
		}
	}
	if !strings.Contains(joined, "convert_pacific_time") {
		t.Fatalf("Pacific time tool missing from %v", names)
	}
}

func TestToolsRegisterPacificTimeTool(t *testing.T) {
	t.Parallel()
	for _, candidate := range Tools(tools.Paths{}) {
		if candidate.Name() == "convert_pacific_time" {
			if !candidate.ReadOnly() || !json.Valid(candidate.Schema()) {
				t.Fatalf("invalid Pacific time tool contract")
			}
			return
		}
	}
	t.Fatal("convert_pacific_time not registered")
}

type toolLike interface {
	Name() string
	Schema() json.RawMessage
	ReadOnly() bool
	Execute(context.Context, json.RawMessage) (string, error)
}
