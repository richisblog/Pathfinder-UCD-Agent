package cache

import (
	"sync"
	"time"
)

type Policy struct {
	Retention  time.Duration
	LiveFor    time.Duration
	MemoryOnly bool
}

var (
	PublicStructurePolicy = Policy{Retention: 30 * time.Minute, LiveFor: 30 * time.Minute}
	PublicSeatPolicy      = Policy{Retention: 30 * time.Minute, LiveFor: 60 * time.Second}
	PersonalPolicy        = Policy{Retention: 5 * time.Minute, LiveFor: 5 * time.Minute, MemoryOnly: true}
)

type Entry struct {
	Data     []byte
	StoredAt time.Time
	Live     bool
}

type storedEntry struct {
	data     []byte
	storedAt time.Time
	policy   Policy
}

type Store struct {
	mu       sync.Mutex
	now      func() time.Time
	public   map[string]storedEntry
	personal map[string]map[string]storedEntry
}

func New(now func() time.Time) *Store {
	if now == nil {
		now = time.Now
	}
	return &Store{
		now:      now,
		public:   make(map[string]storedEntry),
		personal: make(map[string]map[string]storedEntry),
	}
}

func (s *Store) PutPublic(key string, data []byte, policy Policy) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.public[key] = storedEntry{data: clone(data), storedAt: s.now(), policy: policy}
}

func (s *Store) GetPublic(key string) (Entry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.public[key]
	if !ok {
		return Entry{}, false
	}
	return s.readLocked(s.public, key, entry)
}

func (s *Store) PutPersonal(sessionID, key string, data []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries := s.personal[sessionID]
	if entries == nil {
		entries = make(map[string]storedEntry)
		s.personal[sessionID] = entries
	}
	entries[key] = storedEntry{data: clone(data), storedAt: s.now(), policy: PersonalPolicy}
}

func (s *Store) GetPersonal(sessionID, key string) (Entry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries := s.personal[sessionID]
	if entries == nil {
		return Entry{}, false
	}
	entry, ok := entries[key]
	if !ok {
		return Entry{}, false
	}
	result, ok := s.readLocked(entries, key, entry)
	if len(entries) == 0 {
		delete(s.personal, sessionID)
	}
	return result, ok
}

func (s *Store) ClearPersonal(sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.personal, sessionID)
}

func (s *Store) readLocked(entries map[string]storedEntry, key string, entry storedEntry) (Entry, bool) {
	age := s.now().Sub(entry.storedAt)
	if age > entry.policy.Retention {
		delete(entries, key)
		return Entry{}, false
	}
	return Entry{Data: clone(entry.data), StoredAt: entry.storedAt, Live: age <= entry.policy.LiveFor}, true
}

func clone(data []byte) []byte {
	return append([]byte(nil), data...)
}
