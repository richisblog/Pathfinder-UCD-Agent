# Pathfinder Schedule Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a separately packaged Chrome extension and a paired Pathfinder desktop bridge that let the academic agent perform on-demand, read-only, current UC Davis course queries through a user-authenticated browser session.

**Architecture:** A Manifest V3 extension connects to a loopback-only WebSocket server owned by Pathfinder. The desktop tool sends versioned course requests; the extension serializes them through a one-concurrency queue, executes only allowlisted read operations in a supported UC Davis page context, normalizes the evidence, and returns it with source and freshness metadata. Browser authentication stays inside Chrome, while personal academic context is protected by session-scoped desktop consent.

**Tech Stack:** Go 1.26.4, Gorilla WebSocket, Wails v2.12, React 19, TypeScript 6, Vite 8, Chrome Manifest V3, Vitest, JSON Schema-style manual validators.

## Global Constraints

- Create the extension only under `extensions/pathfinder-schedule-bridge/`; do not merge it into `desktop/frontend/`.
- Bind the bridge only to `127.0.0.1`; never expose a LAN listener.
- The provider interface has no arbitrary URL, headers, JavaScript, or request-body escape hatch.
- Registration, add, drop, swap, save-schedule, and preference mutations are denied before page execution.
- Concurrency is exactly one provider request; all Sections for one course are merged before advancing to the next course.
- There is no fixed eight-course product cutoff.
- Use a minimum request interval plus bounded load-smoothing jitter; do not spoof identity or bypass site controls.
- Retain public course data for 30 minutes, but label seat/waitlist evidence live for only 60 seconds.
- Keep personal schedule, pass-time, hold, and personal-waitlist evidence in memory for at most five minutes and only after per-session consent.
- Never transmit passwords, cookies, session IDs, CSRF tokens, raw HTML, or complete raw API responses to Pathfinder.
- Fail closed with `SITE_VERSION_UNSUPPORTED` when the audited Schedule Builder contract changes.
- Preserve unrelated dirty worktree changes and stage only task-owned hunks.

---

## File map

### Extension

- `extensions/pathfinder-schedule-bridge/manifest.json`: permissions, service worker, popup, and approved UC Davis host declarations.
- `extensions/pathfinder-schedule-bridge/package.json`: local build/test scripts and dependencies.
- `extensions/pathfinder-schedule-bridge/src/protocol/messages.ts`: protocol envelopes, methods, statuses, and evidence types.
- `extensions/pathfinder-schedule-bridge/src/protocol/validate.ts`: fail-closed runtime validation.
- `extensions/pathfinder-schedule-bridge/src/background/bridge-client.ts`: loopback discovery, pairing, reconnect, authenticated request routing.
- `extensions/pathfinder-schedule-bridge/src/background/query-queue.ts`: one-concurrency pacing, progress, retry, and cancellation.
- `extensions/pathfinder-schedule-bridge/src/background/cache.ts`: public and in-memory personal cache semantics.
- `extensions/pathfinder-schedule-bridge/src/content/page-status.ts`: supported-tab and login readiness detection.
- `extensions/pathfinder-schedule-bridge/src/content/schedule-builder-adapter.ts`: typed provider boundary.
- `extensions/pathfinder-schedule-bridge/src/page/main-world-api.ts`: audited same-origin read calls only.
- `extensions/pathfinder-schedule-bridge/src/normalize/schedule.ts`: raw-to-normalized evidence conversion.
- `extensions/pathfinder-schedule-bridge/src/popup/*`: pairing and status UI.
- `extensions/pathfinder-schedule-bridge/scripts/sanitize-har.mjs`: reject sensitive HAR material and build sanitized adapter fixtures.
- `extensions/pathfinder-schedule-bridge/tests/*`: protocol, transport, policy, queue, cache, adapter, and normalizer tests.

### Pathfinder core and desktop

- `internal/campus/livebridge/protocol/*`: Go protocol messages and validation.
- `internal/campus/livebridge/cache/*`: freshness-aware public cache and memory-only personal cache.
- `internal/campus/livebridge/server/*`: loopback listener, WebSocket, pairing, auth, request correlation, status, and cancellation.
- `internal/campus/livebridge/client.go`: typed `Client` interface consumed by campus tools.
- `internal/campus/native/live_schedule_tool.go`: provider-visible `query_live_schedule` implementation.
- `internal/campus/native/tools.go`: optional live tool registration and prompt guidance.
- `internal/boot/boot.go`: inject the desktop-owned live client into every controller.
- `desktop/schedule_bridge_app.go`: Wails status, pairing, consent, open-browser, event emission, startup, and shutdown integration.
- `desktop/app.go`: own one bridge server and pass its client through `boot.Options`.
- `desktop/frontend/src/components/ScheduleBridgeBanner.tsx`: browser/login/consent/progress UI.
- `desktop/frontend/src/lib/bridge.ts`: Wails bridge methods and event bindings.
- `desktop/frontend/src/App.tsx`: mount the bridge banner without replacing the Reasonix layout.
- `desktop/frontend/src/locales/{en,zh,zh-TW}.ts`: user-facing copy.

