# Pathfinder Document Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make installed Pathfinder builds reliably read PDF, DOCX, RTF, HTML, and common plain-text attachments while preserving resolved document content through Memory v5 and exposing honest extraction status in the composer.

**Architecture:** Split Memory v5's raw classification input from its complete model-visible source event, then route every supported document through a new bounded `internal/documentextract` package. The controller uses the package when resolving `@` references, while the desktop bridge exposes the same extraction result to attachment chips and a new Add document control.

**Tech Stack:** Go 1.25/1.26 toolchain, Wails v2 desktop bridge, React 19, TypeScript 6, `github.com/ledongthuc/pdf` pinned pure-Go PDF reader, `golang.org/x/net/html`, existing `fileenc` encoding utilities.

## Global Constraints

- Preserve all existing dirty-worktree changes; do not reset, clean, restore, or overwrite unrelated files.
- Extraction must succeed without `pdftotext`, Python, pip, or user-installed PDF libraries.
- Raw files remain local and only bounded extracted text enters model context.
- Do not commit the user's `Jin.pdf` or any document from `.reasonix/attachments`.
- Image-only PDFs return `ocr_required`; OCR is outside this plan.
- Maximum accepted source size is 25 MiB and maximum extracted text is 512 KiB.
- Existing image attachment behavior, workspace confinement, external-folder tokens, and historical sessions remain compatible.
- Every production-code step follows a failing-test-first red/green cycle.

---

## File Structure

### New files

- `internal/documentextract/extract.go` — public extraction types, limits, dispatch, and bounded-result helpers.
- `internal/documentextract/text.go` — plain text and delimited/structured text decoding.
- `internal/documentextract/html.go` — HTML/XML visible-text conversion.
- `internal/documentextract/docx.go` — DOCX ZIP/XML paragraph and table extraction.
- `internal/documentextract/rtf.go` — bounded RTF text decoding.
- `internal/documentextract/pdf.go` — in-process PDF extraction and `ocr_required` classification.
- `internal/documentextract/extract_test.go` — format dispatch, bounds, unsupported, and oversized-file tests.
- `internal/documentextract/html_test.go` — HTML/XML extraction tests.
- `internal/documentextract/docx_test.go` — generated DOCX fixture tests.
- `internal/documentextract/rtf_test.go` — RTF escape/control-word tests.
- `internal/documentextract/pdf_test.go` — generated PDF, empty/image-only, malformed, and no-host-tool tests.
- `internal/documentextract/testutil/testutil.go` — generated redistributable PDF fixtures shared by package and integration tests.
- `desktop/document_ingestion_test.go` — desktop bridge inspection and workspace confinement tests.
- `desktop/frontend/src/__tests__/document-attachment.test.tsx` — Add document, status, error, and submit-wait behavior.

### Modified files

- `internal/agent/memory_compiler_context.go` — carry raw classification input separately.
- `internal/agent/agent.go` — classify on raw text but compile the complete source event.
- `internal/agent/loop_e2e_test.go` — lock in resolved-reference preservation.
- `internal/control/turn_orchestrator.go` — pass only classification input through context.
- `internal/control/refs.go` — delegate supported file extraction to `documentextract`.
- `internal/control/refs_test.go` — replace mocked host-PDF behavior with package integration contracts.
- `go.mod`, `go.sum` — pin the PDF reader.
- `desktop/app.go` — expose `InspectDocument`.
- `desktop/frontend/src/lib/types.ts` — add extraction result types.
- `desktop/frontend/src/lib/bridge.ts` — bind and mock `InspectDocument`.
- `desktop/frontend/src/components/Composer.tsx` — Add document control and extraction-aware context cards.
- `desktop/frontend/src/components/ComposerContextCard.tsx` — render extraction status and metadata.
- `desktop/frontend/src/locales/en.ts` — English document labels and statuses.
- `desktop/frontend/src/locales/zh.ts` — Simplified Chinese labels and statuses.
- `desktop/frontend/src/locales/zh-TW.ts` — Traditional Chinese labels and statuses.
- `desktop/frontend/src/styles.css` — document button and status-chip styling.
- `desktop/frontend/package.json` — add the focused document-attachment test to Pathfinder/full suites.

---

### Task 1: Preserve Resolved References Through Memory v5

**Files:**

