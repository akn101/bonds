package mcp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
)

func TestHandlerAcceptsJSONRPCNotificationWithoutResponseBody(t *testing.T) {
	e := echo.New()
	handler := NewHandler(nil, nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","method":"notifications/initialized"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	if err := handler.Handle(e.NewContext(req, rec)); err != nil {
		t.Fatalf("Handle returned error: %v", err)
	}
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202 for JSON-RPC notification, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("notification must not return a JSON-RPC response body, got %q", rec.Body.String())
	}
}

func TestHandlerAcceptsPeerResponseWithoutResponseBody(t *testing.T) {
	e := echo.New()
	handler := NewHandler(nil, nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"result":{}}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	if err := handler.Handle(e.NewContext(req, rec)); err != nil {
		t.Fatalf("Handle returned error: %v", err)
	}
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202 for JSON-RPC response from peer, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("peer response must not return a JSON-RPC response body, got %q", rec.Body.String())
	}
}

func TestHandlerRejectsUnsupportedProtocolVersionHeader(t *testing.T) {
	e := echo.New()
	handler := NewHandler(nil, nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	req.Header.Set("MCP-Protocol-Version", "1999-01-01")
	rec := httptest.NewRecorder()

	if err := handler.Handle(e.NewContext(req, rec)); err != nil {
		t.Fatalf("Handle returned error: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unsupported MCP-Protocol-Version, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestHandlerRequiresExplicitJSONRPCVersion(t *testing.T) {
	e := echo.New()
	handler := NewHandler(nil, nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"id":1,"method":"tools/list"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	if err := handler.Handle(e.NewContext(req, rec)); err != nil {
		t.Fatalf("Handle returned error: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing jsonrpc version, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestParseErrorResponseContainsNullID(t *testing.T) {
	e := echo.New()
	handler := NewHandler(nil, nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0",`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	if err := handler.Handle(e.NewContext(req, rec)); err != nil {
		t.Fatalf("Handle returned error: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for parse error, got %d: %s", rec.Code, rec.Body.String())
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to parse error response: %v", err)
	}
	if _, ok := payload["id"]; !ok {
		t.Fatalf("parse error response must include id:null, got %s", rec.Body.String())
	}
	if payload["id"] != nil {
		t.Fatalf("parse error response id must be null, got %v", payload["id"])
	}
}