---

### Task 1: Scaffold the independent Manifest V3 extension and protocol

**Files:**
- Create: `extensions/pathfinder-schedule-bridge/package.json`
- Create: `extensions/pathfinder-schedule-bridge/tsconfig.json`
- Create: `extensions/pathfinder-schedule-bridge/vite.config.ts`
- Create: `extensions/pathfinder-schedule-bridge/manifest.json`
- Create: `extensions/pathfinder-schedule-bridge/src/protocol/messages.ts`
- Create: `extensions/pathfinder-schedule-bridge/src/protocol/validate.ts`
- Create: `extensions/pathfinder-schedule-bridge/tests/protocol.test.ts`

**Interfaces:**
- Produces: `BridgeRequest`, `BridgeResult`, `BridgeStatus`, `validateIncomingRequest(value)`, and protocol constant `PROTOCOL_VERSION = 1`.
- Consumes: no project code.

- [ ] **Step 1: Write protocol tests that reject unknown methods and accept course search**

```ts
import { describe, expect, it } from "vitest";
import { validateIncomingRequest } from "../src/protocol/validate";

describe("validateIncomingRequest", () => {
  it("accepts a version-one schedule search", () => {
    expect(validateIncomingRequest({
      protocol: 1,
      id: "req_01JABCDEF0123456789",
      type: "request",
      method: "schedule.search",
      params: { term: "2026-fall", courses: ["ECS 036A"] },
    }).method).toBe("schedule.search");
  });

  it("rejects an arbitrary URL method", () => {
    expect(() => validateIncomingRequest({
      protocol: 1,
      id: "req_01JABCDEF0123456789",
      type: "request",
      method: "fetch",
      params: { url: "https://example.com" },
    })).toThrow(/unknown method/i);
  });
});
```

- [ ] **Step 2: Run the protocol test and verify the red state**

Run:

```sh
cd extensions/pathfinder-schedule-bridge
pnpm install
pnpm vitest run tests/protocol.test.ts
```

Expected: FAIL because `messages.ts` and `validate.ts` do not exist.

- [ ] **Step 3: Add the extension manifest and build configuration**

Use a Manifest V3 service worker, popup, `storage` and `scripting` permissions, and host permissions restricted to `https://my.ucdavis.edu/*`, `https://registrar-apps.ucdavis.edu/*`, and `http://127.0.0.1/*`. Chrome match patterns do not accept `ws` as a scheme, so do not add a `ws://` host permission; the service worker connects only to the compile-time `ws://127.0.0.1:<allowed-port>/v1/bridge` URLs, and the desktop server validates the extension Origin. Set the minimum Chrome version to `116` so active WebSockets extend service-worker lifetime.

`package.json` scripts must be exactly:

```json
{
  "scripts": {
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "verify": "pnpm typecheck && pnpm test && pnpm build"
  }
}
```

- [ ] **Step 4: Implement versioned types and fail-closed validation**

Define only these model-callable methods:

```ts
export const PROTOCOL_VERSION = 1 as const;
export type BridgeMethod =
  | "bridge.status"
  | "schedule.terms"
  | "schedule.search"
  | "schedule.personal"
  | "request.cancel";

export type BridgeStatus =
  | "OK" | "PARTIAL" | "BROWSER_REQUIRED" | "EXTENSION_REQUIRED"
  | "PAIRING_REQUIRED" | "LOGIN_REQUIRED" | "CONSENT_REQUIRED"
  | "RATE_LIMITED" | "SITE_VERSION_UNSUPPORTED" | "INVALID_REQUEST"
  | "CANCELLED" | "INTERNAL_ERROR";
```

`validateIncomingRequest` must reject unsupported protocol versions, IDs outside `[A-Za-z0-9_-]{8,80}`, unknown properties that could carry a URL/header/body, empty course arrays, course strings longer than 32 characters, and more than 100 queued courses as a memory-safety bound rather than a product cutoff.

- [ ] **Step 5: Run extension protocol verification**

Run: `pnpm typecheck && pnpm vitest run tests/protocol.test.ts`  
Expected: PASS with two tests.

- [ ] **Step 6: Commit the extension foundation**

```sh
git add extensions/pathfinder-schedule-bridge
git commit -m "feat(extension): scaffold Pathfinder schedule bridge"
```