- Modify: `internal/agent/memory_compiler_context.go`
- Modify: `internal/agent/agent.go`
- Modify: `internal/agent/loop_e2e_test.go`
- Modify: `internal/control/turn_orchestrator.go`

**Interfaces:**

- Produces: `agent.WithMemoryCompilerClassificationInput(ctx context.Context, input string) context.Context`
- Produces: `agent.MemoryCompilerClassificationInputFromContext(ctx context.Context) (string, bool)`
- Preserves: `memorycompiler.Runtime.StartTurn(ctx, sourceEvent, history)` receives the complete resolved input.

- [ ] **Step 1: Change the E2E test to require complete reference context**

Replace the raw-source expectation in `internal/agent/loop_e2e_test.go` with:

```go
func TestRunMemoryCompilerClassifiesRawPromptAndPreservesResolvedRefs(t *testing.T) {
	rt := memorycompiler.New(t.TempDir())
	_, seed := rt.StartTurn(context.Background(), "fix a bug", nil)
	seed.RecordToolResults([]memorycompiler.ToolRecord{
		{Name: "bash", Error: "exit status 1"},
		{Name: "bash", Error: "exit status 1"},
	})
	seed.Finish(nil)

	expanded := "Referenced context:\n\n<file path=\"auth.go\">\npackage main\nconst secret = true\n</file>\n\nfix @auth.go"
	raw := "fix @auth.go"
	mp := testutil.NewMock("m", testutil.Turn{Text: "done"})
	a := New(mp, echoRegistry(), NewSession(""), Options{
		MemoryCompiler:          rt,
		MemoryCompilerVerbosity: MemoryCompilerVerbosityCompact,
	}, event.Discard)
	ctx := WithMemoryCompilerClassificationInput(context.Background(), raw)
	if err := a.Run(ctx, expanded); err != nil {
		t.Fatalf("Run: %v", err)
	}

	user := lastUserMessage(t, mp.Requests())
	if !strings.Contains(user.Content, `"source_event":"Referenced context:`) ||
		!strings.Contains(user.Content, `const secret = true`) {
		t.Fatalf("compiled contract dropped resolved reference context:\n%s", user.Content)
	}
	if strings.Contains(user.Content, `"goal":"Referenced context:`) ||
		strings.Contains(user.Content, `"goal":"package main`) {
		t.Fatalf("goal classifier used expanded file content:\n%s", user.Content)
	}
}
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/agent -run TestRunMemoryCompilerClassifiesRawPromptAndPreservesResolvedRefs -count=1
```

Expected: build failure because `WithMemoryCompilerClassificationInput` does not exist.

- [ ] **Step 3: Replace the overloaded source-input context**

In `internal/agent/memory_compiler_context.go`, replace `memoryCompilerSourceInputContextKey`, `WithMemoryCompilerSourceInput`, and `MemoryCompilerSourceInputFromContext` with:

```go
type memoryCompilerClassificationInputContextKey struct{}

// WithMemoryCompilerClassificationInput carries the user's unexpanded text for
// task classification only. The complete Agent.Run input remains the Memory v5
// source_event so resolved file/resource context is not lost.
func WithMemoryCompilerClassificationInput(ctx context.Context, input string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, memoryCompilerClassificationInputContextKey{}, input)
}

func MemoryCompilerClassificationInputFromContext(ctx context.Context) (string, bool) {
	if ctx == nil {
		return "", false
	}
	v, ok := ctx.Value(memoryCompilerClassificationInputContextKey{}).(string)
	if !ok {
		return "", false
	}
	v = strings.TrimSpace(v)
	return v, v != ""
}
```

In `internal/control/turn_orchestrator.go`, change:

```go
ctx = agent.WithMemoryCompilerSourceInput(ctx, turn.raw)
```

to:

```go
ctx = agent.WithMemoryCompilerClassificationInput(ctx, turn.raw)
```

In `internal/agent/agent.go`, use two variables:

```go
sourceEvent := rawInput
classificationInput := rawInput
if raw, ok := MemoryCompilerClassificationInputFromContext(ctx); ok {
	classificationInput = raw
}
```

Use `classificationInput` for `shouldStartMemoryCompiler`, `classifier.IsTask`, and `shouldInjectMemoryCompilerContractForInput`. Pass `sourceEvent` to:

```go
memCompiler.StartTurn(ctx, sourceEvent, a.session.Snapshot())
```

- [ ] **Step 4: Update remaining internal callers and tests**

Run:

```bash
rg -n "WithMemoryCompilerSourceInput|MemoryCompilerSourceInputFromContext" internal
```

Replace each internal test caller that is testing classification with `WithMemoryCompilerClassificationInput`. The command must return no matches afterward.

- [ ] **Step 5: Run focused and package tests**

Run:

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/agent ./internal/memorycompiler ./internal/control -run 'Test(RunMemoryCompilerClassifiesRawPromptAndPreservesResolvedRefs|StripReferencedContextForGoalOnly|ShouldStartMemoryCompiler|ShouldInjectMemoryCompiler)' -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/agent/memory_compiler_context.go internal/agent/agent.go internal/agent/loop_e2e_test.go internal/control/turn_orchestrator.go
git commit -m "fix: preserve document context through memory compiler"
```

