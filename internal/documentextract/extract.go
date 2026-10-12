package documentextract

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type Status string

const (
	StatusReady       Status = "ready"
	StatusTruncated   Status = "truncated"
	StatusOCRRequired Status = "ocr_required"
	StatusUnsupported Status = "unsupported"
	StatusFailed      Status = "failed"
)

type Limits struct {
	MaxSourceBytes int64
	MaxTextBytes   int
}

type Result struct {
	Format     string `json:"format"`
	Text       string `json:"text,omitempty"`
	Pages      int    `json:"pages,omitempty"`
	Bytes      int64  `json:"bytes"`
	Characters int    `json:"characters"`
	Truncated  bool   `json:"truncated"`
	Status     Status `json:"status"`
	Method     string `json:"method,omitempty"`
	Code       string `json:"code,omitempty"`
	Warning    string `json:"warning,omitempty"`
}

func DefaultLimits() Limits {
	return Limits{MaxSourceBytes: 25 << 20, MaxTextBytes: 512 << 10}
}

// ExtractFile reads a supported regular file within the supplied source and
// extracted-text limits.
func ExtractFile(path string, limits Limits) Result {
	info, err := os.Stat(path)
	if err != nil {
		return failed("", 0, "stat_failed", err)
	}
	if !info.Mode().IsRegular() {
		return failed("", info.Size(), "not_regular_file", errors.New("document is not a regular file"))
	}
	if limits.MaxSourceBytes < 0 || limits.MaxTextBytes < 0 {
		return failed("", info.Size(), "invalid_limits", errors.New("document limits must not be negative"))
	}
	if info.Size() > limits.MaxSourceBytes {
		return failed("", info.Size(), "source_too_large", errors.New("document exceeds source size limit"))
	}

	format := strings.TrimPrefix(strings.ToLower(filepath.Ext(path)), ".")
	switch format {
	case "txt", "md", "markdown", "csv", "tsv", "json", "yaml", "yml":
		return extractPlainText(path, format, info.Size(), limits)
	case "html", "htm", "xml":
		return extractHTML(path, info.Size(), limits)
	case "docx":
		return extractDOCX(path, info.Size(), limits)
	case "rtf":
		return extractRTF(path, info.Size(), limits)
	case "pdf":
		return extractPDF(path, info.Size(), limits)
	default:
		return unsupported(format, info.Size(), "unsupported_format", "This file format is not supported.")
	}
}

func failed(format string, size int64, code string, err error) Result {
	result := Result{
		Format: format,
		Bytes:  size,
		Status: StatusFailed,
		Code:   code,
	}
	if err != nil {
		result.Warning = err.Error()
	}
	return result
}

func unsupported(format string, size int64, code, warning string) Result {
	return Result{
		Format:  format,
		Bytes:   size,
		Status:  StatusUnsupported,
		Code:    code,
		Warning: warning,
	}
}
