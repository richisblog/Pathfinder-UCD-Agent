package documentextract

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestExtractPDFWithoutHostTools(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	path := filepath.Join(t.TempDir(), "Jin-fixture.pdf")
	writeSimplePDF(t, path, "UC Davis academic plan")

	got := ExtractFile(path, DefaultLimits())
	if got.Status != StatusReady {
		t.Fatalf("ExtractFile = %+v", got)
	}
	if got.Method != "go-pdf" || !strings.Contains(got.Text, "UC Davis academic plan") {
		t.Fatalf("portable extraction missing text: %+v", got)
	}
	if got.Pages != 1 {
		t.Fatalf("pages = %d, want 1", got.Pages)
	}
}

func TestExtractPDFClassifiesNoTextAsOCRRequired(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scan.pdf")
	writeSimpleImageOnlyPDF(t, path)
	got := ExtractFile(path, DefaultLimits())
	if got.Status != StatusOCRRequired || got.Code != "ocr_required" {
		t.Fatalf("ExtractFile = %+v", got)
	}
}

func TestExtractPDFReportsMalformedInput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "broken.pdf")
	if err := os.WriteFile(path, []byte("%PDF-1.7 broken"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := ExtractFile(path, DefaultLimits())
	if got.Status != StatusFailed || got.Code != "pdf_parse_failed" {
		t.Fatalf("ExtractFile = %+v", got)
	}
}

func writeSimplePDF(t *testing.T, path, text string) {
	t.Helper()
	content := "BT /F1 12 Tf 72 720 Td (" + escapePDFString(text) + ") Tj ET\n"
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		streamObject(content),
	}
	writePDF(t, path, objects)
}

func writeSimpleImageOnlyPDF(t *testing.T, path string) {
	t.Helper()
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>",
		streamObject("q 1 0 0 1 0 0 cm /Im0 Do Q\n"),
		"<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3 >>\nstream\n\x00\x00\x00\nendstream",
	}
	writePDF(t, path, objects)
}

func writePDF(t *testing.T, path string, objects []string) {
	t.Helper()
	var pdf strings.Builder
	pdf.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objects)+1)
	for i, object := range objects {
		offsets[i+1] = pdf.Len()
		fmt.Fprintf(&pdf, "%d 0 obj\n%s\nendobj\n", i+1, object)
	}
	xref := pdf.Len()
	fmt.Fprintf(&pdf, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
	for _, offset := range offsets[1:] {
		fmt.Fprintf(&pdf, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&pdf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, xref)
	if err := os.WriteFile(path, []byte(pdf.String()), 0o644); err != nil {
		t.Fatal(err)
	}
}

func streamObject(content string) string {
	return "<< /Length " + strconv.Itoa(len(content)) + " >>\nstream\n" + content + "endstream"
}

func escapePDFString(text string) string {
	return strings.NewReplacer("\\", "\\\\", "(", "\\(", ")", "\\)").Replace(text)
}
