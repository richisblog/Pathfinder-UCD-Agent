package native

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	_ "time/tzdata"

	"reasonix/internal/tool"
)

const (
	pacificTimeZone     = "America/Los_Angeles"
	openTimezoneURL     = "https://api.opentimezone.com/convert"
	openTimezoneMaxBody = 16 * 1024
	localDateTimeLayout = "2006-01-02T15:04:05"
)

type openTimezoneRequest struct {
	DateTime     string `json:"dateTime"`
	FromTimezone string `json:"fromTimezone"`
	ToTimezone   string `json:"toTimezone"`
}

type openTimezoneConverter interface {
	Convert(context.Context, openTimezoneRequest) (string, error)
}

type httpOpenTimezoneConverter struct {
	endpoint string
	client   *http.Client
}

type pacificTimeTool struct {
	converter openTimezoneConverter
	now       func() time.Time
}

type pacificTimeArgs struct {
	DateTime       string `json:"date_time"`
	SourceTimeZone string `json:"source_time_zone"`
}

type pacificTimeOutput struct {
	Instant          string `json:"instant"`
	PacificTime      string `json:"pacific_time"`
	TimeZone         string `json:"time_zone"`
	Abbreviation     string `json:"abbreviation"`
	UTCOffset        string `json:"utc_offset"`
	Display          string `json:"display"`
	ConversionSource string `json:"conversion_source"`
}

func defaultOpenTimezoneConverter() openTimezoneConverter {
	return &httpOpenTimezoneConverter{
		endpoint: openTimezoneURL,
		client:   &http.Client{Timeout: 2 * time.Second},
	}
}

func newPacificTimeTool(converter openTimezoneConverter, now func() time.Time) pacificTimeTool {
	if converter == nil {
		converter = defaultOpenTimezoneConverter()
	}
	if now == nil {
		now = time.Now
	}
	return pacificTimeTool{converter: converter, now: now}
}

func (pacificTimeTool) Name() string { return "convert_pacific_time" }

func (pacificTimeTool) Description() string {
	return "Return the exact current US Pacific time or convert an RFC3339 instant or IANA-zone local datetime to America/Los_Angeles, with automatic PST/PDT handling."
}

