package main

import "testing"

func TestCampusSettingsAndThreads(t *testing.T) {
	app := NewApp()
	app.setCampusStoreForTest(t.TempDir())

	settings, err := app.CampusSaveProviderSettings(CampusProviderSettingsInput{
		DisplayName: "OpenAI",
		BaseURL:     "https://api.openai.com/v1",
		Model:       "gpt-4.1-mini",
		APIKey:      "sk-test",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !settings.HasAPIKey || settings.APIKey != "" {
		t.Fatalf("settings = %+v", settings)
	}

	thread, err := app.CampusCreateThread("Planning")
	if err != nil {
		t.Fatal(err)
	}
	threads, err := app.CampusListThreads()
	if err != nil {
		t.Fatal(err)
	}
	if len(threads) != 1 || threads[0].ID != thread.ID {
		t.Fatalf("threads = %+v", threads)
	}

	msg, err := app.campusStore().AddMessage(thread.ID, "user", "hello")
	if err != nil {
		t.Fatal(err)
	}
	messages, err := app.CampusMessages(thread.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || messages[0].ID != msg.ID {
		t.Fatalf("messages = %+v", messages)
	}
}
