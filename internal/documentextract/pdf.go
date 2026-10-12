package documentextract

import (
	"bytes"
	"strings"

	pdf "github.com/ledongthuc/pdf"
)

func extractPDF(path string, size int64, limits Limits) Result {
	file, reader, err := pdf.Open(path)
	if err != nil {
		return failed("pdf", size, "pdf_parse_failed", err)
	}
	defer file.Close()

	stream, err := reader.GetPlainText()
	if err != nil {
		return failed("pdf", size, "pdf_extract_failed", err)
	}
	var body bytes.Buffer
	if _, err := body.ReadFrom(stream); err != nil {
		return failed("pdf", size, "pdf_extract_failed", err)
	}
	if strings.TrimSpace(body.String()) == "" {
		return Result{
			Format: "pdf", Pages: reader.NumPage(), Bytes: size,
			Status: StatusOCRRequired, Method: "go-pdf",
			Code:    "ocr_required",
			Warning: "No extractable text was found; this PDF may contain scanned images.",
		}
	}
	out := readyText("pdf", "go-pdf", body.String(), size, limits)
	out.Pages = reader.NumPage()
	return out
}
