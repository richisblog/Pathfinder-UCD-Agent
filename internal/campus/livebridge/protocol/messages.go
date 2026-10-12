package protocol

import "encoding/json"

const (
	Version         = 1
	MaxMessageBytes = 1 << 20

	TypeRequest = "request"
	TypeResult  = "result"

	MethodBridgeStatus     = "bridge.status"
	MethodScheduleTerms    = "schedule.terms"
	MethodScheduleSearch   = "schedule.search"
	MethodSchedulePersonal = "schedule.personal"
	MethodRequestCancel    = "request.cancel"
)

type Status string

const (
	StatusOK                     Status = "OK"
	StatusPartial                Status = "PARTIAL"
	StatusBrowserRequired        Status = "BROWSER_REQUIRED"
	StatusExtensionRequired      Status = "EXTENSION_REQUIRED"
	StatusPairingRequired        Status = "PAIRING_REQUIRED"
	StatusLoginRequired          Status = "LOGIN_REQUIRED"
	StatusConsentRequired        Status = "CONSENT_REQUIRED"
	StatusRateLimited            Status = "RATE_LIMITED"
	StatusSiteVersionUnsupported Status = "SITE_VERSION_UNSUPPORTED"
	StatusInvalidRequest         Status = "INVALID_REQUEST"
	StatusCancelled              Status = "CANCELLED"
	StatusInternalError          Status = "INTERNAL_ERROR"
)

type Request struct {
	Protocol int             `json:"protocol"`
	ID       string          `json:"id"`
	Type     string          `json:"type"`
	Method   string          `json:"method"`
	SentAt   string          `json:"sent_at,omitempty"`
	Params   json.RawMessage `json:"params"`
}

type Result struct {
	Protocol     int             `json:"protocol"`
	ID           string          `json:"id"`
	Type         string          `json:"type"`
	Status       Status          `json:"status"`
	Message      string          `json:"message,omitempty"`
	RetryAfterMS int64           `json:"retry_after_ms,omitempty"`
	Evidence     json.RawMessage `json:"evidence,omitempty"`
}

type SearchParams struct {
	Term                   string   `json:"term"`
	Courses                []string `json:"courses"`
	IncludePersonalContext bool     `json:"include_personal_context,omitempty"`
}

type PersonalParams struct {
	Term       string   `json:"term"`
	Categories []string `json:"categories"`
}

type CancelParams struct {
	RequestID string `json:"request_id"`
}