func (pacificTimeTool) Schema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"date_time":{"type":"string","description":"Optional RFC3339 instant such as 2026-08-20T14:00:00-04:00, or an offset-less local datetime such as 2026-08-20T14:00:00. Omit to get current Pacific time."},"source_time_zone":{"type":"string","description":"Required IANA timezone, such as America/New_York, when date_time has no UTC offset. Omit for RFC3339 input or current Pacific time."}},"additionalProperties":false}`)
}

func (pacificTimeTool) ReadOnly() bool     { return true }
func (pacificTimeTool) PlanModeSafe() bool { return true }
func (pacificTimeTool) SnipHint() tool.SnipHint {
	return tool.SnipHint{Head: 30, Tail: 4, HeadChars: 5000, TailChars: 1000}
}

func (t pacificTimeTool) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var args pacificTimeArgs
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&args); err != nil {
		return "", fmt.Errorf("invalid Pacific time args: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return "", fmt.Errorf("invalid Pacific time args: trailing content")
	}
	args.DateTime = strings.TrimSpace(args.DateTime)
	args.SourceTimeZone = strings.TrimSpace(args.SourceTimeZone)
	if args.DateTime == "" && args.SourceTimeZone != "" {
		return "", fmt.Errorf("invalid Pacific time args: source_time_zone cannot be used without date_time")
	}

	var instant time.Time
	explicit := args.DateTime != ""
	if !explicit {
		instant = t.now().UTC()
	} else if parsed, err := time.Parse(time.RFC3339, args.DateTime); err == nil {
		instant = parsed.UTC()
	} else {
		if args.SourceTimeZone == "" {
			return "", fmt.Errorf("invalid Pacific time args: source_time_zone is required for an offset-less date_time")
		}
		location, err := time.LoadLocation(args.SourceTimeZone)
		if err != nil {
			return "", fmt.Errorf("invalid source_time_zone %q: %w", args.SourceTimeZone, err)
		}
		wall, err := time.Parse(localDateTimeLayout, args.DateTime)
		if err != nil {
			return "", fmt.Errorf("invalid Pacific time args: date_time must be RFC3339 or YYYY-MM-DDTHH:MM:SS")
		}
		candidates := localTimeCandidates(wall, location)
		switch len(candidates) {
		case 0:
			return "", fmt.Errorf("invalid Pacific time args: local date_time is nonexistent in %s because of a timezone transition", args.SourceTimeZone)
		case 1:
			instant = candidates[0].UTC()
		default:
			return "", fmt.Errorf("invalid Pacific time args: local date_time is ambiguous in %s because of a timezone transition; provide an RFC3339 offset", args.SourceTimeZone)
		}
	}

	pacific, err := pacificLocationTime(instant)
	if err != nil {
		return "", err
	}
	conversionSource := "local_iana_fallback"
	if explicit && t.converter != nil {
		remote, remoteErr := t.converter.Convert(ctx, openTimezoneRequest{
			DateTime:     instant.UTC().Format(localDateTimeLayout),
			FromTimezone: "UTC",
			ToTimezone:   pacificTimeZone,
		})
		if remoteErr == nil && remoteMatchesPacific(remote, pacific) {
			conversionSource = "opentimezone"
		}
	}

	abbreviation, offsetSeconds := pacific.Zone()
	output := pacificTimeOutput{
		Instant:          instant.UTC().Format(time.RFC3339),
		PacificTime:      pacific.Format(time.RFC3339),
		TimeZone:         pacificTimeZone,
		Abbreviation:     abbreviation,
		UTCOffset:        formatUTCOffset(offsetSeconds),
		Display:          pacific.Format("January 2, 2006 at 3:04 PM MST"),
		ConversionSource: conversionSource,
	}
	encoded, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func pacificLocationTime(instant time.Time) (time.Time, error) {
	location, err := time.LoadLocation(pacificTimeZone)
	if err != nil {
		return time.Time{}, fmt.Errorf("load Pacific timezone: %w", err)
	}
	return instant.In(location), nil
}

func localTimeCandidates(wall time.Time, location *time.Location) []time.Time {
	wallUTC := time.Date(wall.Year(), wall.Month(), wall.Day(), wall.Hour(), wall.Minute(), wall.Second(), wall.Nanosecond(), time.UTC)
	offsets := make(map[int]struct{})
	for hour := -36; hour <= 36; hour++ {
		_, offset := wallUTC.Add(time.Duration(hour) * time.Hour).In(location).Zone()
		offsets[offset] = struct{}{}
	}
	candidates := make([]time.Time, 0, len(offsets))
	seen := make(map[int64]struct{})
	for offset := range offsets {
		candidate := wallUTC.Add(-time.Duration(offset) * time.Second)
		projected := candidate.In(location)
		if projected.Year() != wall.Year() ||
			projected.Month() != wall.Month() ||
			projected.Day() != wall.Day() ||
			projected.Hour() != wall.Hour() ||
			projected.Minute() != wall.Minute() ||
			projected.Second() != wall.Second() {
			continue
		}
		if _, exists := seen[candidate.UnixNano()]; !exists {
			seen[candidate.UnixNano()] = struct{}{}
			candidates = append(candidates, candidate)
		}
	}
	return candidates
}

func remoteMatchesPacific(remote string, pacific time.Time) bool {
	parsed, err := time.Parse(localDateTimeLayout, strings.TrimSpace(remote))
	if err != nil {
		return false
	}
	return parsed.Format(localDateTimeLayout) == pacific.Format(localDateTimeLayout)
}

func formatUTCOffset(offsetSeconds int) string {
	sign := "+"
	if offsetSeconds < 0 {
		sign = "-"
		offsetSeconds = -offsetSeconds
	}
	return fmt.Sprintf("%s%02d:%02d", sign, offsetSeconds/3600, (offsetSeconds%3600)/60)
}

func (c *httpOpenTimezoneConverter) Convert(ctx context.Context, input openTimezoneRequest) (string, error) {
	endpoint, err := url.Parse(c.endpoint)
	if err != nil || endpoint.Scheme != "https" {
		return "", fmt.Errorf("OpenTimezone endpoint must use HTTPS")
	}
	body, err := json.Marshal(input)
	if err != nil {
		return "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("OpenTimezone returned HTTP %d", response.StatusCode)
	}
	bounded, err := io.ReadAll(io.LimitReader(response.Body, openTimezoneMaxBody+1))
	if err != nil {
		return "", err
	}
	if len(bounded) > openTimezoneMaxBody {
		return "", fmt.Errorf("OpenTimezone response exceeded %d bytes", openTimezoneMaxBody)
	}
	var output struct {
		DateTime string `json:"dateTime"`
	}
	decoder := json.NewDecoder(bytes.NewReader(bounded))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&output); err != nil {
		return "", fmt.Errorf("decode OpenTimezone response: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return "", fmt.Errorf("decode OpenTimezone response: trailing content")
	}
	if strings.TrimSpace(output.DateTime) == "" {
		return "", fmt.Errorf("OpenTimezone response omitted dateTime")
	}
	return output.DateTime, nil
}
