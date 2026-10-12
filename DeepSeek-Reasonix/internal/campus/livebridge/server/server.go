package server

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"reasonix/internal/campus/livebridge"
	"reasonix/internal/campus/livebridge/protocol"
)

const BridgePath = "/v1/bridge"

const (
	wireHello        = "hello"
	wireHelloResult  = "hello.result"
	wirePairExchange = "pair.exchange"
	wirePairResult   = "pair.result"
)

type wireMessage struct {
	Protocol    int             `json:"protocol"`
	Type        string          `json:"type"`
	ExtensionID string          `json:"extension_id,omitempty"`
	Code        string          `json:"code,omitempty"`
	Token       string          `json:"token,omitempty"`
	Status      protocol.Status `json:"status,omitempty"`
	Message     string          `json:"message,omitempty"`
}

type Options struct {
	Ports               []int
	AllowedExtensionIDs []string
	// AllowDynamicExtensionIDs permits a syntactically valid unpacked Chrome
	// extension to reach the pairing handshake. The one-use code is still
	// required, and the resulting credential is bound to that exact extension ID.
	AllowDynamicExtensionIDs bool
	Now                      func() time.Time
	PairingTTL               time.Duration
}

type pendingResult struct {
	result protocol.Result
	err    error
}

type Server struct {
	opts    Options
	pairing *pairingManager

	mu          sync.Mutex
	listener    net.Listener
	httpServer  *http.Server
	conn        *websocket.Conn
	extensionID string
	pending     map[string]chan pendingResult
	closed      bool

	writeMu sync.Mutex
}

func New(opts Options) *Server {
	if len(opts.Ports) == 0 {
		opts.Ports = []int{38673, 38674, 38675}
	}
	return &Server{
		opts:    opts,
		pairing: newPairingManager(opts.Now, opts.PairingTTL),
		pending: make(map[string]chan pendingResult),
	}
}

func (s *Server) Start(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.listener != nil {
		return nil
	}
	var lastErr error
	for _, port := range s.opts.Ports {
		listener, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
		if err != nil {
			lastErr = err
			continue
		}
		s.listener = listener
		break
	}
	if s.listener == nil {
		return fmt.Errorf("listen on Pathfinder bridge ports: %w", lastErr)
	}
	mux := http.NewServeMux()
	mux.HandleFunc(BridgePath, s.handleBridge)
	s.httpServer = &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	server := s.httpServer
	listener := s.listener
	go func() {
		_ = server.Serve(listener)
	}()
	if done := ctx.Done(); done != nil {
		go func() {
			<-done
			_ = s.Close()
		}()
	}
	return nil
}

func (s *Server) Addr() net.Addr {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.listener == nil {
		return nil
	}
	return s.listener.Addr()
}

func (s *Server) IssuePairingCode() (PairingChallenge, error) {
	return s.pairing.Issue()
}

func (s *Server) Revoke(extensionID string) {
	s.pairing.Revoke(extensionID)
	s.mu.Lock()
	if s.extensionID == extensionID && s.conn != nil {
		_ = s.conn.Close()
		s.conn = nil
		s.extensionID = ""
	}
	s.mu.Unlock()
}

func (s *Server) Status(context.Context) (livebridge.Status, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return livebridge.Status{
		Connected:     s.conn != nil,
		ExtensionID:   s.extensionID,
		Authenticated: s.conn != nil && s.extensionID != "",
	}, nil
}

func (s *Server) Search(ctx context.Context, input livebridge.SearchRequest) (protocol.Result, error) {
	params, err := json.Marshal(protocol.SearchParams{
		Term:                   input.Term,
		Courses:                input.Courses,
		IncludePersonalContext: input.IncludePersonalContext,
	})
	if err != nil {
		return protocol.Result{}, err
	}
	return s.call(ctx, protocol.Request{
		Protocol: protocol.Version,
		ID:       input.ID,
		Type:     protocol.TypeRequest,
		Method:   protocol.MethodScheduleSearch,
		Params:   params,
	})
}

func (s *Server) Personal(ctx context.Context, input livebridge.PersonalRequest) (protocol.Result, error) {
	params, err := json.Marshal(protocol.PersonalParams{Term: input.Term, Categories: input.Categories})
	if err != nil {
		return protocol.Result{}, err
	}
	return s.call(ctx, protocol.Request{
		Protocol: protocol.Version,
		ID:       input.ID,
		Type:     protocol.TypeRequest,
		Method:   protocol.MethodSchedulePersonal,
		Params:   params,
	})
}

func (s *Server) Cancel(ctx context.Context, requestID string) error {
	params, err := json.Marshal(protocol.CancelParams{RequestID: requestID})
	if err != nil {
		return err
	}
	_, err = s.call(ctx, protocol.Request{
		Protocol: protocol.Version,
		ID:       newRequestID(),
		Type:     protocol.TypeRequest,
		Method:   protocol.MethodRequestCancel,
		Params:   params,
	})
	return err
}