---

### Task 2: Implement the Go protocol and freshness caches

**Files:**
- Create: `internal/campus/livebridge/protocol/messages.go`
- Create: `internal/campus/livebridge/protocol/validate.go`
- Create: `internal/campus/livebridge/protocol/protocol_test.go`
- Create: `internal/campus/livebridge/cache/cache.go`
- Create: `internal/campus/livebridge/cache/cache_test.go`

**Interfaces:**
- Produces: `protocol.Request`, `protocol.Result`, `protocol.ValidateRequest`, `cache.Store`, and `cache.Entry`.
- Consumes: the wire names fixed in Task 1.

- [ ] **Step 1: Write failing Go tests for protocol parity and cache freshness**

```go
func TestValidateRequestRejectsArbitraryMethod(t *testing.T) {
    req := Request{Protocol: 1, ID: "req_01JABCDEF", Type: "request", Method: "fetch"}
    if err := ValidateRequest(req); err == nil {
        t.Fatal("expected unknown method rejection")
    }
}

func TestSeatEntryRetainedButNotLiveAfterSixtySeconds(t *testing.T) {
    now := time.Date(2026, 7, 16, 9, 0, 0, 0, time.UTC)
    store := New(func() time.Time { return now })
    store.PutPublic("seat:ECS036A", []byte(`{"open":4}`), PublicSeatPolicy)
    now = now.Add(61 * time.Second)
    entry, ok := store.GetPublic("seat:ECS036A")
    if !ok || entry.Live { t.Fatalf("entry=%+v ok=%v", entry, ok) }
}
```

- [ ] **Step 2: Run the Go tests and verify the red state**

Run: `go test ./internal/campus/livebridge/protocol ./internal/campus/livebridge/cache`  
Expected: FAIL because the packages do not exist.

- [ ] **Step 3: Implement Go message types and validation**

Use explicit structs and `json.RawMessage`; do not decode parameters into `map[string]any` in the server. Mirror Task 1 method and status constants. Reject encoded messages above 1 MiB and reject unknown methods before decoding method parameters.

- [ ] **Step 4: Implement cache policies**

Expose these policies:

```go
var (
    PublicStructurePolicy = Policy{Retention: 30 * time.Minute, LiveFor: 30 * time.Minute}
    PublicSeatPolicy      = Policy{Retention: 30 * time.Minute, LiveFor: 60 * time.Second}
    PersonalPolicy        = Policy{Retention: 5 * time.Minute, LiveFor: 5 * time.Minute, MemoryOnly: true}
)
```

`Store.ClearPersonal(sessionID)` must delete every personal entry for the session. Public keys include provider, term, normalized course, and field category.

- [ ] **Step 5: Run the focused Go tests**

Run: `go test ./internal/campus/livebridge/protocol ./internal/campus/livebridge/cache`  
Expected: PASS.

- [ ] **Step 6: Commit protocol and cache**

```sh
git add internal/campus/livebridge/protocol internal/campus/livebridge/cache
git commit -m "feat(campus): add live schedule protocol and cache"
```

---

### Task 3: Build the loopback server, pairing, authentication, and request correlation

**Files:**
- Modify: `go.mod`
- Modify: `go.sum`
- Create: `internal/campus/livebridge/client.go`
- Create: `internal/campus/livebridge/server/server.go`
- Create: `internal/campus/livebridge/server/pairing.go`
- Create: `internal/campus/livebridge/server/session.go`
- Create: `internal/campus/livebridge/server/server_test.go`
- Create: `internal/campus/livebridge/server/pairing_test.go`

**Interfaces:**
- Consumes: `protocol.Request`, `protocol.Result`, and `protocol.ValidateRequest` from Task 2.
- Produces:

```go
type Client interface {
    Status(context.Context) (Status, error)
    Search(context.Context, SearchRequest) (protocol.Result, error)
    Personal(context.Context, PersonalRequest) (protocol.Result, error)
    Cancel(context.Context, string) error
}
```

- [ ] **Step 1: Write failing loopback and pairing tests**

Tests must prove:

```go
func TestServerBindsLoopbackOnly(t *testing.T) {
    srv := New(Options{Ports: []int{0}})
    require.NoError(t, srv.Start(context.Background()))
    t.Cleanup(func() { _ = srv.Close() })
    host, _, _ := net.SplitHostPort(srv.Addr().String())
    if host != "127.0.0.1" { t.Fatalf("host=%q", host) }
}

func TestPairingCodeExpiresAndCanOnlySucceedOnce(t *testing.T) {
    clock := newFakeClock()
    p := newPairingManager(clock.Now)
    challenge := p.Issue()
    if _, err := p.Exchange(challenge.Code, "extension-id"); err != nil { t.Fatal(err) }
    if _, err := p.Exchange(challenge.Code, "extension-id"); err == nil { t.Fatal("reused code") }
}
```

