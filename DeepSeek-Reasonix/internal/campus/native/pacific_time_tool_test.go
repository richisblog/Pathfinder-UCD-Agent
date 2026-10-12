package native

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakePacificConverter struct {
	result string
	err    error
	calls  int
	input  openTimezoneRequest
}

func (f *fakePacificConverter) Convert(_ context.Context, input openTimezoneRequest) (string, error) {
	f.calls++
	f.input = input
	return f.result, f.err
}

func decodePacificOutput(t *testing.T, raw string) pacificTimeOutput {
	t.Helper()
	var output pacificTimeOutput
	if err := json.Unmarshal([]byte(raw), &output); err != nil {
		t.Fatal(err)
	}
	return output
}

func TestPacificTimeToolReturnsCurrentPacificTimeWithoutNetwork(t *testing.T) {
	converter := &fakePacificConverter{err: errors.New("network should not be called")}
	tool := newPacificTimeTool(converter, func() time.Time {
		return time.Date(2026, time.July, 24, 18, 30, 0, 0, time.UTC)
	})

	raw, err := tool.Execute(context.Background(), json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	got := decodePacificOutput(t, raw)
	if got.Instant != "2026-07-24T18:30:00Z" ||
		got.PacificTime != "2026-07-24T11:30:00-07:00" ||
		got.Abbreviation != "PDT" ||
		got.UTCOffset != "-07:00" ||
		got.ConversionSource != "local_iana_fallback" {
		t.Fatalf("output=%+v", got)
	}
	if converter.calls != 0 {
		t.Fatalf("converter calls=%d", converter.calls)
	}
}

func TestPacificTimeToolUsesValidatedOpenTimezoneConversion(t *testing.T) {
	converter := &fakePacificConverter{result: "2026-08-20T11:00:00"}
	tool := newPacificTimeTool(converter, time.Now)

	raw, err := tool.Execute(context.Background(), json.RawMessage(`{"date_time":"2026-08-20T14:00:00-04:00"}`))
	if err != nil {
		t.Fatal(err)
	}
	got := decodePacificOutput(t, raw)
	if got.Instant != "2026-08-20T18:00:00Z" ||
		got.PacificTime != "2026-08-20T11:00:00-07:00" ||
		got.ConversionSource != "opentimezone" {
		t.Fatalf("output=%+v", got)
	}
	if converter.input.FromTimezone != "UTC" ||
		converter.input.ToTimezone != "America/Los_Angeles" ||
		converter.input.DateTime != "2026-08-20T18:00:00" {
		t.Fatalf("input=%+v", converter.input)
	}
}

func TestPacificTimeToolFallsBackWhenRemoteFailsOrDisagrees(t *testing.T) {
	for _, test := range []struct {
		name      string
		converter *fakePacificConverter
	}{
		{name: "transport error", converter: &fakePacificConverter{err: errors.New("offline")}},
		{name: "invalid response", converter: &fakePacificConverter{result: "2026-08-20T12:00:00"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			tool := newPacificTimeTool(test.converter, time.Now)
			raw, err := tool.Execute(context.Background(), json.RawMessage(`{"date_time":"2026-08-20T18:00:00Z"}`))
			if err != nil {
				t.Fatal(err)
			}
			got := decodePacificOutput(t, raw)
			if got.PacificTime != "2026-08-20T11:00:00-07:00" || got.ConversionSource != "local_iana_fallback" {
				t.Fatalf("output=%+v", got)
			}
		})
	}
}

func TestPacificTimeToolConvertsLocalIANAInputAndDateRollover(t *testing.T) {
	converter := &fakePacificConverter{result: "2026-12-31T21:30:00"}
	tool := newPacificTimeTool(converter, time.Now)

	raw, err := tool.Execute(context.Background(), json.RawMessage(
		`{"date_time":"2027-01-01T00:30:00","source_time_zone":"America/New_York"}`,
	))
	if err != nil {
		t.Fatal(err)
	}
	got := decodePacificOutput(t, raw)
	if got.Instant != "2027-01-01T05:30:00Z" ||
		got.PacificTime != "2026-12-31T21:30:00-08:00" ||
		got.Abbreviation != "PST" {
		t.Fatalf("output=%+v", got)
	}
}

func TestPacificTimeToolRejectsInvalidAndAmbiguousInputs(t *testing.T) {
	tests := []struct {
		name string
		args string
		want string
	}{
		{name: "source without time", args: `{"source_time_zone":"UTC"}`, want: "without date_time"},
		{name: "missing source", args: `{"date_time":"2026-08-20T14:00:00"}`, want: "source_time_zone is required"},
		{name: "invalid zone", args: `{"date_time":"2026-08-20T14:00:00","source_time_zone":"Mars/Olympus"}`, want: "invalid source_time_zone"},
		{name: "dst gap", args: `{"date_time":"2026-03-08T02:30:00","source_time_zone":"America/Los_Angeles"}`, want: "nonexistent"},
		{name: "dst overlap", args: `{"date_time":"2026-11-01T01:30:00","source_time_zone":"America/Los_Angeles"}`, want: "ambiguous"},
		{name: "unknown field", args: `{"date_time":"2026-08-20T18:00:00Z","student_id":"private"}`, want: "unknown field"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tool := newPacificTimeTool(&fakePacificConverter{}, time.Now)
			_, err := tool.Execute(context.Background(), json.RawMessage(test.args))
			if err == nil || !strings.Contains(strings.ToLower(err.Error()), strings.ToLower(test.want)) {
				t.Fatalf("err=%v", err)
			}
		})
	}
}

