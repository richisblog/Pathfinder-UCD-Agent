package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"sync"
	"time"
)

var errPairingDenied = errors.New("pairing code is invalid, expired, or already used")

type PairingChallenge struct {
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expires_at"`
}

type pairingRecord struct {
	expiresAt time.Time
	used      bool
}

type pairingManager struct {
	mu          sync.Mutex
	now         func() time.Time
	ttl         time.Duration
	challenges  map[string]pairingRecord
	credentials map[string]string
}

func newPairingManager(now func() time.Time, ttl time.Duration) *pairingManager {
	if now == nil {
		now = time.Now
	}
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	return &pairingManager{
		now:         now,
		ttl:         ttl,
		challenges:  make(map[string]pairingRecord),
		credentials: make(map[string]string),
	}
}

func (p *pairingManager) Issue() (PairingChallenge, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for attempt := 0; attempt < 10; attempt++ {
		n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
		if err != nil {
			return PairingChallenge{}, fmt.Errorf("generate pairing code: %w", err)
		}
		code := fmt.Sprintf("%06d", n.Int64())
		if _, exists := p.challenges[code]; exists {
			continue
		}
		expiresAt := p.now().Add(p.ttl)
		p.challenges[code] = pairingRecord{expiresAt: expiresAt}
		return PairingChallenge{Code: code, ExpiresAt: expiresAt}, nil
	}
	return PairingChallenge{}, errors.New("could not allocate unique pairing code")
}

func (p *pairingManager) Exchange(code, extensionID string) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	record, ok := p.challenges[code]
	if !ok || record.used || p.now().After(record.expiresAt) {
		return "", errPairingDenied
	}
	record.used = true
	p.challenges[code] = record
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate pairing credential: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	p.credentials[extensionID] = token
	return token, nil
}

func (p *pairingManager) Authenticate(extensionID, token string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	want, ok := p.credentials[extensionID]
	if !ok || len(want) != len(token) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(want), []byte(token)) == 1
}

func (p *pairingManager) Revoke(extensionID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.credentials, extensionID)
}