Also cover invalid Origin, invalid bearer token, duplicate request ID, one-megabyte limit, disconnect, cancellation, and recoverable status delivery.

- [ ] **Step 2: Run server tests and verify the red state**

Run: `go test ./internal/campus/livebridge/server`  
Expected: FAIL because the server package does not exist.

- [ ] **Step 3: Make Gorilla WebSocket a direct dependency and implement the listener**

Promote `github.com/gorilla/websocket` to a direct root-module dependency. `Start` must try the configured fixed primary port followed by the deterministic fallback list, each on `127.0.0.1`. Test mode may pass port `0`.

The upgrader checks an injected exact extension-origin allowlist. Before pairing, only `hello` and `pair.exchange` messages are accepted. After pairing, every connection authenticates with the stored random credential.

- [ ] **Step 4: Implement correlation and the typed client**

Maintain `pending map[string]chan protocol.Result` under a mutex. Reject duplicate active IDs. `Search` sends one request and blocks on result, caller context, or server close. Recoverable browser/login/consent states are sent to a status callback and keep the pending request available for a bounded resume window; they are not converted into fabricated evidence.

- [ ] **Step 5: Run race-enabled server tests**

Run: `go test -race ./internal/campus/livebridge/server ./internal/campus/livebridge/protocol`  
Expected: PASS with no race report.

- [ ] **Step 6: Commit the loopback bridge**

```sh
git add go.mod go.sum internal/campus/livebridge
git commit -m "feat(campus): add paired loopback schedule bridge"
```

---

### Task 4: Implement extension connection, pairing popup, and reconnect

**Files:**
- Create: `extensions/pathfinder-schedule-bridge/src/background/bridge-client.ts`
- Create: `extensions/pathfinder-schedule-bridge/src/background/index.ts`
- Create: `extensions/pathfinder-schedule-bridge/src/popup/index.html`
- Create: `extensions/pathfinder-schedule-bridge/src/popup/popup.ts`
- Create: `extensions/pathfinder-schedule-bridge/src/popup/popup.css`
- Create: `extensions/pathfinder-schedule-bridge/tests/bridge-client.test.ts`

**Interfaces:**
- Consumes: Task 1 protocol and Task 3 handshake.
- Produces: `BridgeClient.connect()`, `BridgeClient.pair(code)`, status events, and authenticated request events for Task 5.

- [ ] **Step 1: Write failing transport tests with a fake WebSocket**

```ts
it("tries only configured loopback ports and authenticates after pairing", async () => {
  const sockets = new FakeSocketFactory();
  const store = new MemoryCredentialStore();
  const client = new BridgeClient({ ports: [38673, 38674], sockets, store });
  sockets.accept(38674, { protocol: 1, type: "hello", status: "PAIRING_REQUIRED" });
  await client.connect();
  await client.pair("123456");
  expect(store.value).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  expect(sockets.openedHosts).toEqual(["127.0.0.1", "127.0.0.1"]);
});
```

Add tests for exponential reconnect, credential revocation, incompatible protocol, and never placing the token in a URL.

- [ ] **Step 2: Run the tests and verify the red state**

Run: `pnpm vitest run tests/bridge-client.test.ts`  
Expected: FAIL because `BridgeClient` does not exist.

- [ ] **Step 3: Implement discovery and authenticated messaging**

Connect only to `ws://127.0.0.1:<allowed-port>/v1/bridge`. Send tokens inside the first authenticated message, never query parameters. Cap reconnect delay and reset it after a stable connection. Validate every server message before dispatch.

- [ ] **Step 4: Implement the popup**

The popup has exactly these states: App not found, Pairing required, Connecting, Connected, Browser login required, Ready, Incompatible version. The pairing input accepts six digits and gives a user-readable error without logging the code.

- [ ] **Step 5: Run extension transport verification**

Run: `pnpm typecheck && pnpm vitest run tests/protocol.test.ts tests/bridge-client.test.ts && pnpm build`  
Expected: PASS and a loadable `dist/manifest.json`.

- [ ] **Step 6: Commit extension transport**

```sh
git add extensions/pathfinder-schedule-bridge
git commit -m "feat(extension): pair with Pathfinder desktop"
```

---

### Task 5: Add the one-concurrency queue, pacing, cache, and read-only provider policy

