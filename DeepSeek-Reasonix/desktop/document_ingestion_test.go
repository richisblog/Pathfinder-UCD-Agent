package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInspectDocumentReturnsBoundedMetadata(t *testing.T) {
	root := t.TempDir()
	orig, _ := os.Getwd()
	t.Cleanup(func() { _ = os.Chdir(orig) })
	if err := os.Chdir(root); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile("notes.txt", []byte("Degree audit notes"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := (&App{}).InspectDocument("notes.txt")
	if got.Status != "ready" || got.Format != "txt" || got.Characters == 0 {
		t.Fatalf("InspectDocument = %+v", got)
	}
}

func TestInspectDocumentRejectsPathOutsideWorkspace(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "secret.txt")
	if err := os.WriteFile(outside, []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	app := &App{tabs: map[string]*WorkspaceTab{"x": {ID: "x", WorkspaceRoot: root}}, activeTabID: "x"}
	got := app.InspectDocument(outside)
	if got.Status != "failed" || got.Code != "invalid_path" {
		t.Fatalf("InspectDocument = %+v", got)
	}
}

func TestInspectDocumentRejectsWorkspaceSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "outside")); err != nil {
		t.Skipf("symlink unsupported: %v", err)
	}
	app := &App{tabs: map[string]*WorkspaceTab{"x": {ID: "x", WorkspaceRoot: root}}, activeTabID: "x"}
	got := app.InspectDocument(filepath.Join("outside", "secret.txt"))
	if got.Status != "failed" || got.Code != "invalid_path" {
		t.Fatalf("InspectDocument = %+v", got)
	}
}
