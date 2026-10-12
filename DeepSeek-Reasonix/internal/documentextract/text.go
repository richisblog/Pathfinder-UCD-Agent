package documentextract

import (
	"bytes"
	"os"
	"strings"
	"unicode/utf8"

	fileenc "reasonix/internal/fileutil/encoding"
)

func extractPlainText(path, format string, size int64, limits Limits) Result {
	data, err := os.ReadFile(path)
	if err != nil {
		return failed(format, size, "read_failed", err)
	}
	if int64(len(data)) > limits.MaxSourceBytes {
		return failed(format, int64(len(data)), "source_too_large", nil)
	}

	peek := data
	if len(peek) > 8<<10 {
		peek = peek[:8<<10]
	}
	encoding, _ := fileenc.Detect(data)
	if bytes.IndexByte(peek, 0) >= 0 && !isUTF16(encoding) {
		return unsupported(format, size, "binary_content", "The document appears to contain binary content.")
	}

	return readyText(format, "plain-text", string(fileenc.Decode(data, encoding)), size, limits)
}

func readyText(format, method, text string, size int64, limits Limits) Result {
	text = strings.ToValidUTF8(text, "�")
	truncated := len(text) > limits.MaxTextBytes
	if truncated {
		end := limits.MaxTextBytes
		for end > 0 && end < len(text) && !utf8.RuneStart(text[end]) {
			end--
		}
		text = text[:end]
	}

	status := StatusReady
	if truncated {
		status = StatusTruncated
	}
	return Result{
		Format:     format,
		Text:       text,
		Bytes:      size,
		Characters: utf8.RuneCountInString(text),
		Truncated:  truncated,
		Status:     status,
		Method:     method,
	}
}

func isUTF16(encoding fileenc.Kind) bool {
	return encoding == fileenc.UTF16LE || encoding == fileenc.UTF16BE ||
		encoding == fileenc.UTF16LENoBOM || encoding == fileenc.UTF16BENoBOM
}
