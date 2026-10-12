package documentextract

import (
	"errors"
	"os"
	"strconv"
	"unicode/utf8"
)

func extractRTF(path string, size int64, limits Limits) Result {
	data, err := os.ReadFile(path)
	if err != nil {
		return failed("rtf", size, "read_failed", err)
	}

	text, err := parseRTF(data, limits)
	if err != nil {
		return failed("rtf", size, "rtf_parse_failed", err)
	}
	return readyText("rtf", "rtf-state-machine", text.String(), size, limits)
}

func parseRTF(data []byte, limits Limits) (*boundedText, error) {
	text := newBoundedText(limits.MaxTextBytes)
	skipped := []bool{false}

	for index := 0; index < len(data); {
		current := data[index]
		switch current {
		case '{':
			skipped = append(skipped, skipped[len(skipped)-1])
			index++
		case '}':
			if len(skipped) == 1 {
				return nil, errors.New("unexpected closing brace")
			}
			skipped = skipped[:len(skipped)-1]
			index++
		case '\\':
			next, err := consumeRTFControl(data, index, text, &skipped[len(skipped)-1])
			if err != nil {
				return nil, err
			}
			index = next
		default:
			runeValue, width := utf8.DecodeRune(data[index:])
			if runeValue == utf8.RuneError && width == 1 {
				runeValue = rune(current)
			}
			if !skipped[len(skipped)-1] && !text.writeString(string(runeValue)) {
				return text, nil
			}
			index += width
		}
	}

	if len(skipped) != 1 {
		return nil, errors.New("unbalanced braces")
	}
	return text, nil
}

func consumeRTFControl(data []byte, index int, text *boundedText, skip *bool) (int, error) {
	if index+1 >= len(data) {
		return 0, errors.New("trailing backslash")
	}
	index++
	control := data[index]
	switch control {
	case '\\', '{', '}':
		if !*skip && !text.writeString(string(control)) {
			return len(data), nil
		}
		return index + 1, nil
	case '*':
		*skip = true
		return index + 1, nil
	case '\'':
		if index+2 >= len(data) {
			return 0, errors.New("incomplete hexadecimal escape")
		}
		value, err := strconv.ParseUint(string(data[index+1:index+3]), 16, 8)
		if err != nil {
			return 0, err
		}
		if !*skip && !text.writeString(string(rune(value))) {
			return len(data), nil
		}
		return index + 3, nil
	}

	if !isASCIILetter(control) {
		return index + 1, nil
	}
	start := index
	for index < len(data) && isASCIILetter(data[index]) {
		index++
	}
	word := string(data[start:index])
	numberStart := index
	if index < len(data) && (data[index] == '-' || data[index] == '+') {
		index++
	}
	digitsStart := index
	for index < len(data) && data[index] >= '0' && data[index] <= '9' {
		index++
	}
	numberEnd := index
	hasNumber := digitsStart != index
	if !hasNumber {
		index = numberStart
	}
	if index < len(data) && data[index] == ' ' {
		index++
	}

	if *skip {
		return index, nil
	}
	switch word {
	case "par", "line":
		if !text.writeString("\n") {
			return len(data), nil
		}
	case "tab":
		if !text.writeString("\t") {
			return len(data), nil
		}
	case "u":
		if !hasNumber {
			return 0, errors.New("unicode control word has no value")
		}
		value, err := strconv.Atoi(string(data[numberStart:numberEnd]))
		if err != nil {
			return 0, err
		}
		if value < 0 {
			value += 65536
		}
		if value < 0 || value > utf8.MaxRune {
			return 0, errors.New("unicode value is out of range")
		}
		if !text.writeString(string(rune(value))) {
			return len(data), nil
		}
		if index < len(data) {
			_, width := utf8.DecodeRune(data[index:])
			if width == 0 {
				width = 1
			}
			index += width
		}
	}
	return index, nil
}

func isASCIILetter(value byte) bool {
	return value >= 'a' && value <= 'z' || value >= 'A' && value <= 'Z'
}
