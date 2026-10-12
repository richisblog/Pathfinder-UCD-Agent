package native

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"time"

	"reasonix/internal/agent"
	"reasonix/internal/campus/livebridge"
	"reasonix/internal/campus/livebridge/protocol"
	"reasonix/internal/tool"
)

var liveRequestSequence atomic.Uint64

type liveScheduleTool struct {
	client livebridge.Client
}

type liveScheduleArgs struct {
	Term                   string   `json:"term"`
	Courses                []string `json:"courses"`
	IncludePersonalContext bool     `json:"include_personal_context,omitempty"`
}

type liveScheduleOutput struct {
	RequestID    string          `json:"request_id"`
	Status       protocol.Status `json:"status"`
	Message      string          `json:"message,omitempty"`
	Action       string          `json:"recoverable_action,omitempty"`
	RetryAfterMS int64           `json:"retry_after_ms,omitempty"`
	Evidence     json.RawMessage `json:"evidence,omitempty"`
}

func newLiveScheduleTool(client livebridge.Client) liveScheduleTool {
	return liveScheduleTool{client: client}
}

func (liveScheduleTool) Name() string { return "query_live_schedule" }

func (liveScheduleTool) Description() string {
	return "Query current UC Davis course sections, seats, waitlists, or the student's consented registered courses, waitlisted courses, and Schedule Builder Pass 1 and Pass 2 appointments through the paired read-only browser extension."
}

func (liveScheduleTool) Schema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"term":{"type":"string","description":"Six-digit UC Davis term code or a human-readable term such as Fall Quarter 2026. Bare Fall, Spring, and Winter mean Quarter; Summer must specify Session 1, Special Session, Session 2, or Quarter."},"courses":{"type":"array","minItems":1,"maxItems":100,"items":{"type":"string","maxLength":32},"description":"Optional course identifiers such as ECS 036A. Omit when asking only for the student's registered courses, waitlisted courses, and pass appointments."},"include_personal_context":{"type":"boolean","description":"Set true to request the session-consented registered courses, waitlisted courses, and Schedule Builder Pass 1 and Pass 2 appointments, either alone or alongside course search results."}},"required":["term"],"additionalProperties":false}`)
}

func (liveScheduleTool) ReadOnly() bool     { return true }
func (liveScheduleTool) PlanModeSafe() bool { return true }
func (liveScheduleTool) SnipHint() tool.SnipHint {
	return tool.SnipHint{Head: 100, Tail: 10, HeadChars: 30000, TailChars: 3000}
}

func (t liveScheduleTool) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	if t.client == nil {
		return "", fmt.Errorf("live schedule bridge is unavailable")
	}
	var args liveScheduleArgs
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&args); err != nil {
		return "", fmt.Errorf("invalid live schedule args: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return "", fmt.Errorf("invalid live schedule args: trailing content")
	}

	normalizedTerm, err := normalizeUCDTerm(args.Term)
	if err != nil {
		return "", fmt.Errorf("invalid live schedule args: %w", err)
	}
	args.Term = normalizedTerm
	if len(args.Courses) == 0 && !args.IncludePersonalContext {
		return "", fmt.Errorf("invalid live schedule args: provide courses or set include_personal_context")
	}
	if len(args.Courses) > 100 {
		return "", fmt.Errorf("invalid live schedule args: courses must contain at most 100 values")
	}
	seen := make(map[string]struct{}, len(args.Courses))
	courses := make([]string, 0, len(args.Courses))
	for _, course := range args.Courses {
		normalized := strings.ToUpper(strings.Join(strings.Fields(course), " "))
		if normalized == "" || len(normalized) > 32 {
			return "", fmt.Errorf("invalid live schedule args: course identifiers must contain 1 to 32 characters")
		}
		if _, duplicate := seen[normalized]; duplicate {
			continue
		}
		seen[normalized] = struct{}{}
		courses = append(courses, normalized)
	}

	requestID := fmt.Sprintf("req_%x_%x", time.Now().UnixMilli(), liveRequestSequence.Add(1))
	var result protocol.Result
	if len(courses) == 0 {
		result, err = t.client.Personal(ctx, livebridge.PersonalRequest{
			ID:         requestID,
			SessionID:  agent.ParentSession(ctx),
			Term:       args.Term,
			Categories: []string{"schedule", "waitlist", "pass_times"},
		})
	} else {
		result, err = t.client.Search(ctx, livebridge.SearchRequest{
			ID:                     requestID,
			SessionID:              agent.ParentSession(ctx),
			Term:                   args.Term,
			Courses:                courses,
			IncludePersonalContext: args.IncludePersonalContext,
		})
	}
	if err != nil {
		return "", err
	}
	out := liveScheduleOutput{
		RequestID:    requestID,
		Status:       result.Status,
		Message:      result.Message,
		Action:       recoverableAction(result.Status),
		RetryAfterMS: result.RetryAfterMS,
		Evidence:     result.Evidence,
	}
	encoded, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func recoverableAction(status protocol.Status) string {
	switch status {
	case protocol.StatusBrowserRequired, protocol.StatusLoginRequired:
		return "open_schedule_builder"
	case protocol.StatusExtensionRequired:
		return "install_or_enable_extension"
	case protocol.StatusPairingRequired:
		return "pair_extension"
	case protocol.StatusConsentRequired:
		return "request_session_consent"
	case protocol.StatusRateLimited:
		return "wait_then_retry"
	case protocol.StatusSiteVersionUnsupported:
		return "update_extension"
	default:
		return ""
	}
}
