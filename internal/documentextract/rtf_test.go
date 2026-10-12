package documentextract

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExtractRTFReadsVisibleTextAndUnicode(t *testing.T) {
	path := filepath.Join(t.TempDir(), "academic-plan.rtf")
	body := `{\rtf1\ansi Academic plan\par ECS 150\tab four units\par Unicode \u35838?}`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	got := ExtractFile(path, DefaultLimits())
	if got.Status != StatusReady || got.Method != "rtf-state-machine" {
		t.Fatalf("ExtractFile = %+v", got)
	}
	for _, want := range []string{"Academic plan", "ECS 150\tfour units", "Unicode 课"} {
		if !strings.Contains(got.Text, want) {
			t.Fatalf("text = %q, want %q", got.Text, want)
		}
	}
	if strings.Contains(got.Text, "\\par") || strings.Contains(got.Text, "\\tab") {
		t.Fatalf("control words leaked into text: %q", got.Text)
	}
}

func TestExtractRTFRejectsUnbalancedBraces(t *testing.T) {
	path := filepath.Join(t.TempDir(), "broken.rtf")
	if err := os.WriteFile(path, []byte(`{\rtf1 missing brace`), 0o644); err != nil {
		t.Fatal(err)
	}

	got := ExtractFile(path, DefaultLimits())
	if got.Status != StatusFailed || got.Code != "rtf_parse_failed" {
		t.Fatalf("ExtractFile = %+v", got)
	}
}

func TestExtractRTFSkipsUnicodeFallbackAfterControlDelimiter(t *testing.T) {
	path := filepath.Join(t.TempDir(), "unicode.rtf")
	if err := os.WriteFile(path, []byte(`{\rtf1 Unicode \u35838 ?}`), 0o644); err != nil {
		t.Fatal(err)
	}

	got := ExtractFile(path, DefaultLimits())
	if got.Status != StatusReady || got.Text != "Unicode 课" {
		t.Fatalf("ExtractFile = %+v", got)
	}
}

func TestExtractRTFPreservesDirectUTF8Text(t *testing.T) {
	path := filepath.Join(t.TempDir(), "utf8.rtf")
	if err := os.WriteFile(path, []byte(`{\rtf1\ansi 学术计划：ECS 150}`), 0o644); err != nil {
		t.Fatal(err)
	}

	got := ExtractFile(path, DefaultLimits())
	if got.Status != StatusReady || got.Text != "学术计划：ECS 150" {
		t.Fatalf("ExtractFile = %+v", got)
	}
}
