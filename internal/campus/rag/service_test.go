package rag

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"reasonix/internal/campus/openai"
)

func TestServiceRunsToolLoopAndEmitsEvents(t *testing.T) {
	t.Parallel()
	model := &fakeModel{
		responses: []openai.ChatResponse{
			{
				Choices: []openai.Choice{{
					Message: openai.Message{
						Role: "assistant",
						ToolCalls: []openai.ToolCall{{
							ID:   "call_1",
							Type: "function",
							Function: openai.FunctionCall{
								Name:      "query_course_db",
								Arguments: `{"course":"ECS 036A"}`,
							},
						}},
					},
				}},
			},
			{
				Choices: []openai.Choice{{
					Message: openai.Message{Role: "assistant", Content: "ECS 036A is a programming course."},
				}},
			},
		},
	}
	tools := &fakeTools{}
	service := NewService(model, tools)

	var gotEvents []string
	answer, err := service.Answer(context.Background(), "Tell me about ECS 36A", nil, func(event Event) {
		gotEvents = append(gotEvents, event.Type)
	})
	if err != nil {
		t.Fatalf("answer: %v", err)
	}
	if answer != "ECS 036A is a programming course." {
		t.Fatalf("answer = %q", answer)
	}
	wantEvents := []string{"tool_start", "tool_result", "delta", "done"}
	if !reflect.DeepEqual(gotEvents, wantEvents) {
		t.Fatalf("events = %+v", gotEvents)
	}
	if len(tools.calls) != 1 || tools.calls[0]["course"] != "ECS 036A" {
		t.Fatalf("tool calls = %+v", tools.calls)
	}
}

type fakeModel struct {
	responses []openai.ChatResponse
	requests  []openai.ChatRequest
}

func (f *fakeModel) Chat(_ context.Context, req openai.ChatRequest) (openai.ChatResponse, error) {
	f.requests = append(f.requests, req)
	out := f.responses[0]
	f.responses = f.responses[1:]
	return out, nil
}

type fakeTools struct {
	calls []map[string]any
}

func (f *fakeTools) Schemas() []openai.Tool {
	return []openai.Tool{{
		Type: "function",
		Function: openai.ToolFunction{
			Name:        "query_course_db",
			Description: "Query course DB",
			Parameters:  map[string]any{"type": "object"},
		},
	}}
}

func (f *fakeTools) RunTool(name string, args map[string]any) (map[string]any, error) {
	if name != "query_course_db" {
		return nil, nil
	}
	copied := make(map[string]any, len(args))
	for k, v := range args {
		copied[k] = v
	}
	f.calls = append(f.calls, copied)
	result := map[string]any{
		"table": "courses",
		"rows":  []map[string]any{{"course_code": "ECS 036A", "title": "Programming"}},
	}
	b, _ := json.Marshal(result)
	return map[string]any{"json": string(b), "table": "courses"}, nil
}