func TestPacificTimeToolContract(t *testing.T) {
	tool := newPacificTimeTool(&fakePacificConverter{}, time.Now)
	if tool.Name() != "convert_pacific_time" || !tool.ReadOnly() || !tool.PlanModeSafe() {
		t.Fatalf("invalid tool contract: %s readOnly=%v planSafe=%v", tool.Name(), tool.ReadOnly(), tool.PlanModeSafe())
	}
	if !json.Valid(tool.Schema()) ||
		!strings.Contains(string(tool.Schema()), "source_time_zone") ||
		!strings.Contains(tool.Description(), "Pacific") {
		t.Fatalf("invalid schema or description: %s %s", tool.Schema(), tool.Description())
	}
}

func TestOpenTimezoneHTTPConverterUsesBoundedHTTPSJSON(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.Header.Get("Content-Type") != "application/json" {
			t.Fatalf("request method=%s content-type=%s", request.Method, request.Header.Get("Content-Type"))
		}
		var input openTimezoneRequest
		if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
			t.Fatal(err)
		}
		if input.ToTimezone != pacificTimeZone || input.FromTimezone != "UTC" {
			t.Fatalf("input=%+v", input)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"dateTime":"2026-08-20T11:00:00"}`))
	}))
	defer server.Close()
	converter := &httpOpenTimezoneConverter{endpoint: server.URL, client: server.Client()}

	got, err := converter.Convert(context.Background(), openTimezoneRequest{
		DateTime: "2026-08-20T18:00:00", FromTimezone: "UTC", ToTimezone: pacificTimeZone,
	})
	if err != nil || got != "2026-08-20T11:00:00" {
		t.Fatalf("got=%q err=%v", got, err)
	}
}

func TestOpenTimezoneHTTPConverterRejectsOversizedOrInvalidResponses(t *testing.T) {
	for _, test := range []struct {
		name string
		body string
		want string
	}{
		{name: "oversized", body: strings.Repeat("x", openTimezoneMaxBody+1), want: "exceeded"},
		{name: "unknown field", body: `{"dateTime":"2026-08-20T11:00:00","student":"private"}`, want: "unknown field"},
		{name: "missing datetime", body: `{}`, want: "omitted"},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				_, _ = writer.Write([]byte(test.body))
			}))
			defer server.Close()
			converter := &httpOpenTimezoneConverter{endpoint: server.URL, client: server.Client()}
			_, err := converter.Convert(context.Background(), openTimezoneRequest{})
			if err == nil || !strings.Contains(strings.ToLower(err.Error()), test.want) {
				t.Fatalf("err=%v", err)
			}
		})
	}
}
