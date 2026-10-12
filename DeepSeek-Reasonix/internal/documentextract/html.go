package documentextract

import (
	"encoding/xml"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	"golang.org/x/net/html"
)

func extractHTML(path string, size int64, limits Limits) Result {
	if strings.EqualFold(filepath.Ext(path), ".xml") {
		return extractXML(path, size, limits)
	}

	file, err := os.Open(path)
	if err != nil {
		return failed("html", size, "read_failed", err)
	}
	defer file.Close()

	text := newBoundedText(limits.MaxTextBytes)
	tokenizer := html.NewTokenizer(file)
	ignoredTags := make([]string, 0, 2)
	for {
		tokenType := tokenizer.Next()
		if tokenType == html.ErrorToken {
			if err := tokenizer.Err(); err != io.EOF {
				return failed("html", size, "html_parse_failed", err)
			}
			break
		}
		token := tokenizer.Token()
		name := strings.ToLower(token.Data)
		switch tokenType {
		case html.StartTagToken:
			if ignoredHTMLTag(name) {
				ignoredTags = append(ignoredTags, name)
				continue
			}
			if len(ignoredTags) > 0 {
				continue
			}
			if htmlBoundaryTag(name) && text.Len() > 0 && !text.writeString("\n") {
				return readyText("html", "html-tokenizer", normalizeExtractedWhitespace(text.String()), size, limits)
			}
		case html.EndTagToken:
			if len(ignoredTags) > 0 {
				if name == ignoredTags[len(ignoredTags)-1] {
					ignoredTags = ignoredTags[:len(ignoredTags)-1]
				}
				continue
			}
			if htmlBoundaryTag(name) && text.Len() > 0 && !text.writeString("\n") {
				return readyText("html", "html-tokenizer", normalizeExtractedWhitespace(text.String()), size, limits)
			}
		case html.SelfClosingTagToken:
			if len(ignoredTags) == 0 && htmlBoundaryTag(name) && text.Len() > 0 && !text.writeString("\n") {
				return readyText("html", "html-tokenizer", normalizeExtractedWhitespace(text.String()), size, limits)
			}
		case html.TextToken:
			if len(ignoredTags) == 0 && !text.writeString(token.Data) {
				return readyText("html", "html-tokenizer", normalizeExtractedWhitespace(text.String()), size, limits)
			}
		}
	}
	return readyText("html", "html-tokenizer", normalizeExtractedWhitespace(text.String()), size, limits)
}

func extractXML(path string, size int64, limits Limits) Result {
	file, err := os.Open(path)
	if err != nil {
		return failed("xml", size, "read_failed", err)
	}
	defer file.Close()

	decoder := xml.NewDecoder(file)
	text := newBoundedText(limits.MaxTextBytes)
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return failed("xml", size, "xml_parse_failed", err)
		}
		if value, ok := token.(xml.CharData); ok && len(value) > 0 {
			if text.Len() > 0 && !text.writeString(" ") {
				break
			}
			if !text.writeString(string(value)) {
				break
			}
		}
	}
	return readyText("xml", "xml-decoder", normalizeExtractedWhitespace(text.String()), size, limits)
}

func ignoredHTMLTag(name string) bool {
	switch name {
	case "head", "title", "script", "style", "noscript", "template":
		return true
	default:
		return false
	}
}

func htmlBoundaryTag(name string) bool {
	switch name {
	case "br", "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "td", "th":
		return true
	default:
		return false
	}
}

func normalizeExtractedWhitespace(value string) string {
	var text strings.Builder
	pendingSpace := false
	for _, r := range value {
		if r == '\n' {
			pendingSpace = false
			if text.Len() > 0 && !strings.HasSuffix(text.String(), "\n") {
				text.WriteByte('\n')
			}
			continue
		}
		if unicode.IsSpace(r) {
			pendingSpace = true
			continue
		}
		if pendingSpace && text.Len() > 0 && !strings.HasSuffix(text.String(), "\n") {
			text.WriteByte(' ')
		}
		pendingSpace = false
		text.WriteRune(r)
	}
	return strings.TrimSpace(text.String())
}