**Files:**
- Create: `extensions/pathfinder-schedule-bridge/src/background/query-queue.ts`
- Create: `extensions/pathfinder-schedule-bridge/src/background/cache.ts`
- Create: `extensions/pathfinder-schedule-bridge/src/content/schedule-builder-adapter.ts`
- Create: `extensions/pathfinder-schedule-bridge/src/page/main-world-api.ts`
- Create: `extensions/pathfinder-schedule-bridge/tests/queue.test.ts`
- Create: `extensions/pathfinder-schedule-bridge/tests/cache.test.ts`
- Create: `extensions/pathfinder-schedule-bridge/tests/readonly-policy.test.ts`

**Interfaces:**
- Consumes: authenticated `BridgeRequest` events from Task 4.
- Produces: `QueryQueue.enqueue(request)`, `ScheduleProvider`, `ReadOperation`, and sanitized provider results for Task 6.

- [ ] **Step 1: Write failing queue and policy tests**

Use a fake clock to prove one concurrency, no eight-course truncation, minimum delay, bounded jitter, cancellation, `Retry-After`, and retry cap. Add exact denied operations:

```ts
for (const operation of ["register", "drop", "swap", "saveSchedule", "updatePreferences"]) {
  it(`denies ${operation} before page execution`, async () => {
    const page = new RecordingPageExecutor();
    await expect(router.execute({ operation } as never, page)).rejects.toThrow(/read-only/i);
    expect(page.calls).toHaveLength(0);
  });
}
```

- [ ] **Step 2: Run focused tests and verify the red state**

Run: `pnpm vitest run tests/queue.test.ts tests/cache.test.ts tests/readonly-policy.test.ts`  
Expected: FAIL because queue, cache, and provider policy do not exist.

- [ ] **Step 3: Implement the queue and pacing policy**

The queue unit is one normalized course. Set concurrency to one. Use an injected clock and random source; calculate `minimumDelayMs + boundedJitterMs`, with defaults 3000 and 2000. The random source exists only for load smoothing and is not configurable by the model. Expose progress after each completed course and page.

When a course has multiple provider pages, fetch pages sequentially and merge them before marking that course complete. Do not insert the inter-course delay between pages when the provider contract defines pagination as one logical query, but still honor server throttling.

- [ ] **Step 4: Implement cache semantics**

Public structure and seats share a 30-minute retention entry but carry separate `structureLiveUntil` and `availabilityLiveUntil`. Personal entries live only in the service worker's memory map for five minutes and clear on disconnect, session-end message, or consent revocation.

- [ ] **Step 5: Implement the semantic read allowlist**

Define a closed union:

```ts
export type ReadOperation =
  | { kind: "terms" }
  | { kind: "courseSearch"; term: string; course: string; page?: string }
  | { kind: "personalSchedule"; term: string }
  | { kind: "passTimes"; term: string }
  | { kind: "holds" }
  | { kind: "personalWaitlist"; term: string };
```

The main-world executor accepts only a `ReadOperation` and an adapter-owned endpoint descriptor. It never accepts an arbitrary URL, method, header map, body, or JavaScript source from a bridge message.

- [ ] **Step 6: Run extension policy verification**

Run: `pnpm typecheck && pnpm vitest run tests/queue.test.ts tests/cache.test.ts tests/readonly-policy.test.ts`  
Expected: PASS.

- [ ] **Step 7: Commit queue and read-only boundary**

```sh
git add extensions/pathfinder-schedule-bridge
git commit -m "feat(extension): enforce paced read-only schedule queries"
```

---

### Task 6: Audit and implement UC Davis live providers and normalized evidence

**Files:**
- Create: `extensions/pathfinder-schedule-bridge/scripts/sanitize-har.mjs`
- Create: `extensions/pathfinder-schedule-bridge/src/content/page-status.ts`
- Create: `extensions/pathfinder-schedule-bridge/src/content/providers/class-search.ts`
- Create: `extensions/pathfinder-schedule-bridge/src/content/providers/schedule-builder.ts`
- Create: `extensions/pathfinder-schedule-bridge/src/normalize/schedule.ts`
- Create: `extensions/pathfinder-schedule-bridge/tests/fixtures/class-search/*.json`
- Create after audit: `extensions/pathfinder-schedule-bridge/tests/fixtures/schedule-builder/*.json`
- Create: `extensions/pathfinder-schedule-bridge/tests/providers.test.ts`
- Create: `extensions/pathfinder-schedule-bridge/tests/normalize.test.ts`

**Interfaces:**
- Consumes: `ReadOperation` and `ScheduleProvider` from Task 5.
- Produces: `NormalizedCourseEvidence`, `NormalizedPersonalContext`, and provider version strings.

- [ ] **Step 1: Implement and test the public official Class Search provider**

