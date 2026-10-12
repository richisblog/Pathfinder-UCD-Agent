package tools

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSearchTextContextRanksMatches(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "writing_requirements.md"), []byte("ELWR and Writing Placement Survey determine first-year writing placement."), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "math.txt"), []byte("Math placement is required for MAT 021A enrollment."), 0o600); err != nil {
		t.Fatal(err)
	}

	svc := NewTextService(dir)
	got, err := svc.Search("writing placement survey", 3)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(got.Matches) == 0 || got.Matches[0].Source != "writing_requirements.md" {
		t.Fatalf("matches = %+v", got.Matches)
	}
}

func TestSearchTextContextCapsLimit(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	for _, name := range []string{"a.txt", "b.txt", "c.txt", "d.txt", "e.txt", "f.txt", "g.txt", "h.txt", "i.txt", "j.txt", "k.txt"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("placement placement placement"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	svc := NewTextService(dir)
	got, err := svc.Search("placement", 99)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(got.Matches) != 10 {
		t.Fatalf("match count = %d", len(got.Matches))
	}
}
