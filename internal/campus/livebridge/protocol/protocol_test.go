package protocol

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestValidateRequestRejectsArbitraryMethod(t *testing.T) {
	req := Request{Protocol: Version, ID: "req_01JABCDEF", Type: TypeRequest, Method: "fetch", Params: json.RawMessage(`{}`)}
	if err := ValidateRequest(req); err == nil || !strings.Contains(err.Error(), "unknown method") {
		t.Fatalf("ValidateRequest error = %v, want unknown method", err)
	}
}

func TestDecodeRequestAcceptsScheduleSearch(t *testing.T) {
	raw := []byte(`{"protocol":1,"id":"req_01JABCDEF","type":"request","method":"schedule.search","params":{"term":"2026-fall","courses":["ECS 036A"]}}`)
	req, err := DecodeRequest(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	params, err := DecodeSearchParams(req)
	if err != nil {
		t.Fatal(err)
	}
	if params.Term != "2026-fall" || len(params.Courses) != 1 || params.Courses[0] != "ECS 036A" {
		t.Fatalf("params = %+v", params)
	}
}

func TestDecodeRequestRejectsMessageOverOneMiB(t *testing.T) {
	_, err := DecodeRequest(strings.NewReader(strings.Repeat("x", MaxMessageBytes+1)))
	if err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("DecodeRequest error = %v, want too large", err)
	}
}

func TestDecodeSearchParamsRejectsUnknownPrivilegedField(t *testing.T) {
	req := Request{
		Protocol: Version,
		ID:       "req_01JABCDEF",
		Type:     TypeRequest,
		Method:   MethodScheduleSearch,
		Params:   json.RawMessage(`{"term":"2026-fall","courses":["ECS 036A"],"url":"https://example.com"}`),
	}
	_, err := DecodeSearchParams(req)
	if err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("DecodeSearchParams error = %v, want unknown field", err)
	}
}
