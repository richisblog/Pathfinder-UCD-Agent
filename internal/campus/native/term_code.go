package native

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	ucdTermCodePattern = regexp.MustCompile(`^\d{6}$`)
	ucdTermYearPattern = regexp.MustCompile(`\d{4}`)
	ucdTermSeparators  = strings.NewReplacer("-", " ", "_", " ", "/", " ", ",", " ")
	ucdTermSuffixes    = map[string]string{
		"winter quarter":         "01",
		"spring semester":        "02",
		"spring quarter":         "03",
		"summer session 1":       "05",
		"summer special session": "06",
		"summer session 2":       "07",
		"summer quarter":         "08",
		"fall semester":          "09",
		"fall quarter":           "10",
	}
	ucdSupportedTermSuffixes = func() map[string]struct{} {
		out := make(map[string]struct{}, len(ucdTermSuffixes))
		for _, suffix := range ucdTermSuffixes {
			out[suffix] = struct{}{}
		}
		return out
	}()
)

func normalizeUCDTerm(input string) (string, error) {
	raw := strings.TrimSpace(input)
	if raw == "" {
		return "", fmt.Errorf("term is required")
	}
	if ucdTermCodePattern.MatchString(raw) {
		if _, ok := ucdSupportedTermSuffixes[raw[4:]]; !ok {
			return "", fmt.Errorf("unsupported UC Davis term-code suffix %q", raw[4:])
		}
		return raw, nil
	}

	years := ucdTermYearPattern.FindAllString(raw, -1)
	if len(years) != 1 {
		return "", fmt.Errorf("term must contain exactly one four-digit year")
	}
	year := years[0]
	termText := strings.ToLower(raw)
	termText = strings.ReplaceAll(termText, year, " ")
	termText = ucdTermSeparators.Replace(termText)
	termText = strings.Join(strings.Fields(termText), " ")

	canonical, err := canonicalUCDTermType(termText)
	if err != nil {
		return "", err
	}
	return year + ucdTermSuffixes[canonical], nil
}

func canonicalUCDTermType(term string) (string, error) {
	if strings.Contains(term, "夏季") {
		switch {
		case strings.Contains(term, "第一期") || strings.Contains(term, "第一") || strings.Contains(term, "session 1"):
			return "summer session 1", nil
		case strings.Contains(term, "特殊") || strings.Contains(term, "special"):
			return "summer special session", nil
		case strings.Contains(term, "第二期") || strings.Contains(term, "第二") || strings.Contains(term, "session 2"):
			return "summer session 2", nil
		case strings.Contains(term, "quarter") || strings.Contains(term, "qtr"):
			return "summer quarter", nil
		default:
			return "", fmt.Errorf("ambiguous Summer term: specify Session 1, Special Session, Session 2, or Summer Quarter")
		}
	}
	if strings.Contains(term, "秋季") {
		if strings.Contains(term, "semester") || strings.Contains(term, " sem") {
			return "fall semester", nil
		}
		return "fall quarter", nil
	}
	if strings.Contains(term, "春季") {
		if strings.Contains(term, "semester") || strings.Contains(term, " sem") {
			return "spring semester", nil
		}
		return "spring quarter", nil
	}
	if strings.Contains(term, "冬季") {
		return "winter quarter", nil
	}

	aliases := map[string]string{
		"winter": "winter quarter", "winter qtr": "winter quarter", "winter quarter": "winter quarter",
		"spring": "spring quarter", "spring qtr": "spring quarter", "spring quarter": "spring quarter",
		"spring sem": "spring semester", "spring semester": "spring semester",
		"summer session 1": "summer session 1", "sum ses 1": "summer session 1",
		"summer special session": "summer special session", "sm sp ses": "summer special session",
		"summer session 2": "summer session 2", "sum ses 2": "summer session 2",
		"summer quarter": "summer quarter", "sum qtr": "summer quarter",
		"fall": "fall quarter", "fall qtr": "fall quarter", "fall quarter": "fall quarter",
		"fall sem": "fall semester", "fall semester": "fall semester",
	}
	if canonical, ok := aliases[term]; ok {
		return canonical, nil
	}
	if term == "summer" || term == "sum" {
		return "", fmt.Errorf("ambiguous Summer term: specify Session 1, Special Session, Session 2, or Summer Quarter")
	}
	return "", fmt.Errorf("unsupported UC Davis term %q", term)
}
