package main

import (
	"context"
	"encoding/json"
	"net"
	"strings"
	"testing"
	"time"

	"reasonix/internal/campus/livebridge"
	"reasonix/internal/campus/livebridge/protocol"
	bridgeserver "reasonix/internal/campus/livebridge/server"
)

type fakeScheduleBridgeServer struct {
	starts         int
	closes         int
	searches       int
	cancellations  []string
	personal       livebridge.PersonalRequest
	personalResult protocol.Result
}

func (f *fakeScheduleBridgeServer) Start(context.Context) error { f.starts++; return nil }
func (f *fakeScheduleBridgeServer) Close() error                { f.closes++; return nil }
func (f *fakeScheduleBridgeServer) Addr() net.Addr              { return fakeBridgeAddr("127.0.0.1:38673") }
func (f *fakeScheduleBridgeServer) IssuePairingCode() (bridgeserver.PairingChallenge, error) {
	return bridgeserver.PairingChallenge{Code: "123456", ExpiresAt: time.Unix(100, 0)}, nil
}
func (f *fakeScheduleBridgeServer) Status(context.Context) (livebridge.Status, error) {
	return livebridge.Status{Connected: true, ExtensionID: "abcdefghijklmnopabcdefghijklmnop", Authenticated: true}, nil
}
func (f *fakeScheduleBridgeServer) Search(context.Context, livebridge.SearchRequest) (protocol.Result, error) {
	f.searches++
	return protocol.Result{Protocol: 1, Type: protocol.TypeResult, Status: protocol.StatusOK}, nil
}
func (f *fakeScheduleBridgeServer) Personal(_ context.Context, request livebridge.PersonalRequest) (protocol.Result, error) {
	f.personal = request
	if f.personalResult.Type != "" {
		return f.personalResult, nil
	}
	return protocol.Result{Protocol: 1, Type: protocol.TypeResult, Status: protocol.StatusOK}, nil
}
func (f *fakeScheduleBridgeServer) Cancel(_ context.Context, id string) error {
	f.cancellations = append(f.cancellations, id)
	return nil
}

type fakeBridgeAddr string

func (a fakeBridgeAddr) Network() string { return "tcp" }
func (a fakeBridgeAddr) String() string  { return string(a) }

func TestScheduleBridgeStartsOnceAndClosesOnce(t *testing.T) {
	server := &fakeScheduleBridgeServer{}
	runtime := newScheduleBridgeRuntime(server)
	if err := runtime.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := runtime.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := runtime.Close(); err != nil {
		t.Fatal(err)
	}
	if err := runtime.Close(); err != nil {
		t.Fatal(err)
	}
	if server.starts != 1 || server.closes != 1 {
		t.Fatalf("starts=%d closes=%d", server.starts, server.closes)
	}
}

func TestScheduleBridgePersonalConsentIsSessionScoped(t *testing.T) {
	server := &fakeScheduleBridgeServer{}
	runtime := newScheduleBridgeRuntime(server)
	request := livebridge.SearchRequest{ID: "req_consent", SessionID: "session-a", Term: "2026-fall", Courses: []string{"ECS 036A"}, IncludePersonalContext: true}

	result, err := runtime.Search(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != protocol.StatusConsentRequired || server.searches != 0 {
		t.Fatalf("result=%+v searches=%d", result, server.searches)
	}
	runtime.SetConsent("session-a", true)
	if _, err := runtime.Search(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	if server.searches != 1 {
		t.Fatalf("searches=%d", server.searches)
	}

	request.SessionID = "session-b"
	result, err = runtime.Search(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != protocol.StatusConsentRequired || server.searches != 1 {
		t.Fatalf("result=%+v searches=%d", result, server.searches)
	}
}

func TestScheduleBridgeOpensOnlyOfficialScheduleBuilder(t *testing.T) {
	server := &fakeScheduleBridgeServer{}
	runtime := newScheduleBridgeRuntime(server)
	var opened string
	runtime.openBrowser = func(_ context.Context, url string) { opened = url }
	runtime.OpenScheduleBuilder(context.Background())
	if opened != scheduleBuilderURL {
		t.Fatalf("opened=%q", opened)
	}
}

func TestSaveScheduleCalendarUsesConsentedCurrentEvidenceAndChosenPath(t *testing.T) {
	evidence, err := json.Marshal(map[string]any{"personal": map[string]any{
		"term": "202610",
		"courses": []any{map[string]any{
			"crn": "12345", "status": "registered", "course": "ECS 036A", "section": "001",
			"meetings": []any{map[string]any{"type": "Lecture", "days": []string{"M"}, "startDate": "2026-09-21", "startTime": "10:00:00", "endDate": "2026-12-11", "endTime": "10:50:00"}},
		}},
		"passTimes": []any{map[string]any{"pass": 1, "sourceText": "Pass 1: May 18, 2026 09:30 AM", "localDateTime": "2026-05-18T09:30:00"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	server := &fakeScheduleBridgeServer{personalResult: protocol.Result{Protocol: 1, Type: protocol.TypeResult, Status: protocol.StatusOK, Evidence: evidence}}
	runtime := newScheduleBridgeRuntime(server)
	runtime.SetConsent("session-a", true)
	var savedPath, savedICS string
	path, err := saveScheduleCalendar(context.Background(), runtime, "session-a", func(name string) (string, error) {
		if name != "ucdavis-schedule-202610.ics" {
			t.Fatalf("filename=%q", name)
		}
		return "/tmp/ucdavis.ics", nil
	}, func(path, content string) error {
		savedPath, savedICS = path, content
		return nil
	}, func() time.Time { return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC) })
	if err != nil {
		t.Fatal(err)
	}
	if path != "/tmp/ucdavis.ics" || savedPath != path || !strings.Contains(savedICS, "SUMMARY:UC Davis Pass 1") {
		t.Fatalf("path=%q savedPath=%q ics=%q", path, savedPath, savedICS)
	}
	if server.personal.Term != "current" || server.personal.SessionID != "session-a" || strings.Join(server.personal.Categories, ",") != "schedule,waitlist,pass_times" {
		t.Fatalf("personal request=%+v", server.personal)
	}
}

func TestSaveScheduleCalendarCancelsWithoutWritingAndForwardsStatus(t *testing.T) {
	server := &fakeScheduleBridgeServer{personalResult: protocol.Result{Protocol: 1, Type: protocol.TypeResult, Status: protocol.StatusBrowserRequired, Message: "private value"}}
	runtime := newScheduleBridgeRuntime(server)
	runtime.SetConsent("session-a", true)
	_, err := saveScheduleCalendar(context.Background(), runtime, "session-a", func(string) (string, error) { return "/tmp/unused.ics", nil }, func(string, string) error {
		t.Fatal("must not write a non-OK bridge result")
		return nil
	}, time.Now)
	if err == nil || !strings.Contains(err.Error(), "BROWSER_REQUIRED") || strings.Contains(err.Error(), "private value") {
		t.Fatalf("err=%v", err)
	}

	server.personalResult = protocol.Result{Protocol: 1, Type: protocol.TypeResult, Status: protocol.StatusOK, Evidence: json.RawMessage(`{"personal":{"term":"202610","courses":[]}}`)}
	path, err := saveScheduleCalendar(context.Background(), runtime, "session-a", func(string) (string, error) { return "", nil }, func(string, string) error {
		t.Fatal("must not write after cancellation")
		return nil
	}, time.Now)
	if err != nil || path != "" {
		t.Fatalf("path=%q err=%v", path, err)
	}
}
