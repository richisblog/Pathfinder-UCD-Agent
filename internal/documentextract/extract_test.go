package documentextract

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestExtractPlainTextAndStructuredText(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
		want string
	}{
		{"notes.txt", "课程计划\nECS 150", "ECS 150"},
		{"plan.md", "# Plan\n- ECS 150", "ECS 150"},
		{"courses.csv", "course,units\nECS 150,4\n", "ECS 150"},
		{"profile.json", `{"major":"Computer Science"}`, "Computer Science"},
		{"config.yaml", "college: Engineering\n", "Engineering"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), tc.name)
			if err := os.WriteFile(path, []byte(tc.body), 0o644); err != nil {
				t.Fatal(err)
			}
			got := ExtractFile(path, DefaultLimits())
			if got.Status != StatusReady || !strings.Contains(got.Text, tc.want) {
				t.Fatalf("ExtractFile = %+v", got)
			}
		})
	}
}

func TestExtractTruncatesAtValidUTF8Boundary(t *testing.T) {
	path := filepath.Join(t.TempDir(), "large.txt")
	if err := os.WriteFile(path, []byte(strings.Repeat("课", 100)), 0o644); err != nil {
		t.Fatal(err)
	}
	got := ExtractFile(path, Limits{MaxSourceBytes: 1024, MaxTextBytes: 31})
	if got.Status != StatusTruncated || !got.Truncated {
		t.Fatalf("ExtractFile = %+v, want truncated", got)
	}
	if !utf8.ValidString(got.Text) {
		t.Fatalf("truncated text is invalid UTF-8: %q", got.Text)
	}
}

func TestExtractRejectsOversizedAndUnsupportedFiles(t *testing.T) {
	dir := t.TempDir()
	large := filepath.Join(dir, "large.txt")
	if err := os.WriteFile(large, []byte(strings.Repeat("x", 33)), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := ExtractFile(large, Limits{MaxSourceBytes: 32, MaxTextBytes: 64}); got.Status != StatusFailed || got.Code != "source_too_large" {
		t.Fatalf("oversized = %+v", got)
	}
	zip := filepath.Join(dir, "archive.zip")
	if err := os.WriteFile(zip, []byte("PK\x03\x04"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := ExtractFile(zip, DefaultLimits()); got.Status != StatusUnsupported {
		t.Fatalf("unsupported = %+v", got)
	}
}

func TestExtractPlainTextRejectsBinaryContent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "binary.txt")
	if err := os.WriteFile(path, []byte("academic\x00plan"), 0o644); err != nil {
		t.Fatal(err)
	}

	got := ExtractFile(path, DefaultLimits())
	if got.Status != StatusUnsupported || got.Code != "binary_content" {
		t.Fatalf("ExtractFile = %+v", got)
	}
}

func TestExtractPlainTextPreservesUTF16(t *testing.T) {
	path := filepath.Join(t.TempDir(), "plan.txt")
	utf16LE := []byte{0xff, 0xfe, 'E', 0, 'C', 0, 'S', 0, ' ', 0, '1', 0, '5', 0, '0', 0, ' ', 0, 0xfe, 0x8b}
	if err := os.WriteFile(path, utf16LE, 0o644); err != nil {
		t.Fatal(err)
	}

	got := ExtractFile(path, DefaultLimits())
	if got.Status != StatusReady || !strings.Contains(got.Text, "ECS 150 课") {
		t.Fatalf("ExtractFile = %+v", got)
	}
}