Capture only public, non-personal official responses from `registrar-apps.ucdavis.edu`. Add fixtures for zero, one, and thirty Sections. The provider must return course code, term, CRN, Section, instructor, meetings, seats, waitlist, restrictions, notes, and cancelled state when those fields exist.

Run: `pnpm vitest run tests/providers.test.ts tests/normalize.test.ts`  
Expected before implementation: FAIL; after implementation: PASS.

- [ ] **Step 2: Add a fail-closed HAR sanitizer before inspecting authenticated traffic**

The sanitizer reads a HAR outside the repository and refuses output when request/response content contains cookie, authorization, CSRF, student ID, login ID, email, or passphrase-shaped keys. It emits only endpoint path templates, HTTP method, non-sensitive request field names, response field shapes, pagination metadata, and manually supplied synthetic course values.

Run:

```sh
pnpm audit:fixture --input /tmp/pathfinder-schedule-audit.har --output tests/fixtures/schedule-builder/audited-contract.json
```

Expected: either a sanitized fixture with no secret values or a non-zero exit naming the sensitive key categories that must be removed before retrying.

- [ ] **Step 3: Perform the authenticated read-contract audit with user-controlled login**

The user opens Schedule Builder and completes Kerberos/MFA themselves. In Chrome DevTools Network, record only these manual read actions: list terms, search one course with many Sections, open course details, view personal schedule, view pass time, view holds, and view personal waitlist. Do not click registration, add, drop, swap, save, or preference actions.

Save the HAR to `/tmp/pathfinder-schedule-audit.har`, run the sanitizer, inspect the generated fixture for identifiers, and delete the raw HAR after the sanitized fixture is accepted. This step requires the user-authenticated page and must not be simulated with stolen cookies.

- [ ] **Step 4: Write red adapter contract tests from the sanitized fixture**

Tests assert exact approved host/path/method combinations, reconstructed request fields, login-redirect detection, pagination, and response-shape validation. Add a mutated fixture with a renamed required Section field and expect `SITE_VERSION_UNSUPPORTED`.

- [ ] **Step 5: Implement the authenticated Schedule Builder provider**

Encode audited endpoint descriptors as constants inside `providers/schedule-builder.ts`. Reconstruct requests solely from normalized term/course/personal categories. Execute with same-origin browser authentication, sanitize immediately, and return normalized types. Unknown redirects, paths, fields, or response variants fail closed.

- [ ] **Step 6: Verify providers and scan fixtures for sensitive material**

Run:

```sh
pnpm vitest run tests/providers.test.ts tests/normalize.test.ts tests/readonly-policy.test.ts
rg -ni "cookie|authorization|csrf|passphrase|student.?id|login.?id|@ucdavis\.edu" tests/fixtures
```

Expected: tests PASS and the scan has no sensitive values; schema-key mentions in sanitizer rejection fixtures must use synthetic names only.

- [ ] **Step 7: Commit providers and sanitized fixtures**

```sh
git add extensions/pathfinder-schedule-bridge
git commit -m "feat(extension): query live UC Davis schedule data"
```

---

### Task 7: Register `query_live_schedule` and inject the desktop bridge into boot

**Files:**
- Create: `internal/campus/native/live_schedule_tool.go`
- Create: `internal/campus/native/live_schedule_tool_test.go`
- Modify: `internal/campus/native/tools.go`
- Modify: `internal/campus/native/tools_test.go`
- Modify: `internal/boot/boot.go`
- Modify: `internal/boot/boot_test.go`

**Interfaces:**
- Consumes: `livebridge.Client` from Task 3.
- Produces: `campusnative.WithLiveSchedule(client)`, tool name `query_live_schedule`, and `boot.Options.LiveScheduleClient`.

- [ ] **Step 1: Write failing tool and boot tests**

```go
func TestLiveScheduleToolIsReadOnlyAndReturnsRecoverableLoginState(t *testing.T) {
    client := &fakeLiveClient{result: protocol.Result{Status: protocol.LoginRequired}}
    tool := newLiveScheduleTool(client)
    if !tool.ReadOnly() || !tool.PlanModeSafe() { t.Fatal("live schedule tool must be read-only and plan-safe") }
    got, err := tool.Execute(context.Background(), json.RawMessage(`{"term":"2026-fall","courses":["ECS 036A"]}`))
    if err != nil || !strings.Contains(got, "LOGIN_REQUIRED") { t.Fatalf("got=%q err=%v", got, err) }
}
```

Boot tests pass a fake client and assert the tool schema includes term, courses, and `include_personal_context`, and that the progress-read evidence list contains `query_live_schedule`.

- [ ] **Step 2: Run focused tests and verify the red state**

Run:

