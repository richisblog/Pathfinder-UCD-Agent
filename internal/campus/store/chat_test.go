package store

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestFreshStoreStartsWithoutChats(t *testing.T) {
	t.Parallel()
	s, err := Open(filepath.Join(t.TempDir(), "pathfinder.db"))
	if err != nil {
		t.Fatalf("open fresh store: %v", err)
	}
	defer s.Close()

	threads, err := s.Threads()
	if err != nil {
		t.Fatalf("list fresh threads: %v", err)
	}
	if len(threads) != 0 {
		t.Fatalf("fresh store contains packaged chat threads: %+v", threads)
	}
	var messageCount int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM chat_messages`).Scan(&messageCount); err != nil {
		t.Fatalf("count fresh messages: %v", err)
	}
	if messageCount != 0 {
		t.Fatalf("fresh store contains %d packaged chat messages", messageCount)
	}
}

func TestChatThreadAndMessages(t *testing.T) {
	t.Parallel()
	s, err := Open(filepath.Join(t.TempDir(), "pathfinder.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer s.Close()

	thread, err := s.CreateThread("Course planning")
	if err != nil {
		t.Fatalf("create thread: %v", err)
	}
	if thread.Title != "Course planning" || thread.ID == "" {
		t.Fatalf("thread = %+v", thread)
	}

	userMsg, err := s.AddMessage(thread.ID, "user", "Which ECS class should I take?")
	if err != nil {
		t.Fatalf("add user message: %v", err)
	}
	assistantMsg, err := s.AddMessage(thread.ID, "assistant", "Start with ECS 036A.")
	if err != nil {
		t.Fatalf("add assistant message: %v", err)
	}

	messages, err := s.Messages(thread.ID)
	if err != nil {
		t.Fatalf("messages: %v", err)
	}
	if len(messages) != 2 || messages[0].ID != userMsg.ID || messages[1].ID != assistantMsg.ID {
		t.Fatalf("messages = %+v", messages)
	}

	threads, err := s.Threads()
	if err != nil {
		t.Fatalf("threads: %v", err)
	}
	if len(threads) != 1 || threads[0].ID != thread.ID {
		t.Fatalf("threads = %+v", threads)
	}
}

func TestAddMessageRequiresActiveThread(t *testing.T) {
	t.Parallel()
	s := openTestStore(t)

	if _, err := s.AddMessage("missing-thread", "user", "hello"); err == nil {
		t.Fatalf("add message to missing thread succeeded")
	}

	messages, err := s.Messages("missing-thread")
	if err != nil {
		t.Fatalf("messages: %v", err)
	}
	if len(messages) != 0 {
		t.Fatalf("messages = %+v", messages)
	}
}

func TestThreadsOrdersNewestFirstForSameSecondWrites(t *testing.T) {
	t.Parallel()
	s := openTestStore(t)

	first, err := s.CreateThread("First")
	if err != nil {
		t.Fatalf("create first thread: %v", err)
	}
	second, err := s.CreateThread("Second")
	if err != nil {
		t.Fatalf("create second thread: %v", err)
	}
	third, err := s.CreateThread("Third")
	if err != nil {
		t.Fatalf("create third thread: %v", err)
	}

	threads, err := s.Threads()
	if err != nil {
		t.Fatalf("threads: %v", err)
	}
	if len(threads) != 3 {
		t.Fatalf("threads = %+v", threads)
	}
	if threads[0].ID != third.ID || threads[1].ID != second.ID || threads[2].ID != first.ID {
		t.Fatalf("threads = %+v", threads)
	}
}

func TestThreadsOrdersRecentlyActiveThreadFirstForSameSecondWrites(t *testing.T) {
	t.Parallel()
	s := openTestStore(t)

	first, err := s.CreateThread("First")
	if err != nil {
		t.Fatalf("create first thread: %v", err)
	}
	second, err := s.CreateThread("Second")
	if err != nil {
		t.Fatalf("create second thread: %v", err)
	}
	if _, err := s.AddMessage(first.ID, "user", "bring this thread back"); err != nil {
		t.Fatalf("add message: %v", err)
	}

	threads, err := s.Threads()
	if err != nil {
		t.Fatalf("threads: %v", err)
	}
	if len(threads) != 2 {
		t.Fatalf("threads = %+v", threads)
	}
	if threads[0].ID != first.ID || threads[1].ID != second.ID {
		t.Fatalf("threads = %+v", threads)
	}
}

func TestArchiveThreadHidesThreadAndRejectsNewMessages(t *testing.T) {
	t.Parallel()
	s := openTestStore(t)

	thread, err := s.CreateThread("Course planning")
	if err != nil {
		t.Fatalf("create thread: %v", err)
	}
	if _, err := s.AddMessage(thread.ID, "user", "Which class?"); err != nil {
		t.Fatalf("add message: %v", err)
	}
	if err := s.ArchiveThread(thread.ID); err != nil {
		t.Fatalf("archive thread: %v", err)
	}
	if _, err := s.Thread(thread.ID); err == nil {
		t.Fatalf("archived thread loaded")
	}
	if _, err := s.AddMessage(thread.ID, "user", "hello"); err == nil {
		t.Fatalf("add message to archived thread succeeded")
	}
	messages, err := s.Messages(thread.ID)
	if err != nil {
		t.Fatalf("messages: %v", err)
	}
	if len(messages) != 0 {
		t.Fatalf("messages = %+v", messages)
	}

	threads, err := s.Threads()
	if err != nil {
		t.Fatalf("threads: %v", err)
	}
	if len(threads) != 0 {
		t.Fatalf("threads = %+v", threads)
	}
}

func TestOpenMigratesLegacyChatThreadsUpdatedSeq(t *testing.T) {
	t.Parallel()
	dbPath := filepath.Join(t.TempDir(), "pathfinder.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open raw db: %v", err)
	}
	if _, err := db.Exec(`
CREATE TABLE chat_threads (
	id TEXT PRIMARY KEY,
	title TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	archived_at TEXT
);
CREATE TABLE chat_messages (
	id TEXT PRIMARY KEY,
	thread_id TEXT NOT NULL,
	role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
	content TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY(thread_id) REFERENCES chat_threads(id)
);
INSERT INTO chat_threads (id, title) VALUES ('legacy-first', 'First');
INSERT INTO chat_threads (id, title) VALUES ('legacy-second', 'Second');
`); err != nil {
		t.Fatalf("create legacy db: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close raw db: %v", err)
	}

	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("open migrated store: %v", err)
	}
	defer s.Close()

	if _, err := s.AddMessage("legacy-first", "user", "make first active"); err != nil {
		t.Fatalf("add message: %v", err)
	}
	threads, err := s.Threads()
	if err != nil {
		t.Fatalf("threads: %v", err)
	}
	if len(threads) != 2 {
		t.Fatalf("threads = %+v", threads)
	}
	if threads[0].ID != "legacy-first" || threads[1].ID != "legacy-second" {
		t.Fatalf("threads = %+v", threads)
	}
}
