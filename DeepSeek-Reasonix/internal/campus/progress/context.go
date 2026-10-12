package progress

import (
	"fmt"
	"strings"

	"reasonix/internal/evidence"
	"reasonix/internal/provider"
)

const maxContextRunes = 2400

// BuildContext returns transient provider context for managed academic work.
// It is deterministic and contains observations rather than hidden reasoning.
func BuildContext(input string, history []provider.Message, todos []evidence.TodoItem) string {
	if !ManagedConsultation(input, todos) {
		return ""
	}
	snapshot := buildSnapshot(input, history, todos)
	var body strings.Builder
	fmt.Fprintf(&body, "goal: %s\n", snapshot.Goal)
	body.WriteString("todos:\n")
	if len(snapshot.Todos) == 0 {
		body.WriteString("- none yet; create a concise academic todo list before multi-step tool use\n")
	} else {
		for _, todo := range snapshot.Todos {
			fmt.Fprintf(&body, "- [%s] %s\n", compactWhitespace(todo.Status), limitRunes(compactWhitespace(todo.Content), 180))
		}
	}
	body.WriteString("completed_queries:\n")
	if len(snapshot.Observations) == 0 {
		body.WriteString("- none\n")
	} else {
		for _, observation := range snapshot.Observations {
			fmt.Fprintf(&body, "- tool=%s status=%s args=%s result=%s\n",
				observation.Tool, observation.Status, observation.Args, observation.Result)
		}
	}
	fmt.Fprintf(&body, "next_action: %s\n", limitRunes(compactWhitespace(snapshot.NextAction), 180))
	body.WriteString("completion_criteria: resolve every in-progress step; ground campus facts in successful tool evidence; name any student-owned unknown before stopping")

	const open = "<consultation-progress>\n"
	const close = "\n</consultation-progress>"
	available := maxContextRunes - len([]rune(open)) - len([]rune(close))
	return open + limitRunes(body.String(), available) + close
}
