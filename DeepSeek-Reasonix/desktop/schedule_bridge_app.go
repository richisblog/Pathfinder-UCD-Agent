package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"reasonix/internal/campus/livebridge"
	"reasonix/internal/campus/livebridge/protocol"
	bridgeserver "reasonix/internal/campus/livebridge/server"
)

const scheduleBuilderURL = "https://my.ucdavis.edu/schedulebuilder/"

var scheduleCalendarRequestSequence atomic.Uint64

type scheduleBridgeServer interface {
	livebridge.Client
	Start(context.Context) error
	Close() error
	Addr() net.Addr
	IssuePairingCode() (bridgeserver.PairingChallenge, error)
}

type scheduleBridgeRuntime struct {
	mu          sync.Mutex
	server      scheduleBridgeServer
	started     bool
	closed      bool
	consent     map[string]bool
	openBrowser func(context.Context, string)
}

type ScheduleBridgeStatusView struct {
	Running      bool   `json:"running"`
	Connected    bool   `json:"connected"`
	Paired       bool   `json:"paired"`
	ExtensionID  string `json:"extensionId,omitempty"`
	LoopbackAddr string `json:"loopbackAddr,omitempty"`
}

type ScheduleBridgePairingView struct {
	Code      string `json:"code"`
	ExpiresAt int64  `json:"expiresAt"`
}

func newScheduleBridgeRuntime(server scheduleBridgeServer) *scheduleBridgeRuntime {
	return &scheduleBridgeRuntime{
		server:  server,
		consent: make(map[string]bool),
		openBrowser: func(ctx context.Context, url string) {
			runtime.BrowserOpenURL(ctx, url)
		},
	}
}

func (r *scheduleBridgeRuntime) Start(ctx context.Context) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.started {
		return nil
	}
	if err := r.server.Start(ctx); err != nil {
		return err
	}
	r.started = true
	return nil
}

func (r *scheduleBridgeRuntime) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || !r.started {
		return nil
	}
	r.closed = true
	r.consent = make(map[string]bool)
	return r.server.Close()
}

func (r *scheduleBridgeRuntime) Status(ctx context.Context) (livebridge.Status, error) {
	return r.server.Status(ctx)
}

func (r *scheduleBridgeRuntime) Search(ctx context.Context, request livebridge.SearchRequest) (protocol.Result, error) {
	if request.IncludePersonalContext && !r.HasConsent(request.SessionID) {
		return consentRequiredResult(request.ID), nil
	}
	return r.server.Search(ctx, request)
}

func (r *scheduleBridgeRuntime) Personal(ctx context.Context, request livebridge.PersonalRequest) (protocol.Result, error) {
	if !r.HasConsent(request.SessionID) {
		return consentRequiredResult(request.ID), nil
	}
	return r.server.Personal(ctx, request)
}

func (r *scheduleBridgeRuntime) Cancel(ctx context.Context, requestID string) error {
	return r.server.Cancel(ctx, requestID)
}

func consentRequiredResult(requestID string) protocol.Result {
	return protocol.Result{
		Protocol: protocol.Version,
		ID:       requestID,
		Type:     protocol.TypeResult,
		Status:   protocol.StatusConsentRequired,
		Message:  "Personal schedule context requires permission for this Pathfinder session.",
	}
}

func (r *scheduleBridgeRuntime) SetConsent(sessionID string, allowed bool) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if allowed {
		r.consent[sessionID] = true
	} else {
		delete(r.consent, sessionID)
	}
}

func (r *scheduleBridgeRuntime) HasConsent(sessionID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return sessionID != "" && r.consent[sessionID]
}

func (r *scheduleBridgeRuntime) OpenScheduleBuilder(ctx context.Context) {
	r.openBrowser(ctx, scheduleBuilderURL)
}

func (a *App) scheduleBridgeRuntime() *scheduleBridgeRuntime {
	campus := a.campusRuntime()
	campus.mu.Lock()
	defer campus.mu.Unlock()
	if campus.scheduleBridge == nil {
		campus.scheduleBridge = newScheduleBridgeRuntime(bridgeserver.New(bridgeserver.Options{
			AllowDynamicExtensionIDs: true,
			PairingTTL:               5 * time.Minute,
		}))
	}
	return campus.scheduleBridge
}

func (a *App) startScheduleBridge() error {
	return a.scheduleBridgeRuntime().Start(a.bootContext())
}

