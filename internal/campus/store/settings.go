package store

import (
	"database/sql"
	"strings"
)

type ProviderSettings struct {
	DisplayName  string `json:"displayName"`
	BaseURL      string `json:"baseUrl"`
	Model        string `json:"model"`
	APIKey       string `json:"-"`
	ClearAPIKey  bool   `json:"-"`
	MaskedAPIKey string `json:"maskedApiKey"`
	HasAPIKey    bool   `json:"hasApiKey"`
}

func (s *Store) SaveProviderSettings(in ProviderSettings) error {
	_, err := s.db.Exec(`
INSERT INTO provider_settings (id, display_name, base_url, model, api_key, updated_at)
VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET
	display_name = excluded.display_name,
	base_url = excluded.base_url,
	model = excluded.model,
	api_key = CASE
		WHEN ? THEN ''
		WHEN excluded.api_key = '' THEN provider_settings.api_key
		ELSE excluded.api_key
	END,
	updated_at = CURRENT_TIMESTAMP
`, strings.TrimSpace(in.DisplayName), strings.TrimSpace(in.BaseURL), strings.TrimSpace(in.Model), strings.TrimSpace(in.APIKey), in.ClearAPIKey)
	return err
}

func (s *Store) ProviderSettings() (ProviderSettings, error) {
	var out ProviderSettings
	var apiKey string
	err := s.db.QueryRow(`SELECT display_name, base_url, model, api_key FROM provider_settings WHERE id = 1`).
		Scan(&out.DisplayName, &out.BaseURL, &out.Model, &apiKey)
	if err != nil {
		if err == sql.ErrNoRows {
			return ProviderSettings{}, nil
		}
		return ProviderSettings{}, err
	}
	out.HasAPIKey = apiKey != ""
	out.MaskedAPIKey = maskKey(apiKey)
	return out, nil
}

func (s *Store) ProviderAPIKey() (string, error) {
	var apiKey string
	err := s.db.QueryRow(`SELECT api_key FROM provider_settings WHERE id = 1`).Scan(&apiKey)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", err
	}
	return apiKey, nil
}

func maskKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 4 {
		return strings.Repeat("*", len(key))
	}
	return strings.Repeat("*", 8) + key[len(key)-4:]
}
