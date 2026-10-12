package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"
)

type Thread struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type Message struct {
	ID        string `json:"id"`
	ThreadID  string `json:"threadId"`
	Role      string `json:"role"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt"`
}

func (s *Store) CreateThread(title string) (Thread, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		title = "New chat"
	}
	id := newID("thr")
	tx, err := s.db.Begin()
	if err != nil {
		return Thread{}, err
	}
	defer tx.Rollback()
	seq, err := nextChatSeq(tx)
	if err != nil {
		return Thread{}, err
	}
	if _, err := tx.Exec(`INSERT INTO chat_threads (id, title, updated_seq) VALUES (?, ?, ?)`, id, title, seq); err != nil {
		return Thread{}, err
	}
	if err := tx.Commit(); err != nil {
		return Thread{}, err
	}
	return s.Thread(id)
}

func (s *Store) Thread(id string) (Thread, error) {
	var t Thread
	err := s.db.QueryRow(`SELECT id, title, created_at, updated_at FROM chat_threads WHERE id = ? AND archived_at IS NULL`, id).
		Scan(&t.ID, &t.Title, &t.CreatedAt, &t.UpdatedAt)
	return t, err
}

func (s *Store) Threads() ([]Thread, error) {
	rows, err := s.db.Query(`SELECT id, title, created_at, updated_at FROM chat_threads WHERE archived_at IS NULL ORDER BY updated_seq DESC, updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Thread
	for rows.Next() {
		var t Thread
		if err := rows.Scan(&t.ID, &t.Title, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) ArchiveThread(id string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	seq, err := nextChatSeq(tx)
	if err != nil {
		return err
	}
	res, err := tx.Exec(`UPDATE chat_threads SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, updated_seq = ? WHERE id = ? AND archived_at IS NULL`, seq, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return tx.Commit()
}

func (s *Store) AddMessage(threadID, role, content string) (Message, error) {
	role = strings.TrimSpace(role)
	if role != "user" && role != "assistant" && role != "system" {
		return Message{}, fmt.Errorf("invalid role %q", role)
	}
	content = strings.TrimSpace(content)
	if content == "" {
		return Message{}, fmt.Errorf("message content required")
	}
	id := newID("msg")
	tx, err := s.db.Begin()
	if err != nil {
		return Message{}, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`
INSERT INTO chat_messages (id, thread_id, role, content)
SELECT ?, id, ?, ?
FROM chat_threads
WHERE id = ? AND archived_at IS NULL
`, id, role, content, threadID)
	if err != nil {
		return Message{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Message{}, sql.ErrNoRows
	}
	seq, err := nextChatSeq(tx)
	if err != nil {
		return Message{}, err
	}
	if _, err := tx.Exec(`UPDATE chat_threads SET updated_at = CURRENT_TIMESTAMP, updated_seq = ? WHERE id = ?`, seq, threadID); err != nil {
		return Message{}, err
	}
	if err := tx.Commit(); err != nil {
		return Message{}, err
	}
	return s.Message(id)
}

func (s *Store) Message(id string) (Message, error) {
	var m Message
	err := s.db.QueryRow(`SELECT id, thread_id, role, content, created_at FROM chat_messages WHERE id = ?`, id).
		Scan(&m.ID, &m.ThreadID, &m.Role, &m.Content, &m.CreatedAt)
	return m, err
}

func (s *Store) Messages(threadID string) ([]Message, error) {
	rows, err := s.db.Query(`
SELECT m.id, m.thread_id, m.role, m.content, m.created_at
FROM chat_messages AS m
JOIN chat_threads AS t ON t.id = m.thread_id
WHERE m.thread_id = ? AND t.archived_at IS NULL
ORDER BY m.created_at ASC, m.rowid ASC
`, threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.ThreadID, &m.Role, &m.Content, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func newID(prefix string) string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return prefix + "_" + hex.EncodeToString(b[:])
}

func nextChatSeq(tx *sql.Tx) (int64, error) {
	if _, err := tx.Exec(`INSERT OR IGNORE INTO store_meta (key, value) VALUES ('chat_updated_seq', 0)`); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`UPDATE store_meta SET value = value + 1 WHERE key = 'chat_updated_seq'`); err != nil {
		return 0, err
	}
	var seq int64
	if err := tx.QueryRow(`SELECT value FROM store_meta WHERE key = 'chat_updated_seq'`).Scan(&seq); err != nil {
		return 0, err
	}
	return seq, nil
}