---

### Task 2: Add the Bounded Document Extraction Core

**Files:**

- Create: `internal/documentextract/extract.go`
- Create: `internal/documentextract/text.go`
- Create: `internal/documentextract/extract_test.go`

**Interfaces:**

- Produces: `documentextract.ExtractFile(path string, limits Limits) Result`
- Produces: `documentextract.DefaultLimits() Limits`
- Produces: stable statuses `ready`, `truncated`, `ocr_required`, `unsupported`, `failed`.

- [ ] **Step 1: Write failing dispatch and bound tests**

Create `internal/documentextract/extract_test.go` with:

```go
package documentextract

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestExtractPlainTextAndStructuredText(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
		want string
	}{
		{"notes.txt", "课程计划\nECS 150", "ECS 150"},
		{"plan.md", "# Plan\n- ECS 150", "ECS 150"},
		{"courses.csv", "course,units\nECS 150,4\n", "ECS 150"},
		{"profile.json", `{"major":"Computer Science"}`, "Computer Science"},
		{"config.yaml", "college: Engineering\n", "Engineering"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), tc.name)
			if err := os.WriteFile(path, []byte(tc.body), 0o644); err != nil {
				t.Fatal(err)
			}
			got := ExtractFile(path, DefaultLimits())
			if got.Status != StatusReady || !strings.Contains(got.Text, tc.want) {
				t.Fatalf("ExtractFile = %+v", got)
			}
		})
	}
}

func TestExtractTruncatesAtValidUTF8Boundary(t *testing.T) {
	path := filepath.Join(t.TempDir(), "large.txt")
	if err := os.WriteFile(path, []byte(strings.Repeat("课", 100)), 0o644); err != nil {
		t.Fatal(err)
	}
	got := ExtractFile(path, Limits{MaxSourceBytes: 1024, MaxTextBytes: 31})
	if got.Status != StatusTruncated || !got.Truncated {
		t.Fatalf("ExtractFile = %+v, want truncated", got)
	}
	if !utf8.ValidString(got.Text) {
		t.Fatalf("truncated text is invalid UTF-8: %q", got.Text)
	}
}

func TestExtractRejectsOversizedAndUnsupportedFiles(t *testing.T) {
	dir := t.TempDir()
	large := filepath.Join(dir, "large.txt")
	if err := os.WriteFile(large, []byte(strings.Repeat("x", 33)), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := ExtractFile(large, Limits{MaxSourceBytes: 32, MaxTextBytes: 64}); got.Status != StatusFailed || got.Code != "source_too_large" {
		t.Fatalf("oversized = %+v", got)
	}
	zip := filepath.Join(dir, "archive.zip")
	if err := os.WriteFile(zip, []byte("PK\x03\x04"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := ExtractFile(zip, DefaultLimits()); got.Status != StatusUnsupported {
		t.Fatalf("unsupported = %+v", got)
	}
}
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/documentextract -count=1
```

Expected: build failure because the package implementation is missing.

- [ ] **Step 3: Implement public types and dispatch**

Create `internal/documentextract/extract.go` with these public types:

