package documentextract

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExtractDOCXReadsParagraphsAndTableCells(t *testing.T) {
	path := filepath.Join(t.TempDir(), "academic-plan.docx")
	writeDOCX(t, path, `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Major: Computer Science</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>ECS 150</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body>
</w:document>`)

	got := ExtractFile(path, DefaultLimits())
	if got.Status != StatusReady || got.Method != "docx-xml" {
		t.Fatalf("ExtractFile = %+v", got)
	}
	if !strings.Contains(got.Text, "Major: Computer Science\n") || !strings.Contains(got.Text, "ECS 150\n") {
		t.Fatalf("text = %q, want separate paragraph lines", got.Text)
	}
}

func TestExtractDOCXReportsCorruptZIP(t *testing.T) {
	path := filepath.Join(t.TempDir(), "corrupt.docx")
	if err := os.WriteFile(path, []byte("not a zip"), 0o644); err != nil {
		t.Fatal(err)
	}

	got := ExtractFile(path, DefaultLimits())
	if got.Status != StatusFailed || got.Code != "docx_parse_failed" {
		t.Fatalf("ExtractFile = %+v", got)
	}
}

func writeDOCX(t *testing.T, path, documentXML string) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	entry, err := archive.Create("word/document.xml")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte(documentXML)); err != nil {
		t.Fatal(err)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}
