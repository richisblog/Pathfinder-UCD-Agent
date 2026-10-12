package server

import (
	"testing"
	"time"
)

func TestPairingCodeExpiresAndCanOnlySucceedOnce(t *testing.T) {
	now := time.Date(2026, 7, 16, 9, 0, 0, 0, time.UTC)
	p := newPairingManager(func() time.Time { return now }, 5*time.Minute)
	challenge, err := p.Issue()
	if err != nil {
		t.Fatal(err)
	}
	if len(challenge.Code) != 6 {
		t.Fatalf("pairing code length = %d, want 6", len(challenge.Code))
	}
	token, err := p.Exchange(challenge.Code, testExtensionID)
	if err != nil {
		t.Fatal(err)
	}
	if len(token) < 40 {
		t.Fatalf("token length = %d, want >= 40", len(token))
	}
	if _, err := p.Exchange(challenge.Code, testExtensionID); err == nil {
		t.Fatal("reused pairing code succeeded")
	}

	expired, err := p.Issue()
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(5*time.Minute + time.Nanosecond)
	if _, err := p.Exchange(expired.Code, testExtensionID); err == nil {
		t.Fatal("expired pairing code succeeded")
	}
}
