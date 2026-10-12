package protocol

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
)

var (
	requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{8,80}$`)
	termPattern      = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$`)
)

func DecodeRequest(r io.Reader) (Request, error) {
	raw, err := io.ReadAll(io.LimitReader(r, MaxMessageBytes+1))
	if err != nil {
		return Request{}, fmt.Errorf("read request: %w", err)
	}
	if len(raw) > MaxMessageBytes {
		return Request{}, fmt.Errorf("message too large: maximum is %d bytes", MaxMessageBytes)
	}
	var req Request
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		return Request{}, fmt.Errorf("decode request: %w", err)
	}
	if err := ensureJSONEOF(dec); err != nil {
		return Request{}, err
	}
	if err := ValidateRequest(req); err != nil {
		return Request{}, err
	}
	return req, nil
}

func ValidateRequest(req Request) error {
	if req.Protocol != Version {
		return fmt.Errorf("unsupported protocol version %d", req.Protocol)
	}
	if !requestIDPattern.MatchString(req.ID) {
		return fmt.Errorf("request id has invalid format")
	}
	if req.Type != TypeRequest {
		return fmt.Errorf("message type must be %q", TypeRequest)
	}
	switch req.Method {
	case MethodBridgeStatus, MethodScheduleTerms, MethodScheduleSearch, MethodSchedulePersonal, MethodRequestCancel:
	default:
		return fmt.Errorf("unknown method %q", req.Method)
	}
	if len(req.Params) == 0 {
		return fmt.Errorf("params are required")
	}
	return nil
}

func DecodeSearchParams(req Request) (SearchParams, error) {
	if req.Method != MethodScheduleSearch {
		return SearchParams{}, fmt.Errorf("request method %q is not schedule.search", req.Method)
	}
	var params SearchParams
	if err := decodeStrict(req.Params, &params); err != nil {
		return SearchParams{}, err
	}
	if !termPattern.MatchString(params.Term) {
		return SearchParams{}, fmt.Errorf("term has invalid format")
	}
	if len(params.Courses) < 1 || len(params.Courses) > 100 {
		return SearchParams{}, fmt.Errorf("courses must contain between 1 and 100 entries")
	}
	for i, course := range params.Courses {
		course = strings.TrimSpace(course)
		if course == "" || len(course) > 32 {
			return SearchParams{}, fmt.Errorf("course %d must contain 1 to 32 characters", i+1)
		}
		params.Courses[i] = course
	}
	return params, nil
}

func decodeStrict(raw json.RawMessage, out any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		if strings.Contains(err.Error(), "unknown field") {
			return fmt.Errorf("unknown field in params: %w", err)
		}
		return fmt.Errorf("decode params: %w", err)
	}
	return ensureJSONEOF(dec)
}

func ensureJSONEOF(dec *json.Decoder) error {
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		if err == nil {
			return fmt.Errorf("multiple JSON values are not allowed")
		}
		return fmt.Errorf("decode trailing JSON: %w", err)
	}
	return nil
}
