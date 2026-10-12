package native

import (
	"encoding/json"
	"strings"
	"sync"
)

type successCache struct {
	mu      sync.RWMutex
	results map[string]string
}

func newSuccessCache() *successCache {
	return &successCache{results: make(map[string]string)}
}

func (c *successCache) load(name string, args json.RawMessage) (string, bool) {
	if c == nil {
		return "", false
	}
	key := cacheKey(name, args)
	c.mu.RLock()
	defer c.mu.RUnlock()
	result, ok := c.results[key]
	return result, ok
}

func (c *successCache) store(name string, args json.RawMessage, result string) {
	if c == nil || strings.TrimSpace(name) == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.results[cacheKey(name, args)] = result
}

func cacheKey(name string, args json.RawMessage) string {
	var value any
	canonical := strings.TrimSpace(string(args))
	if json.Unmarshal(args, &value) == nil {
		if encoded, err := json.Marshal(value); err == nil {
			canonical = string(encoded)
		}
	}
	return strings.TrimSpace(name) + "\x00" + canonical
}
