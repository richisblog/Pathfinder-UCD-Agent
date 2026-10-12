package store

import (
	"database/sql"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		_ = db.Close()
		return nil, err
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) migrate() error {
	if _, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS provider_settings (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	display_name TEXT NOT NULL DEFAULT '',
	base_url TEXT NOT NULL DEFAULT '',
	model TEXT NOT NULL DEFAULT '',
	api_key TEXT NOT NULL DEFAULT '',
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS chat_threads (
	id TEXT PRIMARY KEY,
	title TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_seq INTEGER NOT NULL DEFAULT 0,
	archived_at TEXT
);
CREATE TABLE IF NOT EXISTS chat_messages (
	id TEXT PRIMARY KEY,
	thread_id TEXT NOT NULL,
	role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
	content TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY(thread_id) REFERENCES chat_threads(id)
);
CREATE TABLE IF NOT EXISTS store_meta (
	key TEXT PRIMARY KEY,
	value INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created ON chat_messages(thread_id, created_at ASC);
`); err != nil {
		return err
	}
	hasUpdatedSeq, err := s.hasColumn("chat_threads", "updated_seq")
	if err != nil {
		return err
	}
	if !hasUpdatedSeq {
		if _, err := s.db.Exec(`ALTER TABLE chat_threads ADD COLUMN updated_seq INTEGER NOT NULL DEFAULT 0`); err != nil {
			return err
		}
	}
	_, err = s.db.Exec(`
UPDATE chat_threads SET updated_seq = rowid WHERE updated_seq = 0;
INSERT OR IGNORE INTO store_meta (key, value)
SELECT 'chat_updated_seq', COALESCE(MAX(updated_seq), 0) FROM chat_threads;
DROP INDEX IF EXISTS idx_chat_threads_updated;
CREATE INDEX idx_chat_threads_updated ON chat_threads(archived_at, updated_seq DESC, updated_at DESC);
`)
	return err
}

func (s *Store) hasColumn(table, column string) (bool, error) {
	rows, err := s.db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}
