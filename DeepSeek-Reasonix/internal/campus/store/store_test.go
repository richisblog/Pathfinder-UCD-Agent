package store

import (
	"path/filepath"
	"testing"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "pathfinder.db")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Fatalf("close store: %v", err)
		}
	})
	return s
}

func TestProviderSettingsSaveLoadAndMask(t *testing.T) {
	t.Parallel()
	s := openTestStore(t)

	in := ProviderSettings{
		DisplayName: "OpenAI",
		BaseURL:     "https://api.openai.com/v1",
		Model:       "gpt-4.1-mini",
		APIKey:      "sk-test-1234567890",
	}
	if err := s.SaveProviderSettings(in); err != nil {
		t.Fatalf("save settings: %v", err)
	}

	got, err := s.ProviderSettings()
	if err != nil {
		t.Fatalf("load settings: %v", err)
	}
	if got.DisplayName != "OpenAI" || got.BaseURL != in.BaseURL || got.Model != in.Model {
		t.Fatalf("settings = %+v", got)
	}
	if got.APIKey != "" {
		t.Fatalf("api key exposed in settings read")
	}
	if !got.HasAPIKey {
		t.Fatalf("has API key = false")
	}
	if got.MaskedAPIKey != "********7890" {
		t.Fatalf("masked key = %q", got.MaskedAPIKey)
	}
}

func TestProviderAPIKeyReturnsRawCredential(t *testing.T) {
	t.Parallel()
	s := openTestStore(t)

	if err := s.SaveProviderSettings(ProviderSettings{
		DisplayName: "OpenAI",
		BaseURL:     "https://api.openai.com/v1",
		Model:       "gpt-4.1-mini",
		APIKey:      "sk-test-1234567890",
	}); err != nil {
		t.Fatalf("save settings: %v", err)
	}

	got, err := s.ProviderAPIKey()
	if err != nil {
		t.Fatalf("load api key: %v", err)
	}
	if got != "sk-test-1234567890" {
		t.Fatalf("api key = %q", got)
	}
}

func TestProviderSettingsCanExplicitlyClearAPIKey(t *testing.T) {
	t.Parallel()
	s := openTestStore(t)

	if err := s.SaveProviderSettings(ProviderSettings{
		DisplayName: "OpenAI",
		APIKey:      "sk-test-1234567890",
	}); err != nil {
		t.Fatalf("save settings: %v", err)
	}
	if err := s.SaveProviderSettings(ProviderSettings{
		DisplayName: "OpenAI",
		ClearAPIKey: true,
	}); err != nil {
		t.Fatalf("clear api key: %v", err)
	}

	settings, err := s.ProviderSettings()
	if err != nil {
		t.Fatalf("load settings: %v", err)
	}
	if settings.HasAPIKey {
		t.Fatalf("has API key = true")
	}
	if settings.MaskedAPIKey != "" {
		t.Fatalf("masked key = %q", settings.MaskedAPIKey)
	}
	got, err := s.ProviderAPIKey()
	if err != nil {
		t.Fatalf("load api key: %v", err)
	}
	if got != "" {
		t.Fatalf("api key = %q", got)
	}
}

func TestProviderSettingsEmptyAPIKeyPreservesExistingCredential(t *testing.T) {
	t.Parallel()
	s := openTestStore(t)

	if err := s.SaveProviderSettings(ProviderSettings{
		DisplayName: "OpenAI",
		BaseURL:     "https://api.openai.com/v1",
		Model:       "gpt-4.1-mini",
		APIKey:      "sk-test-1234567890",
	}); err != nil {
		t.Fatalf("save settings: %v", err)
	}
	if err := s.SaveProviderSettings(ProviderSettings{
		DisplayName: "OpenAI",
		BaseURL:     "https://proxy.example/v1",
		Model:       "gpt-4.1",
	}); err != nil {
		t.Fatalf("save settings without api key: %v", err)
	}

	got, err := s.ProviderAPIKey()
	if err != nil {
		t.Fatalf("load api key: %v", err)
	}
	if got != "sk-test-1234567890" {
		t.Fatalf("api key = %q", got)
	}
}

func TestForeignKeysRejectOrphanChatMessages(t *testing.T) {
	t.Parallel()
	s := openTestStore(t)

	_, err := s.db.Exec(`
INSERT INTO chat_messages (id, thread_id, role, content)
VALUES ('message-1', 'missing-thread', 'user', 'hello')
`)
	if err == nil {
		t.Fatalf("insert orphan chat message succeeded")
	}
}
