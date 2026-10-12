package progress

import (
	"encoding/json"
	"strings"

	"reasonix/internal/evidence"
	"reasonix/internal/provider"
)

const (
	maxObservations      = 6
	maxObservationRunes  = 320
	maxGoalRunes         = 320
	maxToolArgumentRunes = 240
)

type Observation struct {
	Tool   string
	Args   string
	Status string
	Result string
}

type Snapshot struct {
	Goal         string
	Todos        []evidence.TodoItem
	Observations []Observation
	NextAction   string
}

type pendingCall struct {
	name string
	args string
}

func buildSnapshot(input string, history []provider.Message, todos []evidence.TodoItem) Snapshot {
	snapshot := Snapshot{
		Goal:  limitRunes(compactWhitespace(input), maxGoalRunes),
		Todos: append([]evidence.TodoItem(nil), todos...),
	}
	calls := make(map[string]pendingCall)
	for _, message := range history {
		for _, call := range message.ToolCalls {
			if isCampusDataTool(call.Name) {
				calls[call.ID] = pendingCall{name: call.Name, args: compactJSON(call.Arguments)}
			}
		}
		if message.Role != provider.RoleTool {
			continue
		}
		call, ok := calls[message.ToolCallID]
		if !ok || !isCampusDataTool(call.name) {
			continue
		}
		status := "success"
		if failedResult(message.Content) {
			status = "failed"
		}
		snapshot.Observations = append(snapshot.Observations, Observation{
			Tool:   call.name,
			Args:   limitRunes(call.args, maxToolArgumentRunes),
			Status: status,
			Result: limitRunes(compactWhitespace(message.Content), maxObservationRunes),
		})
	}
	if len(snapshot.Observations) > maxObservations {
		snapshot.Observations = snapshot.Observations[len(snapshot.Observations)-maxObservations:]
	}
	for _, todo := range snapshot.Todos {
		if todo.Status == "in_progress" {
			snapshot.NextAction = todo.Content
			break
		}
	}
	if snapshot.NextAction == "" {
		for _, todo := range snapshot.Todos {
			if todo.Status != "completed" {
				snapshot.NextAction = todo.Content
				break
			}
		}
	}
	if snapshot.NextAction == "" {
		snapshot.NextAction = "evaluate the next unresolved condition"
	}
	return snapshot
}

func compactJSON(raw string) string {
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return compactWhitespace(raw)
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return compactWhitespace(raw)
	}
	return string(encoded)
}

func compactWhitespace(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func failedResult(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	return strings.HasPrefix(lower, "error") ||
		strings.HasPrefix(lower, "failed") ||
		strings.HasPrefix(lower, "blocked") ||
		strings.HasPrefix(lower, "cancelled") ||
		strings.Contains(lower, `"error"`)
}

func isCampusDataTool(name string) bool {
	switch name {
	case "search_professors",
		"professors_for_course",
		"professor_reviews",
		"search_reviews_by_keywords",
		"query_rmp_table",
		"query_course_db",
		"query_ucdavis_calendar",
		"search_txt_context",
		"query_major_catalog",
		"query_change_major",
		"compare_change_major_requirements":
		return true
	default:
		return false
	}
}

func limitRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	if limit <= 1 {
		return string(runes[:limit])
	}
	return string(runes[:limit-1]) + "…"
}