```sh
go test ./internal/campus/native -run LiveSchedule
go test ./internal/boot -run LiveSchedule
```

Expected: FAIL because the option and tool do not exist.

- [ ] **Step 3: Implement the live tool**

The schema accepts a term, one or more course identifiers, and an optional personal-context flag. Validate and normalize inputs before calling the client. Return structured JSON containing status, progress, evidence, stale markers, and recoverable action. Do not convert recoverable statuses into ordinary errors because the agent needs to plan around them.

- [ ] **Step 4: Add optional registration and prompt policy**

Change `campusnative.Tools` to accept functional options without breaking callers:

```go
func Tools(paths tools.Paths, opts ...Option) []tool.Tool
func DataToolNames(paths tools.Paths, opts ...Option) []string
func WithLiveSchedule(client livebridge.Client) Option
```

Register the live tool when a client is non-nil even if local campus data is absent. Add prompt text that prefers live evidence for current term offerings, seats, waitlists, personal schedule, pass time, and holds, while using local data for stable catalog/policy context.

- [ ] **Step 5: Inject the client through boot**

Add `LiveScheduleClient livebridge.Client` to `boot.Options`, pass it into tool options, enable the Pathfinder prompt when either local campus data or the live client exists, and include the live tool in progress evidence gating.

- [ ] **Step 6: Run focused backend tests**

Run:

```sh
go test ./internal/campus/native -run 'LiveSchedule|SystemPrompt'
go test ./internal/boot -run 'LiveSchedule|Pathfinder'
```

Expected: PASS.

- [ ] **Step 7: Commit agent integration**

```sh
git add internal/campus/native internal/boot
git commit -m "feat(campus): add live schedule consultation tool"
```

---

### Task 8: Own the server in Wails and add pairing, consent, login, and progress UI

**Files:**
- Create: `desktop/schedule_bridge_app.go`
- Create: `desktop/schedule_bridge_app_test.go`
- Modify: `desktop/app.go`
- Modify only the boot-call hunks in: `desktop/tabs.go`, `desktop/settings_app.go`, `desktop/app.go`
- Create: `desktop/frontend/src/components/ScheduleBridgeBanner.tsx`
- Create: `desktop/frontend/src/components/ScheduleBridgeBanner.test.tsx`
- Modify: `desktop/frontend/src/lib/bridge.ts`
- Modify: `desktop/frontend/src/App.tsx`
- Modify: `desktop/frontend/src/locales/en.ts`
- Modify: `desktop/frontend/src/locales/zh.ts`
- Modify: `desktop/frontend/src/locales/zh-TW.ts`

**Interfaces:**
- Consumes: server/client and status callback from Task 3; `boot.Options.LiveScheduleClient` from Task 7.
- Produces Wails methods: `ScheduleBridgeStatus`, `ScheduleBridgeIssuePairingCode`, `ScheduleBridgeRevokePairing`, `ScheduleBridgeOpenBrowser`, `ScheduleBridgeSetConsent`, and event `schedule-bridge:status`.

- [ ] **Step 1: Write failing desktop lifecycle and consent tests**

Tests assert the bridge starts once, binds loopback, closes on shutdown, every tab boot receives the same client, pairing code is short-lived, personal consent is session-scoped, revocation clears personal cache, and the open-browser URL is exactly the official Schedule Builder URL.

- [ ] **Step 2: Run focused desktop Go tests and verify the red state**

Run: `go test ./desktop -run ScheduleBridge`  
Expected: FAIL because the Wails surface does not exist.

- [ ] **Step 3: Implement desktop lifecycle and bound methods**

Add one `scheduleBridge *livebridgeserver.Server` to `App`. Start it during `startup` before tab controller builds, emit status events through `runtime.EventsEmit`, and close it before shared hosts during `shutdown`. Pass the same `Client()` into every `boot.Build` call. `ScheduleBridgeOpenBrowser` uses Wails `BrowserOpenURL` with a compile-time constant, not user input.

- [ ] **Step 4: Write the frontend component test**

Cover states: not installed, pairing, browser required, login required, consent required, querying `n/m`, ready, rate-limited, and site update required. Assert the consent copy mentions the configured model provider and that Cancel invokes the request-cancel method.

- [ ] **Step 5: Implement the banner and translations**

Mount a compact banner above the existing composer only while action is required or a live query is running. Keep the current Reasonix client layout. Buttons are Open Schedule Builder, Check again, Pair extension, Allow this session, Not now, Cancel, and Update required. Do not display personal evidence in the banner.

- [ ] **Step 6: Run frontend and desktop verification**

Run:

```sh
go test ./desktop -run ScheduleBridge
pnpm --dir desktop/frontend test -- ScheduleBridgeBanner
pnpm --dir desktop/frontend run build
```

