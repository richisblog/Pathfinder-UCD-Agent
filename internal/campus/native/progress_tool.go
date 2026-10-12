package native

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"reasonix/internal/evidence"
	"reasonix/internal/tool"
)

const maxConsultationTodos = 8
const maxConsultationKnowledgeItems = 10

type campusTodoWrite struct{}

func (campusTodoWrite) Name() string { return "todo_write" }

func (campusTodoWrite) Description() string {
	return "Create or replace the full visible consultation state for a managed academic consultation. Send todos, known, and unknown together in every material update. Use 2-6 concise outcome steps, keep at most one item in_progress, and refresh the full state after meaningful tool results. Do not use for simple one-query answers."
}

func (campusTodoWrite) Schema() json.RawMessage {
	return json.RawMessage(`{
  "type":"object",
  "properties":{
    "todos":{
      "type":"array",
      "maxItems":8,
      "items":{
        "type":"object",
        "properties":{
          "content":{"type":"string"},
          "status":{"type":"string","enum":["pending","in_progress","completed"]},
          "activeForm":{"type":"string"}
        },
        "required":["content","status"]
      }
    },
    "known":{"type":"array","maxItems":10,"items":{"type":"string","minLength":1}},
    "unknown":{"type":"array","maxItems":10,"items":{"type":"string","minLength":1}}
  },
  "required":["todos","known","unknown"]
}`)
}

func (campusTodoWrite) ReadOnly() bool     { return true }
func (campusTodoWrite) PlanModeSafe() bool { return true }
func (campusTodoWrite) SnipHint() tool.SnipHint {
	return tool.SnipHint{Head: 20, Tail: 2, HeadChars: 4000, TailChars: 500}
}

func (campusTodoWrite) Execute(_ context.Context, args json.RawMessage) (string, error) {
	if err := validateConsultationArrayFields(args); err != nil {
		return "", err
	}
	var input evidence.ConsultationSnapshot
	if err := json.Unmarshal(args, &input); err != nil {
		return "", fmt.Errorf("invalid args: %w", err)
	}
	if len(input.Todos) > maxConsultationTodos {
		return "", fmt.Errorf("consultation progress supports at most %d items", maxConsultationTodos)
	}
	active := 0
	for i, item := range input.Todos {
		if strings.TrimSpace(item.Content) == "" {
			return "", fmt.Errorf("todo %d content is required", i+1)
		}
		switch strings.TrimSpace(item.Status) {
		case "pending", "completed":
		case "in_progress":
			active++
		default:
			return "", fmt.Errorf("todo %d status must be pending, in_progress, or completed", i+1)
		}
	}
	if active > 1 {
		return "", fmt.Errorf("consultation progress allows at most one in_progress item")
	}
	if err := validateConsultationKnowledge("known", input.Known); err != nil {
		return "", err
	}
	if err := validateConsultationKnowledge("unknown", input.Unknown); err != nil {
		return "", err
	}
	return "consultation progress updated", nil
}

func validateConsultationArrayFields(args json.RawMessage) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(args, &fields); err != nil {
		return fmt.Errorf("invalid args: %w", err)
	}
	rawTodos, ok := fields["todos"]
	if !ok || bytes.Equal(bytes.TrimSpace(rawTodos), []byte("null")) {
		return fmt.Errorf("todos is required and must be an array")
	}
	var todos []json.RawMessage
	if err := json.Unmarshal(rawTodos, &todos); err != nil {
		return fmt.Errorf("todos must be an array: %w", err)
	}
	for _, name := range []string{"known", "unknown"} {
		raw, present := fields[name]
		if !present {
			continue
		}
		if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return fmt.Errorf("%s must be an array", name)
		}
		var values []json.RawMessage
		if err := json.Unmarshal(raw, &values); err != nil {
			return fmt.Errorf("%s must be an array: %w", name, err)
		}
	}
	return nil
}

func validateConsultationKnowledge(name string, values []string) error {
	if len(values) > maxConsultationKnowledgeItems {
		return fmt.Errorf("consultation %s supports at most %d items", name, maxConsultationKnowledgeItems)
	}
	for i, value := range values {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%s %d is required", name, i+1)
		}
	}
	return nil
}
