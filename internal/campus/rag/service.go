package rag

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"reasonix/internal/campus/openai"
)

const defaultMaxRounds = 8

type Event struct {
	Type    string `json:"type"`
	Name    string `json:"name,omitempty"`
	Label   string `json:"label,omitempty"`
	Content string `json:"content,omitempty"`
	Summary string `json:"summary,omitempty"`
	Message string `json:"message,omitempty"`
	Args    any    `json:"args,omitempty"`
}

type Emitter func(Event)

type Model interface {
	Chat(context.Context, openai.ChatRequest) (openai.ChatResponse, error)
}

type ToolRunner interface {
	RunTool(name string, args map[string]any) (map[string]any, error)
	Schemas() []openai.Tool
}

type Service struct {
	model     Model
	tools     ToolRunner
	maxRounds int
}

func NewService(model Model, tools ToolRunner) *Service {
	return &Service{model: model, tools: tools, maxRounds: defaultMaxRounds}
}

func (s *Service) Answer(ctx context.Context, message string, history []openai.Message, emit Emitter) (string, error) {
	if emit == nil {
		emit = func(Event) {}
	}
	messages := buildMessages(message, history)
	tools := s.tools.Schemas()

	for round := 0; round < s.maxRounds; round++ {
		resp, err := s.model.Chat(ctx, openai.ChatRequest{
			Messages:    messages,
			Tools:       tools,
			Temperature: floatPtr(0.2),
		})
		if err != nil {
			emit(Event{Type: "error", Message: err.Error()})
			return "", err
		}
		if len(resp.Choices) == 0 {
			err := fmt.Errorf("model returned no choices")
			emit(Event{Type: "error", Message: err.Error()})
			return "", err
		}
		assistant := resp.Choices[0].Message
		if len(assistant.ToolCalls) == 0 {
			answer := assistant.Content
			if answer != "" {
				emit(Event{Type: "delta", Content: answer})
			}
			emit(Event{Type: "done"})
			return answer, nil
		}
		messages = append(messages, assistant)
		for _, call := range assistant.ToolCalls {
			args, err := parseArgs(call.Function.Arguments)
			if err != nil {
				args = map[string]any{}
			}
			emit(Event{
				Type:  "tool_start",
				Name:  call.Function.Name,
				Label: toolLabel(call.Function.Name),
				Args:  args,
			})
			result, err := s.tools.RunTool(call.Function.Name, args)
			if err != nil {
				result = map[string]any{"error": err.Error()}
			}
			summary := toolSummary(call.Function.Name, result)
			emit(Event{
				Type:    "tool_result",
				Name:    call.Function.Name,
				Label:   toolLabel(call.Function.Name),
				Summary: summary,
			})
			content, err := json.Marshal(result)
			if err != nil {
				content = []byte(`{"error":"failed to marshal tool result"}`)
			}
			messages = append(messages, openai.Message{
				Role:       "tool",
				ToolCallID: call.ID,
				Content:    string(content),
			})
		}
	}

	err := fmt.Errorf("tool loop reached limit")
	emit(Event{Type: "error", Message: err.Error()})
	return "", err
}

func buildMessages(message string, history []openai.Message) []openai.Message {
	now := time.Now().In(pacificLocation()).Format("2006-01-02 15:04:05 MST")
	out := []openai.Message{
		{Role: "system", Content: SystemPrompt},
		{Role: "system", Content: "Current time: " + now + "; timezone: America/Los_Angeles."},
	}
	if len(history) > 8 {
		history = history[len(history)-8:]
	}
	for _, item := range history {
		if (item.Role == "user" || item.Role == "assistant") && item.Content != "" {
			out = append(out, openai.Message{Role: item.Role, Content: item.Content})
		}
	}
	out = append(out, openai.Message{Role: "user", Content: message})
	return out
}

func parseArgs(raw string) (map[string]any, error) {
	if raw == "" {
		return map[string]any{}, nil
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, err
	}
	return out, nil
}

func toolLabel(name string) string {
	labels := map[string]string{
		"search_professors":          "Search professors",
		"professors_for_course":      "Find professors for course",
		"professor_reviews":          "Read professor reviews",
		"search_reviews_by_keywords": "Search review comments",
		"query_rmp_table":            "Query RMP database",
		"query_course_db":            "Query course catalog",
		"query_change_major":         "Query change-of-major requirements",
		"query_major_catalog":        "Query major catalog",
		"query_ucdavis_calendar":     "Query UC Davis calendar",
		"search_txt_context":         "Search local policy files",
	}
	if label := labels[name]; label != "" {
		return label
	}
	return name
}

func toolSummary(name string, result map[string]any) string {
	if errText, ok := result["error"].(string); ok && errText != "" {
		return errText
	}
	if table, ok := result["table"].(string); ok && table != "" {
		return table
	}
	if query, ok := result["query"].(string); ok && query != "" {
		return query
	}
	return toolLabel(name)
}

func floatPtr(v float64) *float64 {
	return &v
}

func pacificLocation() *time.Location {
	loc, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		return time.FixedZone("PST", -8*60*60)
	}
	return loc
}