```go
package documentextract

type Status string

const (
	StatusReady       Status = "ready"
	StatusTruncated   Status = "truncated"
	StatusOCRRequired Status = "ocr_required"
	StatusUnsupported Status = "unsupported"
	StatusFailed      Status = "failed"
)

type Limits struct {
	MaxSourceBytes int64
	MaxTextBytes   int
}

type Result struct {
	Format     string `json:"format"`
	Text       string `json:"text,omitempty"`
	Pages      int    `json:"pages,omitempty"`
	Bytes      int64  `json:"bytes"`
	Characters int    `json:"characters"`
	Truncated  bool   `json:"truncated"`
	Status     Status `json:"status"`
	Method     string `json:"method,omitempty"`
	Code       string `json:"code,omitempty"`
	Warning    string `json:"warning,omitempty"`
}

func DefaultLimits() Limits {
	return Limits{MaxSourceBytes: 25 << 20, MaxTextBytes: 512 << 10}
}
```

Implement `ExtractFile` as an extension dispatcher. It must call `os.Stat`, reject non-regular and oversized files, and route plain extensions to `extractPlainText`, `.html/.htm/.xml` to `extractHTML`, `.docx` to `extractDOCX`, `.rtf` to `extractRTF`, and `.pdf` to `extractPDF`. Unknown extensions return `StatusUnsupported`.

- [ ] **Step 4: Implement bounded plain-text decoding**

Create `internal/documentextract/text.go`. Reuse `reasonix/internal/fileenc` for encoding detection and decoding. Add a helper:

```go
func readyText(format, method, text string, size int64, limits Limits) Result
```

It trims a partial UTF-8 suffix at `MaxTextBytes`, sets `Characters` with `utf8.RuneCountInString`, and returns `StatusTruncated` when bounded. A NUL byte in the initial 8 KiB returns `StatusUnsupported` with code `binary_content`.

- [ ] **Step 5: Run tests and format**

Run:

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/documentextract -count=1
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/gofmt -w internal/documentextract/extract.go internal/documentextract/text.go internal/documentextract/extract_test.go
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/documentextract/extract.go internal/documentextract/text.go internal/documentextract/extract_test.go
git commit -m "feat: add bounded document extraction core"
```

---

### Task 3: Add Portable PDF Extraction

**Files:**

- Create: `internal/documentextract/pdf.go`
- Create: `internal/documentextract/pdf_test.go`
- Modify: `go.mod`
- Modify: `go.sum`

**Interfaces:**

- Consumes: `readyText(format, method, text, size, limits) Result`
- Produces: `extractPDF(path string, size int64, limits Limits) Result`

- [ ] **Step 1: Write a generated-text-PDF fixture and failing tests**

Create `internal/documentextract/pdf_test.go`. Include a `writeSimplePDF` helper that builds a one-page PDF with a Helvetica font, an uncompressed `BT ... Tj ET` content stream, and calculated xref offsets. Add:

```go
func TestExtractPDFWithoutHostTools(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	path := filepath.Join(t.TempDir(), "Jin-fixture.pdf")
	writeSimplePDF(t, path, "UC Davis academic plan")

	got := ExtractFile(path, DefaultLimits())
	if got.Status != StatusReady {
		t.Fatalf("ExtractFile = %+v", got)
	}
	if got.Method != "go-pdf" || !strings.Contains(got.Text, "UC Davis academic plan") {
		t.Fatalf("portable extraction missing text: %+v", got)
	}
	if got.Pages != 1 {
		t.Fatalf("pages = %d, want 1", got.Pages)
	}
}

func TestExtractPDFClassifiesNoTextAsOCRRequired(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scan.pdf")
	writeSimpleImageOnlyPDF(t, path)
	got := ExtractFile(path, DefaultLimits())
	if got.Status != StatusOCRRequired || got.Code != "ocr_required" {
		t.Fatalf("ExtractFile = %+v", got)
	}
}

