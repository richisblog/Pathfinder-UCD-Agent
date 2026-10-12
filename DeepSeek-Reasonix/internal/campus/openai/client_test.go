package openai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientSendsChatCompletionRequest(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer sk-test" {
			t.Fatalf("authorization = %q", got)
		}
		var req ChatRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if req.Model != "test-model" || len(req.Messages) != 1 {
			t.Fatalf("request = %+v", req)
		}
		_ = json.NewEncoder(w).Encode(ChatResponse{
			Choices: []Choice{{Message: Message{Role: "assistant", Content: "hello"}}},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL+"/v1", "sk-test", "test-model")
	resp, err := client.Chat(t.Context(), ChatRequest{Messages: []Message{{Role: "user", Content: "hi"}}})
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	if resp.Choices[0].Message.Content != "hello" {
		t.Fatalf("response = %+v", resp)
	}
}

func TestClientReturnsProviderErrors(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{"message": "bad key"},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL+"/v1", "sk-bad", "test-model")
	_, err := client.Chat(t.Context(), ChatRequest{Messages: []Message{{Role: "user", Content: "hi"}}})
	if err == nil {
		t.Fatalf("expected provider error")
	}
}
