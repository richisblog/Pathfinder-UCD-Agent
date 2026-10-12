package livebridge

import (
	"context"

	"reasonix/internal/campus/livebridge/protocol"
)

type Status struct {
	Connected     bool   `json:"connected"`
	ExtensionID   string `json:"extension_id,omitempty"`
	Authenticated bool   `json:"authenticated"`
}

type SearchRequest struct {
	ID                     string
	SessionID              string
	Term                   string
	Courses                []string
	IncludePersonalContext bool
}

type PersonalRequest struct {
	ID         string
	SessionID  string
	Term       string
	Categories []string
}

type Client interface {
	Status(context.Context) (Status, error)
	Search(context.Context, SearchRequest) (protocol.Result, error)
	Personal(context.Context, PersonalRequest) (protocol.Result, error)
	Cancel(context.Context, string) error
}
