package cache

import (
	"bytes"
	"testing"
	"time"
)

func TestSeatEntryRetainedButNotLiveAfterSixtySeconds(t *testing.T) {
	now := time.Date(2026, 7, 16, 9, 0, 0, 0, time.UTC)
	store := New(func() time.Time { return now })
	store.PutPublic("seat:ECS036A", []byte(`{"open":4}`), PublicSeatPolicy)

	now = now.Add(61 * time.Second)
	entry, ok := store.GetPublic("seat:ECS036A")
	if !ok || entry.Live {
		t.Fatalf("entry=%+v ok=%v, want retained stale entry", entry, ok)
	}
	if !bytes.Equal(entry.Data, []byte(`{"open":4}`)) {
		t.Fatalf("data = %q", entry.Data)
	}
}

func TestPublicEntryExpiresAfterRetention(t *testing.T) {
	now := time.Date(2026, 7, 16, 9, 0, 0, 0, time.UTC)
	store := New(func() time.Time { return now })
	store.PutPublic("structure:ECS036A", []byte(`{}`), PublicStructurePolicy)
	now = now.Add(30*time.Minute + time.Nanosecond)
	if _, ok := store.GetPublic("structure:ECS036A"); ok {
		t.Fatal("expired public entry remained available")
	}
}

func TestClearPersonalRemovesOnlyRequestedSession(t *testing.T) {
	now := time.Date(2026, 7, 16, 9, 0, 0, 0, time.UTC)
	store := New(func() time.Time { return now })
	store.PutPersonal("session-a", "schedule", []byte(`{"course":"ECS"}`))
	store.PutPersonal("session-b", "schedule", []byte(`{"course":"MAT"}`))

	store.ClearPersonal("session-a")
	if _, ok := store.GetPersonal("session-a", "schedule"); ok {
		t.Fatal("revoked session personal data remained")
	}
	if _, ok := store.GetPersonal("session-b", "schedule"); !ok {
		t.Fatal("other session personal data was removed")
	}
}

func TestPersonalEntryExpiresAfterFiveMinutes(t *testing.T) {
	now := time.Date(2026, 7, 16, 9, 0, 0, 0, time.UTC)
	store := New(func() time.Time { return now })
	store.PutPersonal("session-a", "holds", []byte(`[]`))
	now = now.Add(5*time.Minute + time.Nanosecond)
	if _, ok := store.GetPersonal("session-a", "holds"); ok {
		t.Fatal("expired personal entry remained available")
	}
}