func (a *App) closeScheduleBridge() error {
	campus := a.campusRuntime()
	campus.mu.Lock()
	bridge := campus.scheduleBridge
	campus.mu.Unlock()
	if bridge == nil {
		return nil
	}
	return bridge.Close()
}

func (a *App) scheduleBridgeClient() livebridge.Client {
	return a.scheduleBridgeRuntime()
}

func (a *App) ScheduleBridgeStatus() (ScheduleBridgeStatusView, error) {
	bridge := a.scheduleBridgeRuntime()
	status, err := bridge.Status(a.bootContext())
	if err != nil {
		return ScheduleBridgeStatusView{}, err
	}
	bridge.mu.Lock()
	running := bridge.started && !bridge.closed
	bridge.mu.Unlock()
	addr := ""
	if value := bridge.server.Addr(); value != nil {
		addr = value.String()
	}
	return ScheduleBridgeStatusView{
		Running:      running,
		Connected:    status.Connected,
		Paired:       status.Authenticated,
		ExtensionID:  status.ExtensionID,
		LoopbackAddr: addr,
	}, nil
}

func (a *App) ScheduleBridgeIssuePairingCode() (ScheduleBridgePairingView, error) {
	challenge, err := a.scheduleBridgeRuntime().server.IssuePairingCode()
	if err != nil {
		return ScheduleBridgePairingView{}, err
	}
	return ScheduleBridgePairingView{Code: challenge.Code, ExpiresAt: challenge.ExpiresAt.UnixMilli()}, nil
}

func (a *App) ScheduleBridgeOpenBrowser() {
	a.scheduleBridgeRuntime().OpenScheduleBuilder(a.bootContext())
}

func (a *App) ScheduleBridgeSetPersonalConsent(sessionID string, allowed bool) {
	a.scheduleBridgeRuntime().SetConsent(sessionID, allowed)
}

func (a *App) ScheduleBridgePersonalConsent(sessionID string) bool {
	return a.scheduleBridgeRuntime().HasConsent(sessionID)
}

// SaveScheduleCalendar asks the paired, consented extension for the Schedule
// Builder term currently open in the browser, then writes the generated ICS
// only after the student selects a destination in the native save dialog.
func (a *App) SaveScheduleCalendar(sessionID string) (string, error) {
	return saveScheduleCalendar(
		a.bootContext(),
		a.scheduleBridgeRuntime(),
		sessionID,
		func(name string) (string, error) { return a.PickExportFile(name, "text/calendar") },
		func(path, content string) error { return a.SaveExportFile(path, content, false) },
		time.Now,
	)
}

func saveScheduleCalendar(
	ctx context.Context,
	client livebridge.Client,
	sessionID string,
	pick func(string) (string, error),
	write func(string, string) error,
	now func() time.Time,
) (string, error) {
	if client == nil {
		return "", fmt.Errorf("schedule calendar unavailable: bridge is not running")
	}
	if strings.TrimSpace(sessionID) == "" {
		return "", fmt.Errorf("schedule calendar unavailable: a conversation is required")
	}
	result, err := client.Personal(ctx, livebridge.PersonalRequest{
		ID:         fmt.Sprintf("calendar_%x", scheduleCalendarRequestSequence.Add(1)),
		SessionID:  sessionID,
		Term:       "current",
		Categories: []string{"schedule", "waitlist", "pass_times"},
	})
	if err != nil {
		return "", err
	}
	if result.Status != protocol.StatusOK {
		return "", fmt.Errorf("schedule calendar unavailable: %s", result.Status)
	}
	var payload struct {
		Personal scheduleCalendarEvidence `json:"personal"`
	}
	if err := json.Unmarshal(result.Evidence, &payload); err != nil {
		return "", fmt.Errorf("decode schedule calendar evidence: %w", err)
	}
	if !isScheduleCalendarTerm(payload.Personal.Term) {
		return "", fmt.Errorf("decode schedule calendar evidence: current term is unavailable")
	}
	ics, err := generateScheduleCalendar(payload.Personal, now())
	if err != nil {
		return "", err
	}
	path, err := pick("ucdavis-schedule-" + payload.Personal.Term + ".ics")
	if err != nil || strings.TrimSpace(path) == "" {
		return "", err
	}
	if err := write(path, ics); err != nil {
		return "", err
	}
	return path, nil
}

func isScheduleCalendarTerm(value string) bool {
	if len(value) != 6 {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func (a *App) ScheduleBridgeCancel(requestID string) error {
	return a.scheduleBridgeRuntime().Cancel(a.bootContext(), strings.TrimSpace(requestID))
}
