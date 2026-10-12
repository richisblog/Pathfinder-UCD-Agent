package main

import (
	"context"
	"fmt"
	"path/filepath"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	campusconfig "reasonix/internal/campus/config"
	campusopenai "reasonix/internal/campus/openai"
	campusrag "reasonix/internal/campus/rag"
	campusstore "reasonix/internal/campus/store"
	campustools "reasonix/internal/campus/tools"
)

const campusEventChannel = "campus:event"

type campusRuntime struct {
	mu             sync.Mutex
	paths          campusconfig.Paths
	store          *campusstore.Store
	scheduleBridge *scheduleBridgeRuntime
}

type CampusProviderSettingsInput struct {
	DisplayName string `json:"displayName"`
	BaseURL     string `json:"baseUrl"`
	Model       string `json:"model"`
	APIKey      string `json:"apiKey"`
	ClearAPIKey bool   `json:"clearApiKey"`
}

type CampusDataStatus struct {
	AppDataDir string          `json:"appDataDir"`
	DataRoot   string          `json:"dataRoot"`
	Available  map[string]bool `json:"available"`
}

func (a *App) campusRuntime() *campusRuntime {
	if a.campus != nil {
		return a.campus
	}
	paths := campusconfig.ResolvePaths()
	a.campus = &campusRuntime{paths: paths}
	return a.campus
}

func (a *App) campusStore() *campusstore.Store {
	rt := a.campusRuntime()
	rt.mu.Lock()
	defer rt.mu.Unlock()
	if rt.store != nil {
		return rt.store
	}
	s, err := campusstore.Open(rt.paths.DBPath)
	if err != nil {
		panic(err)
	}
	rt.store = s
	return rt.store
}

func (a *App) setCampusStoreForTest(dir string) {
	paths := campusconfig.ResolvePaths()
	paths.AppDataDir = dir
	paths.DBPath = filepath.Join(dir, "pathfinder.db")
	paths.DataRoot = filepath.Join(dir, "data")
	paths.SQLiteDir = filepath.Join(paths.DataRoot, "sqlite")
	paths.TextDir = filepath.Join(paths.DataRoot, "txt")
	a.campus = &campusRuntime{paths: paths}
}

func (a *App) CampusProviderSettings() (campusstore.ProviderSettings, error) {
	return a.campusStore().ProviderSettings()
}

func (a *App) CampusSaveProviderSettings(input CampusProviderSettingsInput) (campusstore.ProviderSettings, error) {
	s := a.campusStore()
	if err := s.SaveProviderSettings(campusstore.ProviderSettings{
		DisplayName: input.DisplayName,
		BaseURL:     input.BaseURL,
		Model:       input.Model,
		APIKey:      input.APIKey,
		ClearAPIKey: input.ClearAPIKey,
	}); err != nil {
		return campusstore.ProviderSettings{}, err
	}
	return s.ProviderSettings()
}

func (a *App) CampusListThreads() ([]campusstore.Thread, error) {
	return a.campusStore().Threads()
}

func (a *App) CampusCreateThread(title string) (campusstore.Thread, error) {
	return a.campusStore().CreateThread(title)
}

func (a *App) CampusMessages(threadID string) ([]campusstore.Message, error) {
	return a.campusStore().Messages(threadID)
}

func (a *App) CampusDeleteThread(threadID string) error {
	return a.campusStore().ArchiveThread(threadID)
}

func (a *App) CampusDataStatus() (CampusDataStatus, error) {
	rt := a.campusRuntime()
	runner := campustools.NewRunner(campustools.Paths{SQLiteDir: rt.paths.SQLiteDir, TextDir: rt.paths.TextDir})
	return CampusDataStatus{
		AppDataDir: rt.paths.AppDataDir,
		DataRoot:   rt.paths.DataRoot,
		Available:  runner.DataStatus(),
	}, nil
}

func (a *App) CampusSubmitMessage(threadID, message string) error {
	s := a.campusStore()
	settings, err := s.ProviderSettings()
	if err != nil {
		return err
	}
	apiKey, err := s.ProviderAPIKey()
	if err != nil {
		return err
	}
	if !settings.HasAPIKey || apiKey == "" {
		return fmt.Errorf("API key required")
	}
	if settings.BaseURL == "" {
		return fmt.Errorf("base URL required")
	}
	if settings.Model == "" {
		return fmt.Errorf("model required")
	}
	userMessage, err := s.AddMessage(threadID, "user", message)
	if err != nil {
		return err
	}

	historyRows, err := s.Messages(threadID)
	if err != nil {
		return err
	}
	history := make([]campusopenai.Message, 0, len(historyRows))
	for _, item := range historyRows {
		if item.ID == userMessage.ID {
			continue
		}
		if item.Role == "user" || item.Role == "assistant" {
			history = append(history, campusopenai.Message{Role: item.Role, Content: item.Content})
		}
	}

	rt := a.campusRuntime()
	client := campusopenai.NewClient(settings.BaseURL, apiKey, settings.Model)
	runner := campustools.NewRunner(campustools.Paths{SQLiteDir: rt.paths.SQLiteDir, TextDir: rt.paths.TextDir})
	service := campusrag.NewService(client, runner)

	go func() {
		answer, err := service.Answer(context.Background(), message, history, func(event campusrag.Event) {
			a.emitCampusEvent(threadID, event)
		})
		if err != nil {
			a.emitCampusEvent(threadID, campusrag.Event{Type: "error", Message: err.Error()})
			return
		}
		if answer != "" {
			if _, err := s.AddMessage(threadID, "assistant", answer); err != nil {
				a.emitCampusEvent(threadID, campusrag.Event{Type: "error", Message: err.Error()})
			}
		}
	}()
	return nil
}

func (a *App) emitCampusEvent(threadID string, event campusrag.Event) {
	payload := map[string]any{
		"threadId": threadID,
		"type":     event.Type,
		"name":     event.Name,
		"label":    event.Label,
		"content":  event.Content,
		"summary":  event.Summary,
		"message":  event.Message,
		"args":     event.Args,
	}
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, campusEventChannel, payload)
	}
}