Expected: focused tests PASS and production frontend build exits zero.

- [ ] **Step 7: Commit desktop integration**

Stage only owned hunks because these files contain pre-existing user changes:

```sh
git add desktop/schedule_bridge_app.go desktop/schedule_bridge_app_test.go desktop/frontend/src/components/ScheduleBridgeBanner.tsx desktop/frontend/src/components/ScheduleBridgeBanner.test.tsx
git add -p desktop/app.go desktop/tabs.go desktop/settings_app.go desktop/frontend/src/lib/bridge.ts desktop/frontend/src/App.tsx desktop/frontend/src/locales/en.ts desktop/frontend/src/locales/zh.ts desktop/frontend/src/locales/zh-TW.ts
git commit -m "feat(desktop): guide live schedule bridge sessions"
```

---

### Task 9: End-to-end recovery, privacy audit, documentation, and packaged smoke test

**Files:**
- Create: `internal/campus/livebridge/e2e_test.go`
- Create: `extensions/pathfinder-schedule-bridge/README.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified install/test documentation and pilot-ready build evidence.

- [ ] **Step 1: Add the end-to-end fake-extension test**

The test starts the real loopback server, pairs a fake extension, sends a search, returns `LOGIN_REQUIRED`, marks the fake page ready, resumes the same request ID, streams two course progress events, returns thirty Sections for one course, and verifies the agent tool receives one normalized result without duplicate requests.

Add a second case that requests personal context, blocks at `CONSENT_REQUIRED`, grants session consent, succeeds, revokes consent, and proves the personal cache is empty.

- [ ] **Step 2: Run backend end-to-end tests**

Run: `go test -race ./internal/campus/livebridge/... ./internal/campus/native ./internal/boot`  
Expected: Pathfinder-focused suites PASS; record separately any unrelated legacy Reasonix tests that still require deleted coding tools.

- [ ] **Step 3: Document student and developer installation**

The extension README includes Web Store and developer-mode installation, permissions, pairing, login flow, connection states, read-only guarantee, personal-data disclosure, troubleshooting, and how to run `pnpm verify`. Root READMEs link the extension directory and explain live versus cached freshness.

- [ ] **Step 4: Run a repository secret and mutation scan**

Run:

```sh
rg -ni "cookie|authorization|csrf|passphrase|student.?id|login.?id|@ucdavis\.edu" extensions/pathfinder-schedule-bridge internal/campus/livebridge
rg -ni "register|drop|swap|saveSchedule|updatePreferences" extensions/pathfinder-schedule-bridge/src
```

Expected: the first scan finds only denylist/schema documentation with synthetic values; the second finds only denylist types/tests and no executable mutation path.

- [ ] **Step 5: Run complete extension and desktop builds**

Run:

```sh
pnpm --dir extensions/pathfinder-schedule-bridge verify
pnpm --dir desktop/frontend run build
go test ./internal/campus/livebridge/... ./internal/campus/native ./internal/boot
cd desktop && wails build -clean -nopackage
```

Expected: all commands exit zero and produce `extensions/pathfinder-schedule-bridge/dist/` plus `desktop/build/bin/pathfinder-ucd`.

- [ ] **Step 6: Perform the authenticated read-only smoke test**

Load the unpacked extension from its `dist/` directory, pair with Pathfinder, open Schedule Builder, and let the user complete login. Query one public course with many Sections, one multi-course comparison, and one consented personal-context request. Confirm source/fetched time, single-concurrency progress, cancellation, and no university state change.

- [ ] **Step 7: Commit end-to-end coverage and docs**

```sh
git add internal/campus/livebridge/e2e_test.go extensions/pathfinder-schedule-bridge/README.md README.md README.zh-CN.md
git commit -m "docs: ship Pathfinder live schedule bridge workflow"
```

---

## Final completion audit

- [ ] Inspect every success criterion in `docs/superpowers/specs/2026-07-16-pathfinder-schedule-bridge-design.md` and map it to current test, build, or smoke-test evidence.
- [ ] Confirm the independent extension directory exists and is loadable by Chrome.
- [ ] Confirm a real authenticated read-only Schedule Builder query succeeds; a public-only mock is not sufficient for completion.
- [ ] Confirm mutation attempts are rejected before any page call.
- [ ] Confirm personal context requires session consent and never persists.
- [ ] Confirm passwords, cookies, CSRF tokens, identifiers, and raw pages are absent from wire messages, caches, logs, fixtures, and model tool output.
- [ ] Confirm the current desktop build launches and the existing Reasonix UI remains intact.
- [ ] Use `superpowers:verification-before-completion` before any completion claim.
