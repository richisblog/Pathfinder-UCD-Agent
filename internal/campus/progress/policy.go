package progress

import (
	"strings"
	"unicode"

	"reasonix/internal/evidence"
)

var managedMarkers = []string{
	"比较", "对比", "规划", "计划", "路线", "转专业", "双专业", "辅修",
	"资格", "要求并", "学期", "quarter", "四年", "三年", "毕业", "选课方案",
	"compare", "plan", "roadmap", "eligibility", "change major", "requirements and",
}

// ManagedConsultation reports whether a turn benefits from explicit progress
// tracking. Existing todos keep follow-up turns managed even when the user only
// says "continue" or supplies one missing value.
func ManagedConsultation(input string, todos []evidence.TodoItem) bool {
	if len(todos) > 0 {
		return true
	}
	normalized := strings.ToLower(strings.Join(strings.Fields(input), " "))
	for _, marker := range managedMarkers {
		if strings.Contains(normalized, marker) {
			return true
		}
	}
	return clauseCount(input) >= 3
}

func clauseCount(input string) int {
	count := 1
	for _, r := range input {
		if strings.ContainsRune(",，;；?？", r) || unicode.Is(unicode.Zl, r) {
			count++
		}
	}
	return count
}