func (s *Server) call(ctx context.Context, req protocol.Request) (protocol.Result, error) {
	if req.ID == "" {
		req.ID = newRequestID()
	}
	if err := protocol.ValidateRequest(req); err != nil {
		return protocol.Result{}, err
	}
	resultCh := make(chan pendingResult, 1)
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return protocol.Result{}, errors.New("schedule bridge is closed")
	}
	conn := s.conn
	if conn == nil {
		s.mu.Unlock()
		return protocol.Result{Protocol: protocol.Version, ID: req.ID, Type: protocol.TypeResult, Status: protocol.StatusBrowserRequired}, nil
	}
	if _, exists := s.pending[req.ID]; exists {
		s.mu.Unlock()
		return protocol.Result{}, fmt.Errorf("request id %q is already active", req.ID)
	}
	s.pending[req.ID] = resultCh
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.pending, req.ID)
		s.mu.Unlock()
	}()
	if err := s.writeJSON(conn, req); err != nil {
		return protocol.Result{}, err
	}
	select {
	case <-ctx.Done():
		return protocol.Result{}, ctx.Err()
	case response := <-resultCh:
		return response.result, response.err
	}
}

func (s *Server) handleBridge(w http.ResponseWriter, r *http.Request) {
	originExtensionID, ok := s.extensionIDFromOrigin(r.Header.Get("Origin"))
	if !ok {
		http.Error(w, "forbidden origin", http.StatusForbidden)
		return
	}
	upgrader := websocket.Upgrader{
		CheckOrigin:     func(*http.Request) bool { return true },
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(protocol.MaxMessageBytes)
	go s.serveConnection(conn, originExtensionID)
}

func (s *Server) extensionIDFromOrigin(origin string) (string, bool) {
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "chrome-extension" || u.Host == "" {
		return "", false
	}
	for _, allowed := range s.opts.AllowedExtensionIDs {
		if u.Host == allowed {
			return allowed, true
		}
	}
	if s.opts.AllowDynamicExtensionIDs && validChromeExtensionID(u.Host) {
		return u.Host, true
	}
	return "", false
}

func validChromeExtensionID(value string) bool {
	if len(value) != 32 {
		return false
	}
	for _, char := range value {
		if char < 'a' || char > 'p' {
			return false
		}
	}
	return true
}

func (s *Server) serveConnection(conn *websocket.Conn, originExtensionID string) {
	defer conn.Close()
	var first wireMessage
	if err := conn.ReadJSON(&first); err != nil {
		return
	}
	if first.Protocol != protocol.Version || first.ExtensionID != originExtensionID {
		_ = s.writeJSON(conn, wireMessage{Protocol: protocol.Version, Type: wireHelloResult, Status: protocol.StatusInvalidRequest})
		return
	}
	switch first.Type {
	case wirePairExchange:
		token, err := s.pairing.Exchange(first.Code, first.ExtensionID)
		if err != nil {
			_ = s.writeJSON(conn, wireMessage{Protocol: protocol.Version, Type: wirePairResult, Status: protocol.StatusPairingRequired})
			return
		}
		_ = s.writeJSON(conn, wireMessage{Protocol: protocol.Version, Type: wirePairResult, Status: protocol.StatusOK, Token: token})
		return
	case wireHello:
		if !s.pairing.Authenticate(first.ExtensionID, first.Token) {
			_ = s.writeJSON(conn, wireMessage{Protocol: protocol.Version, Type: wireHelloResult, Status: protocol.StatusPairingRequired})
			return
		}
	default:
		_ = s.writeJSON(conn, wireMessage{Protocol: protocol.Version, Type: wireHelloResult, Status: protocol.StatusInvalidRequest})
		return
	}

	s.mu.Lock()
	old := s.conn
	s.conn = conn
	s.extensionID = first.ExtensionID
	s.mu.Unlock()
	if old != nil && old != conn {
		_ = old.Close()
	}
	if err := s.writeJSON(conn, wireMessage{Protocol: protocol.Version, Type: wireHelloResult, Status: protocol.StatusOK}); err != nil {
		s.dropConnection(conn, err)
		return
	}
	for {
		var result protocol.Result
		if err := conn.ReadJSON(&result); err != nil {
			s.dropConnection(conn, err)
			return
		}
		if result.Protocol != protocol.Version || result.Type != protocol.TypeResult {
			continue
		}
		s.mu.Lock()
		pending := s.pending[result.ID]
		s.mu.Unlock()
		if pending != nil {
			select {
			case pending <- pendingResult{result: result}:
			default:
			}
		}
	}
}

func (s *Server) dropConnection(conn *websocket.Conn, cause error) {
	s.mu.Lock()
	if s.conn != conn {
		s.mu.Unlock()
		return
	}
	s.conn = nil
	s.extensionID = ""
	pending := s.pending
	s.mu.Unlock()
	for _, ch := range pending {
		select {
		case ch <- pendingResult{err: fmt.Errorf("schedule bridge disconnected: %w", cause)}:
		default:
		}
	}
}

func (s *Server) writeJSON(conn *websocket.Conn, value any) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return conn.WriteJSON(value)
}

func (s *Server) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	conn := s.conn
	s.conn = nil
	httpServer := s.httpServer
	listener := s.listener
	s.listener = nil
	pending := s.pending
	s.mu.Unlock()
	if conn != nil {
		_ = conn.Close()
	}
	for _, ch := range pending {
		select {
		case ch <- pendingResult{err: errors.New("schedule bridge closed")}:
		default:
		}
	}
	if httpServer != nil {
		return httpServer.Close()
	}
	if listener != nil {
		return listener.Close()
	}
	return nil
}

func newRequestID() string {
	raw := make([]byte, 12)
	if _, err := rand.Read(raw); err != nil {
		return fmt.Sprintf("req_%d", time.Now().UnixNano())
	}
	return "req_" + base64.RawURLEncoding.EncodeToString(raw)
}
