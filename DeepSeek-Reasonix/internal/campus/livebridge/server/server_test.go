package server

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"reasonix/internal/campus/livebridge"
	"reasonix/internal/campus/livebridge/protocol"
)

const testExtensionID = "abcdefghijklmnopabcdefghijklmnop"
const otherExtensionID = "ponmlkjihgfedcbaponmlkjihgfedcba"

func TestServerBindsLoopbackOnly(t *testing.T) {
	srv := New(Options{Ports: []int{0}, AllowedExtensionIDs: []string{testExtensionID}})
	if err := srv.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	host, _, err := net.SplitHostPort(srv.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	if host != "127.0.0.1" {
		t.Fatalf("host=%q, want loopback", host)
	}
}

func TestServerRejectsWebPageOrigin(t *testing.T) {
	srv := startTestServer(t)
	header := http.Header{"Origin": []string{"https://example.com"}}
	conn, response, err := websocket.DefaultDialer.Dial("ws://"+srv.Addr().String()+BridgePath, header)
	if conn != nil {
		_ = conn.Close()
	}
	if err == nil || response == nil || response.StatusCode != http.StatusForbidden {
		t.Fatalf("Dial err=%v status=%v, want 403", err, statusCode(response))
	}
}

func TestServerAllowsDynamicChromeExtensionIDOnlyWithPairingCode(t *testing.T) {
	srv := New(Options{Ports: []int{0}, AllowDynamicExtensionIDs: true})
	if err := srv.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })

	challenge, err := srv.IssuePairingCode()
	if err != nil {
		t.Fatal(err)
	}
	conn := dialWithOrigin(t, srv, otherExtensionID)
	if err := conn.WriteJSON(wireMessage{
		Protocol: protocol.Version, Type: wirePairExchange,
		ExtensionID: otherExtensionID, Code: challenge.Code,
	}); err != nil {
		t.Fatal(err)
	}
	var response wireMessage
	if err := conn.ReadJSON(&response); err != nil {
		t.Fatal(err)
	}
	if response.Status != protocol.StatusOK || len(response.Token) < 40 {
		t.Fatalf("response=%+v", response)
	}
}

func TestServerRejectsMalformedDynamicExtensionOrigin(t *testing.T) {
	srv := New(Options{Ports: []int{0}, AllowDynamicExtensionIDs: true})
	if err := srv.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	header := http.Header{"Origin": []string{"chrome-extension://not-a-valid-id"}}
	conn, response, err := websocket.DefaultDialer.Dial("ws://"+srv.Addr().String()+BridgePath, header)
	if conn != nil {
		_ = conn.Close()
	}
	if err == nil || response == nil || response.StatusCode != http.StatusForbidden {
		t.Fatalf("Dial err=%v status=%v, want 403", err, statusCode(response))
	}
}

func TestServerPairsAuthenticatesAndCorrelatesSearchResult(t *testing.T) {
	srv := startTestServer(t)
	challenge, err := srv.IssuePairingCode()
	if err != nil {
		t.Fatal(err)
	}

	pairConn := dialExtension(t, srv)
	if err := pairConn.WriteJSON(wireMessage{
		Protocol:    protocol.Version,
		Type:        wirePairExchange,
		ExtensionID: testExtensionID,
		Code:        challenge.Code,
	}); err != nil {
		t.Fatal(err)
	}
	var paired wireMessage
	if err := pairConn.ReadJSON(&paired); err != nil {
		t.Fatal(err)
	}
	_ = pairConn.Close()
	if paired.Status != protocol.StatusOK || len(paired.Token) < 40 {
		t.Fatalf("pair response = %+v", paired)
	}

	conn := dialExtension(t, srv)
	if err := conn.WriteJSON(wireMessage{
		Protocol:    protocol.Version,
		Type:        wireHello,
		ExtensionID: testExtensionID,
		Token:       paired.Token,
	}); err != nil {
		t.Fatal(err)
	}
	var hello wireMessage
	if err := conn.ReadJSON(&hello); err != nil {
		t.Fatal(err)
	}
	if hello.Status != protocol.StatusOK {
		t.Fatalf("hello = %+v", hello)
	}

	done := make(chan error, 1)
	go func() {
		var req protocol.Request
		if err := conn.ReadJSON(&req); err != nil {
			done <- err
			return
		}
		if req.ID != "req_search_01" || req.Method != protocol.MethodScheduleSearch {
			done <- &testError{"unexpected request"}
			return
		}
		done <- conn.WriteJSON(protocol.Result{
			Protocol: protocol.Version,
			ID:       req.ID,
			Type:     protocol.TypeResult,
			Status:   protocol.StatusOK,
			Evidence: json.RawMessage(`{"source":"ucd_schedule_builder"}`),
		})
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	result, err := srv.Search(ctx, livebridge.SearchRequest{
		ID:      "req_search_01",
		Term:    "2026-fall",
		Courses: []string{"ECS 036A"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != protocol.StatusOK || !strings.Contains(string(result.Evidence), "ucd_schedule_builder") {
		t.Fatalf("result = %+v", result)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestServerRejectsExtensionIDThatDoesNotMatchOrigin(t *testing.T) {
	srv := New(Options{Ports: []int{0}, AllowedExtensionIDs: []string{testExtensionID, otherExtensionID}})
	if err := srv.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	challenge, err := srv.IssuePairingCode()
	if err != nil {
		t.Fatal(err)
	}
	conn := dialWithOrigin(t, srv, testExtensionID)
	if err := conn.WriteJSON(wireMessage{
		Protocol:    protocol.Version,
		Type:        wirePairExchange,
		ExtensionID: otherExtensionID,
		Code:        challenge.Code,
	}); err != nil {
		t.Fatal(err)
	}
	var response wireMessage
	if err := conn.ReadJSON(&response); err != nil {
		t.Fatal(err)
	}
	if response.Status != protocol.StatusInvalidRequest {
		t.Fatalf("response = %+v, want INVALID_REQUEST", response)
	}
}

func startTestServer(t *testing.T) *Server {
	t.Helper()
	srv := New(Options{Ports: []int{0}, AllowedExtensionIDs: []string{testExtensionID}})
	if err := srv.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	return srv
}

func dialExtension(t *testing.T, srv *Server) *websocket.Conn {
	return dialWithOrigin(t, srv, testExtensionID)
}

func dialWithOrigin(t *testing.T, srv *Server, extensionID string) *websocket.Conn {
	t.Helper()
	header := http.Header{"Origin": []string{"chrome-extension://" + extensionID}}
	conn, response, err := websocket.DefaultDialer.Dial("ws://"+srv.Addr().String()+BridgePath, header)
	if err != nil {
		t.Fatalf("Dial: %v (status=%v)", err, statusCode(response))
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func statusCode(response *http.Response) any {
	if response == nil {
		return nil
	}
	return response.StatusCode
}

type testError struct{ message string }

func (e *testError) Error() string { return e.message }
