package documentextract

import (
	"archive/zip"
	"encoding/xml"
	"errors"
	"io"
	"strings"
	"unicode/utf8"
)

func extractDOCX(path string, size int64, limits Limits) Result {
	archive, err := zip.OpenReader(path)
	if err != nil {
		return failed("docx", size, "docx_parse_failed", err)
	}
	defer archive.Close()

	var document *zip.File
	for _, file := range archive.File {
		if file.Name == "word/document.xml" {
			document = file
			break
		}
	}
	if document == nil {
		return failed("docx", size, "docx_parse_failed", errors.New("DOCX is missing word/document.xml"))
	}

	part, err := document.Open()
	if err != nil {
		return failed("docx", size, "docx_parse_failed", err)
	}
	defer part.Close()

	text, err := extractDOCXText(part, limits)
	if err != nil {
		return failed("docx", size, "docx_parse_failed", err)
	}
	return readyText("docx", "docx-xml", text.String(), size, limits)
}

func extractDOCXText(part io.Reader, limits Limits) (*boundedText, error) {
	decoder := xml.NewDecoder(part)
	text := newBoundedText(limits.MaxTextBytes)
	textDepth := 0
	inRow := false
	cellCount := 0

	for {
		token, err := decoder.Token()
		if err == io.EOF {
			return text, nil
		}
		if err != nil {
			return nil, err
		}

		switch value := token.(type) {
		case xml.StartElement:
			switch value.Name.Local {
			case "p":
				if text.Len() > 0 && !text.writeString("\n") {
					return text, nil
				}
			case "tr":
				inRow = true
				cellCount = 0
			case "tc":
				if inRow && cellCount > 0 && !text.writeString("\t") {
					return text, nil
				}
				if inRow {
					cellCount++
				}
			case "t":
				textDepth++
			}
		case xml.EndElement:
			switch value.Name.Local {
			case "t":
				if textDepth > 0 {
					textDepth--
				}
			case "tr":
				inRow = false
			case "p":
				if text.Len() > 0 && !text.writeString("\n") {
					return text, nil
				}
			}
		case xml.CharData:
			if textDepth > 0 && !text.writeString(string(value)) {
				return text, nil
			}
		}
	}
}

// boundedText keeps extracted data near the common output limit. It retains a
// complete rune beyond the limit so readyText can report truncation safely.
type boundedText struct {
	body     strings.Builder
	capacity int
}

func newBoundedText(limit int) *boundedText {
	capacity := limit + utf8.UTFMax
	if capacity < limit {
		capacity = limit
	}
	return &boundedText{capacity: capacity}
}

func (text *boundedText) Len() int {
	return text.body.Len()
}

func (text *boundedText) String() string {
	return text.body.String()
}

func (text *boundedText) writeString(value string) bool {
	for _, r := range value {
		if text.body.Len()+utf8.RuneLen(r) > text.capacity {
			return false
		}
		text.body.WriteRune(r)
	}
	return true
}
