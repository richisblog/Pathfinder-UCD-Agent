// Package documentextracttest provides document fixtures for integration tests.
package documentextracttest

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"
)

// WriteSimplePDF writes a one-page PDF whose text can be read by the portable
// document extractor.
func WriteSimplePDF(t *testing.T, path, text string) {
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

// WriteSimpleImageOnlyPDF writes a one-page PDF with no extractable text.
func WriteSimpleImageOnlyPDF(t *testing.T, path string) {
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
