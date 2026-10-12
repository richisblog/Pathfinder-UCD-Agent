package native

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"reasonix/internal/agent"
	"reasonix/internal/campus/livebridge"
	"reasonix/internal/campus/livebridge/protocol"
	"reasonix/internal/campus/tools"
)

type fakeLiveScheduleClient struct {
	request         livebridge.SearchRequest
	personalRequest livebridge.PersonalRequest
	result          protocol.Result
	err             error
}

func (f *fakeLiveScheduleClient) Status(context.Context) (livebridge.Status, error) {
	return livebridge.Status{Connected: true, Authenticated: true}, nil
}

func (f *fakeLiveScheduleClient) Search(_ context.Context, request livebridge.SearchRequest) (protocol.Result, error) {
	f.request = request
	return f.result, f.err
}

func (f *fakeLiveScheduleClient) Personal(_ context.Context, request livebridge.PersonalRequest) (protocol.Result, error) {
	f.personalRequest = request
	return f.result, f.err
}

func (f *fakeLiveScheduleClient) Cancel(context.Context, string) error { return nil }

func TestLiveScheduleToolIsReadOnlyAndReturnsRecoverableLoginState(t *testing.T) {
	client := &fakeLiveScheduleClient{result: protocol.Result{Protocol: 1, Type: "result", Status: protocol.StatusLoginRequired}}
	tool := newLiveScheduleTool(client)
	if !tool.ReadOnly() || !tool.PlanModeSafe() {
		t.Fatal("live schedule tool must be read-only and plan-safe")
	}
	got, err := tool.Execute(context.Background(), json.RawMessage(`{"term":"2026-fall","courses":[" ecs 036a "],"include_personal_context":true}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "LOGIN_REQUIRED") || !strings.Contains(got, "open_schedule_builder") {
		t.Fatalf("got=%q", got)
	}
	if client.request.Term != "202610" || len(client.request.Courses) != 1 || client.request.Courses[0] != "ECS 036A" || !client.request.IncludePersonalContext {
		t.Fatalf("request=%+v", client.request)
	}
}

func TestLiveScheduleToolRejectsAmbiguousSummerBeforeBridgeCall(t *testing.T) {
	client := &fakeLiveScheduleClient{}
	tool := newLiveScheduleTool(client)
	_, err := tool.Execute(context.Background(), json.RawMessage(`{"term":"Summer 2026","courses":["ECS 150"]}`))
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "ambiguous") {
		t.Fatalf("err=%v", err)
	}
	if client.request.ID != "" {
		t.Fatalf("bridge called with %+v", client.request)
	}
}

func TestLiveScheduleToolQueriesRegisteredWaitlistedAndPassTimesWithoutCourseNames(t *testing.T) {
	client := &fakeLiveScheduleClient{result: protocol.Result{
		Protocol: 1,
		Type:     protocol.TypeResult,
		Status:   protocol.StatusOK,
		Evidence: json.RawMessage(`{"personal":{"courses":[{"crn":"12345","status":"registered"},{"crn":"23456","status":"waitlisted"}]}}`),
	}}
	tool := newLiveScheduleTool(client)

	got, err := tool.Execute(agent.WithParentSession(context.Background(), "session-a"), json.RawMessage(`{
		"term":"Fall Quarter 2026",
		"include_personal_context":true
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, `"registered"`) || !strings.Contains(got, `"waitlisted"`) {
		t.Fatalf("got=%q", got)
	}
	if client.personalRequest.Term != "202610" ||
		client.personalRequest.SessionID != "session-a" ||
		strings.Join(client.personalRequest.Categories, ",") != "schedule,waitlist,pass_times" {
		t.Fatalf("personal request=%+v", client.personalRequest)
	}
	if client.request.ID != "" {
		t.Fatalf("public search unexpectedly called with %+v", client.request)
	}
}

func TestLiveScheduleToolRejectsUnknownFieldsBeforeBridgeCall(t *testing.T) {
	client := &fakeLiveScheduleClient{}
	tool := newLiveScheduleTool(client)
	_, err := tool.Execute(context.Background(), json.RawMessage(`{"term":"2026-fall","courses":["ECS 036A"],"url":"https://example.com"}`))
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "unknown field") {
		t.Fatalf("err=%v", err)
	}
	if client.request.ID != "" {
		t.Fatalf("bridge called with %+v", client.request)
	}
}

func TestToolsRegisterLiveScheduleWithoutLocalCampusData(t *testing.T) {
	client := &fakeLiveScheduleClient{}
	registered := Tools(tools.Paths{}, WithLiveSchedule(client))
	found := false
	for _, candidate := range registered {
		if candidate.Name() == "query_live_schedule" {
			found = true
			if schema := string(candidate.Schema()); !strings.Contains(schema, "include_personal_context") || !strings.Contains(schema, "courses") {
				t.Fatalf("schema=%s", schema)
			}
		}
	}
	if !found {
		t.Fatal("query_live_schedule not registered")
	}
	if got := strings.Join(DataToolNames(tools.Paths{}, WithLiveSchedule(client)), ","); !strings.Contains(got, "query_live_schedule") {
		t.Fatalf("data tools=%s", got)
	}
}
