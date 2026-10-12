package documentextract

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExtractHTMLReadsVisibleTextWithBoundaries(t *testing.T) {
	path := filepath.Join(t.TempDir(), "degree-audit.html")
	body := `<html><head><title>Ignored</title><script>bad()</script></head>
<body><h1>Degree audit</h1><p>Missing ECS 150</p><a href="/advising">Advising</a></body></html>`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	got := ExtractFile(path, DefaultLimits())
	if got.Status != StatusReady || got.Method != "html-tokenizer" {
		t.Fatalf("ExtractFile = %+v", got)
	}
	for _, want := range []string{"Degree audit\n", "Missing ECS 150\n", "Advising"} {
		if !strings.Contains(got.Text, want) {
			t.Fatalf("text = %q, want %q", got.Text, want)
		}
	}
	if strings.Contains(got.Text, "Ignored") || strings.Contains(got.Text, "bad()") {
		t.Fatalf("non-visible HTML text leaked into output: %q", got.Text)
	}
}

func TestExtractXMLKeepsXMLFormatLabel(t *testing.T) {
	path := filepath.Join(t.TempDir(), "degree-audit.xml")
	if err := os.WriteFile(path, []byte(`<audit><major>Computer Science</major><course>ECS 150</course></audit>`), 0o644); err != nil {
		t.Fatal(err)
	}

	got := ExtractFile(path, DefaultLimits())
	if got.Status != StatusReady || got.Format != "xml" || got.Method != "xml-decoder" {
		t.Fatalf("ExtractFile = %+v", got)
	}
	if !strings.Contains(got.Text, "Computer Science") || !strings.Contains(got.Text, "ECS 150") {
		t.Fatalf("text = %q", got.Text)
	}
}

func TestExtractHTMLResumesAfterVoidHeadElement(t *testing.T) {
	path := filepath.Join(t.TempDir(), "with-meta.html")
	body := `<html><head><meta charset="utf-8"><title>Ignored</title></head><body><p>ECS 150</p></body></html>`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	got := ExtractFile(path, DefaultLimits())
	if got.Status != StatusReady || got.Text != "ECS 150" {
		t.Fatalf("ExtractFile = %+v", got)
	}
}