func TestExtractPDFReportsMalformedInput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "broken.pdf")
	if err := os.WriteFile(path, []byte("%PDF-1.7 broken"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := ExtractFile(path, DefaultLimits())
	if got.Status != StatusFailed || got.Code != "pdf_parse_failed" {
		t.Fatalf("ExtractFile = %+v", got)
	}
}
```

The helper must generate fixtures during the test and must not use the user's private PDF.

- [ ] **Step 2: Run the PDF tests and verify RED**

Run:

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/documentextract -run TestExtractPDF -count=1
```

Expected: failure because `extractPDF` is not implemented.

- [ ] **Step 3: Pin the pure-Go PDF dependency**

Run:

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go get github.com/ledongthuc/pdf@v0.0.0-20250511090121-5959a4027728
```

Review `go.mod` and `go.sum`; only the intended module and its required checksums may change.

- [ ] **Step 4: Implement PDF extraction**

Create `internal/documentextract/pdf.go`:

```go
package documentextract

import (
	"bytes"
	"strings"

	pdf "github.com/ledongthuc/pdf"
)

func extractPDF(path string, size int64, limits Limits) Result {
	file, reader, err := pdf.Open(path)
	if err != nil {
		return failed("pdf", size, "pdf_parse_failed", err)
	}
	defer file.Close()

	stream, err := reader.GetPlainText()
	if err != nil {
		return failed("pdf", size, "pdf_extract_failed", err)
	}
	var body bytes.Buffer
	if _, err := body.ReadFrom(stream); err != nil {
		return failed("pdf", size, "pdf_extract_failed", err)
	}
	if strings.TrimSpace(body.String()) == "" {
		return Result{
			Format: "pdf", Pages: reader.NumPage(), Bytes: size,
			Status: StatusOCRRequired, Method: "go-pdf",
			Code: "ocr_required",
			Warning: "No extractable text was found; this PDF may contain scanned images.",
		}
	}
	out := readyText("pdf", "go-pdf", body.String(), size, limits)
	out.Pages = reader.NumPage()
	return out
}
```

The pinned dependency exposes `(*pdf.Reader).NumPage() int` in `page.go`; use that exact method for `Result.Pages`.

- [ ] **Step 5: Verify portable extraction**

Run:

```bash
PATH=/usr/bin:/bin /Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/documentextract -run TestExtractPDFWithoutHostTools -count=1
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/documentextract -count=1
```

Expected: PASS without `pdftotext` or Python packages.

- [ ] **Step 6: Commit**

```bash
git add go.mod go.sum internal/documentextract/pdf.go internal/documentextract/pdf_test.go
git commit -m "feat: extract PDF text in process"
```

---

### Task 4: Add DOCX, RTF, HTML, and XML Extraction

**Files:**

- Create: `internal/documentextract/docx.go`
- Create: `internal/documentextract/docx_test.go`
- Create: `internal/documentextract/rtf.go`
- Create: `internal/documentextract/rtf_test.go`
- Create: `internal/documentextract/html.go`
- Create: `internal/documentextract/html_test.go`

**Interfaces:**

- Consumes: `readyText`
- Produces: local readable text for `.docx`, `.rtf`, `.html`, `.htm`, and `.xml`.

- [ ] **Step 1: Write failing DOCX tests**

Generate a DOCX in `docx_test.go` with `archive/zip` containing:

```xml
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Major: Computer Science</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>ECS 150</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body>
</w:document>
```

Assert the result is `ready`, method `docx-xml`, and contains separate `Major: Computer Science` and `ECS 150` lines. Add a corrupt ZIP case expecting code `docx_parse_failed`.

- [ ] **Step 2: Write failing RTF and HTML tests**

Add cases:

```go
{\rtf1\ansi Academic plan\par ECS 150\tab four units\par Unicode \u35838?}
```

and:

```html
<html><head><title>Ignored</title><script>bad()</script></head>
<body><h1>Degree audit</h1><p>Missing ECS 150</p><a href="/advising">Advising</a></body></html>
```

Assert control words/scripts are absent, paragraph boundaries remain, and visible text is present.

- [ ] **Step 3: Run format tests and verify RED**

Run:

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/documentextract -run 'TestExtract(DOCX|RTF|HTML|XML)' -count=1
```

Expected: failures because the extractors do not exist.

- [ ] **Step 4: Implement DOCX extraction**

Use `archive/zip` and `encoding/xml`. Read only `word/document.xml`, reject a missing document part, emit `w:t` text, newline on `w:p`, and tab between table cells. Apply the shared output bound while streaming so a compressed document cannot expand without limit.

- [ ] **Step 5: Implement RTF extraction**

Implement a bounded state-machine parser covering:

- escaped `\\`, `\{`, and `\}`;
- hex `\'hh`;
- `\par`, `\line`, and `\tab`;
- signed `\uN` Unicode code points and one-character fallback skipping;
- ignorable destinations marked by `\*`;
- brace depth;
- ordinary ANSI/UTF-8 text.

Return `rtf_parse_failed` for unbalanced braces and use `readyText` for final bounding.

- [ ] **Step 6: Implement HTML/XML extraction**

Use `golang.org/x/net/html` for HTML. Skip `script`, `style`, `noscript`, and `template`; insert line breaks around headings, paragraphs, list items, table rows, and `<br>`; normalize repeated whitespace. For XML, use `encoding/xml.Decoder` and emit character data separated by normalized whitespace.

- [ ] **Step 7: Run the full extraction suite**

Run:

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/gofmt -w internal/documentextract
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/documentextract -count=1
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add internal/documentextract/docx.go internal/documentextract/docx_test.go internal/documentextract/rtf.go internal/documentextract/rtf_test.go internal/documentextract/html.go internal/documentextract/html_test.go
git commit -m "feat: read common academic document formats"
```

---

### Task 5: Route Controller References and Desktop Inspection Through the Extractor

**Files:**

- Modify: `internal/control/refs.go`
- Modify: `internal/control/refs_test.go`
- Modify: `desktop/app.go`
- Create: `desktop/document_ingestion_test.go`
- Modify: `desktop/frontend/src/lib/types.ts`
- Modify: `desktop/frontend/src/lib/bridge.ts`

**Interfaces:**

- Produces: `App.InspectDocument(rel string) DocumentExtractionView`
- Consumes: `documentextract.ExtractFile`
- Preserves: `Controller.ResolveRefs` and `Controller.ResolveScopedRefs` signatures.

- [ ] **Step 1: Write a failing controller integration test**

Add to `internal/control/refs_test.go`:

```go
func TestResolveScopedRefsUsesPortableDocumentExtractor(t *testing.T) {
	workspace := t.TempDir()
	path := filepath.Join(workspace, "plan.pdf")
	documentextracttest.WriteSimplePDF(t, path, "Graduation plan: ECS 150")
	t.Setenv("PATH", t.TempDir())

	ctrl := &Controller{workspaceRoot: workspace}
	block, errs := ctrl.ResolveScopedRefs(context.Background(), "review @plan.pdf")
	if len(errs) != 0 {
		t.Fatalf("ResolveScopedRefs errors = %v", errs)
	}
	if !strings.Contains(block, "Graduation plan: ECS 150") ||
		!strings.Contains(block, "method=go-pdf") {
		t.Fatalf("resolved PDF context missing extracted text:\n%s", block)
	}
}
```

Put reusable fixture builders in `internal/documentextract/testutil/testutil.go` if both packages need them.

- [ ] **Step 2: Write failing desktop inspection tests**

Create `desktop/document_ingestion_test.go` with:

```go
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
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/control -run TestResolveScopedRefsUsesPortableDocumentExtractor -count=1
cd desktop
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test . -run TestInspectDocument -count=1
```

Expected: controller expectation fails and desktop build fails because `InspectDocument` does not exist.

- [ ] **Step 4: Replace PDF-specific host extraction in refs**

In `internal/control/refs.go`, route every supported document extension through `documentextract.ExtractFile`. Render results as:

```text
[document extracted; format=pdf; method=go-pdf; pages=1; characters=123]
...bounded text...
```

For `ocr_required`, render a stable note that tells the model not to retry `read_file`, `grep`, task, Python, or shell extraction. For `unsupported`, keep the existing binary note. Delete `findPython`, Python extraction scripts, and command-runner code only after `rg` proves they are PDF-only and all replacement tests pass.

- [ ] **Step 5: Expose desktop document metadata**

Add a desktop JSON view mirroring the extractor result without `Text`:

```go
type DocumentExtractionView struct {
	Format     string `json:"format"`
	Pages      int    `json:"pages,omitempty"`
	Bytes      int64  `json:"bytes"`
	Characters int    `json:"characters"`
	Truncated  bool   `json:"truncated"`
	Status     string `json:"status"`
	Method     string `json:"method,omitempty"`
	Code       string `json:"code,omitempty"`
	Warning    string `json:"warning,omitempty"`
}
```

`InspectDocument` resolves with `workspaceOrExternalPath`, calls `documentextract.ExtractFile`, and never returns extracted text to the UI.

- [ ] **Step 6: Add bridge types**

Add the matching `DocumentExtractionView` interface to `desktop/frontend/src/lib/types.ts`, add:

```ts
InspectDocument(path: string): Promise<DocumentExtractionView>;
```

to `AppBindings`, and add a mock implementation returning:

```ts
{
  format: extensionWithoutDot(path),
  bytes: 0,
  characters: 0,
  truncated: false,
  status: "ready",
  method: "mock",
}
```

- [ ] **Step 7: Run backend verification**

Run:

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/documentextract ./internal/control -count=1
cd desktop
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test . -run 'Test(InspectDocument|AttachDropped)' -count=1
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add internal/control/refs.go internal/control/refs_test.go internal/documentextract/testutil desktop/app.go desktop/document_ingestion_test.go desktop/frontend/src/lib/types.ts desktop/frontend/src/lib/bridge.ts
git commit -m "feat: expose verified document extraction"
```

---

### Task 6: Add the Composer Document Picker and Honest Status Chips

**Files:**

- Modify: `desktop/frontend/src/components/Composer.tsx`
- Modify: `desktop/frontend/src/components/ComposerContextCard.tsx`
- Modify: `desktop/frontend/src/locales/en.ts`
- Modify: `desktop/frontend/src/locales/zh.ts`
- Modify: `desktop/frontend/src/locales/zh-TW.ts`
- Modify: `desktop/frontend/src/styles.css`
- Create: `desktop/frontend/src/__tests__/document-attachment.test.tsx`
- Modify: `desktop/frontend/package.json`

**Interfaces:**

- Consumes: `app.SavePastedFile`, `app.InspectDocument`
- Produces: Add document control and accessible extraction status.
- Preserves: `onSend(displayText, submitText)` and existing `@path` submission.

- [ ] **Step 1: Write the failing frontend interaction test**

Create `document-attachment.test.tsx` following the JSDOM setup in `composer-goal-toggle.test.tsx`. Test:

1. A button with accessible name `Add document` exists.
2. Clicking it clicks a hidden multiple file input whose `accept` includes `.txt,.md,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.rtf,.docx,.pdf`.
3. Selecting `plan.pdf` calls `SavePastedFile`, then `InspectDocument`.
4. While those promises are pending, Send is disabled.
5. A ready result renders `PDF · 1 page · 42 characters`.
6. `ocr_required` renders the localized OCR warning.
7. A failed result renders a failure state and does not use the words “processed” or “ready”.
8. Clicking Send after ready includes `@.reasonix/attachments/plan.pdf` in `submitText`.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
cd desktop/frontend
/opt/homebrew/bin/pnpm exec tsx src/__tests__/document-attachment.test.tsx
```

Expected: FAIL because Add document and extraction statuses do not exist.

- [ ] **Step 3: Extend attachment draft state**

Change the internal `Attachment` interface in `Composer.tsx` to:

```ts
interface Attachment {
  path: string;
  previewUrl?: string;
  displayName?: string;
  document?: DocumentExtractionView;
}
```

Add:

```ts
const DOCUMENT_ACCEPT = ".txt,.md,.markdown,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.rtf,.docx,.pdf";
```

After every non-image `SavePastedFile`, call `InspectDocument(path)` before decrementing `pendingPaste`. Preserve the attachment with a failed result so the user can see and remove it.

- [ ] **Step 4: Add the visible picker**

Import `Paperclip` from `lucide-react`, add `fileInputRef`, and render beside the intent button:

```tsx
<input
  ref={fileInputRef}
  className="composer-document-input"
  type="file"
  accept={DOCUMENT_ACCEPT}
  multiple
  tabIndex={-1}
  aria-hidden="true"
  onChange={(event) => {
    attachFiles(Array.from(event.currentTarget.files ?? []));
    event.currentTarget.value = "";
  }}
/>
<Tooltip label={t("composer.addDocument")}>
  <button
    type="button"
    className="composer-action-trigger"
    onClick={() => fileInputRef.current?.click()}
    disabled={disabled || running}
    aria-label={t("composer.addDocument")}
  >
    <Paperclip size={17} />
  </button>
</Tooltip>
```

- [ ] **Step 5: Render extraction status**

Pass `document` into `ComposerContextCard`. Render localized text for:

- `ready`;
- `truncated`;
- `ocr_required`;
- `failed`;
- page and character counts.

Use `role="status"` for the changing label. Do not render `ready` for failures. Keep image thumbnails unchanged.

- [ ] **Step 6: Add translations and CSS**

Add these keys in all three locale files:

```text
composer.addDocument
composer.documentReady
composer.documentTruncated
composer.documentOCRRequired
composer.documentFailed
composer.documentPages
composer.documentCharacters
```

Hide the native input with a non-layout class and style statuses using existing semantic colors (`--ok`, `--warn`, `--danger`). Do not introduce new z-index values.

- [ ] **Step 7: Add the focused test to scripts**

Add:

```json
"test:documents": "tsx src/__tests__/document-attachment.test.tsx"
```

and include it in `test:pathfinder` and `test:all`.

- [ ] **Step 8: Run frontend tests**

Run:

```bash
cd desktop/frontend
/opt/homebrew/bin/pnpm run test:documents
/opt/homebrew/bin/pnpm run typecheck
/opt/homebrew/bin/pnpm run check:css
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit**

```bash
git add desktop/frontend/src/components/Composer.tsx desktop/frontend/src/components/ComposerContextCard.tsx desktop/frontend/src/locales/en.ts desktop/frontend/src/locales/zh.ts desktop/frontend/src/locales/zh-TW.ts desktop/frontend/src/styles.css desktop/frontend/src/__tests__/document-attachment.test.tsx desktop/frontend/package.json
git commit -m "feat: add document picker and extraction status"
```

---

### Task 7: Run Regression, Production, and Real-Failure Verification

**Files:**

- Modify only if a verification failure demonstrates a document-ingestion regression.

**Interfaces:**

- Verifies every interface produced in Tasks 1–6.

- [ ] **Step 1: Run focused backend suites**

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/documentextract ./internal/control ./internal/agent ./internal/memorycompiler -count=1
cd desktop
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test . -run 'Test(InspectDocument|AttachDropped|History.*)' -count=1
```

Expected: PASS.

- [ ] **Step 2: Run Pathfinder frontend suites**

```bash
cd desktop/frontend
/opt/homebrew/bin/pnpm run test:documents
/opt/homebrew/bin/pnpm run test:pathfinder
/opt/homebrew/bin/pnpm run typecheck
/opt/homebrew/bin/pnpm run check:css
/opt/homebrew/bin/pnpm run build
```

Expected: PASS and production build exits 0.

- [ ] **Step 3: Reproduce the original Memory v5 path without private content**

Run the E2E test with `PATH` restricted:

```bash
PATH=/usr/bin:/bin /Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/agent ./internal/control ./internal/documentextract -run 'Test(RunMemoryCompilerClassifiesRawPromptAndPreservesResolvedRefs|ResolveScopedRefsUsesPortableDocumentExtractor|ExtractPDFWithoutHostTools)' -count=1
```

Expected: PASS.

- [ ] **Step 4: Perform a local, non-committing smoke extraction of the reported file**

If the file still exists, run a temporary Go test or small program outside the repository against:

```text
/Users/richis/Documents/RMP咨询APP/reports/.reasonix/attachments/clipboard-20260723-204905.975838-000002.pdf
```

Record only status, method, page count, character count, and truncation. Do not print its text into logs and do not add the file to Git. Expected: `ready` with method `go-pdf`, or an honest `ocr_required`/parse error that matches the actual document.

- [ ] **Step 5: Run Wails production build**

```bash
cd desktop
PATH="/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin:/Users/richis/go/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin" /Users/richis/go/bin/wails build -platform darwin/arm64 -clean
```

Expected: build exits 0 and the application bundle is produced.

- [ ] **Step 6: Inspect the final diff**

```bash
git status --short
git diff --stat HEAD~6..HEAD
git diff --check HEAD~6..HEAD
```

Verify that no private PDFs, attachment contents, unrelated dirty files, Python environment, or `pdftotext` binary were added.

---

## Plan Self-Review

- Spec coverage: Memory v5 context preservation, local PDF extraction, common text/DOCX/RTF/HTML support, visible Add document control, extraction status, bounds, privacy, OCR-required behavior, regression, and packaged-build validation are covered.
- Placeholder scan completed; every step names its target, command, expected result, and error behavior.
- Type consistency: `DocumentExtractionView` mirrors `documentextract.Result` excluding `Text`; statuses are identical across Go and TypeScript.
- Scope boundary: OCR, governance SOPs, risk approvals, handoff packets, and dynamic recommendations remain in their subsequent implementation plans.
