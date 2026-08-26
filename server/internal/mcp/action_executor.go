package mcp

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"net/url"
	"strings"

	"github.com/labstack/echo/v5"
)

const maxActionResponseBytes = 1 << 20

type ActionExecutor struct {
	e        *echo.Echo
	registry *ActionRegistry
}

type ExecuteActionArgs struct {
	ActionID   string                 `json:"action_id"`
	PathParams map[string]string      `json:"path_params"`
	Query      map[string]interface{} `json:"query"`
	Body       json.RawMessage        `json:"body"`
	Multipart  *MultipartInput        `json:"multipart"`
	Headers    map[string]string      `json:"headers"`
}

type MultipartInput struct {
	Fields map[string]string `json:"fields"`
	Files  []MultipartFile   `json:"files"`
}

type MultipartFile struct {
	FieldName   string `json:"field_name"`
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	DataBase64  string `json:"data_base64"`
}

type ExecuteActionResult struct {
	ActionID    string      `json:"action_id"`
	Status      int         `json:"status"`
	ContentType string      `json:"content_type,omitempty"`
	Data        interface{} `json:"data,omitempty"`
	BodyText    string      `json:"body_text,omitempty"`
	BodyBase64  string      `json:"body_base64,omitempty"`
}

func NewActionExecutor(e *echo.Echo, registry *ActionRegistry) *ActionExecutor {
	return &ActionExecutor{e: e, registry: registry}
}

func (x *ActionExecutor) Execute(args ExecuteActionArgs, authorization string) (ExecuteActionResult, error) {
	action, ok := x.registry.Get(args.ActionID)
	if !ok {
		return ExecuteActionResult{}, fmt.Errorf("unknown action_id: %s", args.ActionID)
	}
	path, err := materializePath(action, args.PathParams)
	if err != nil {
		return ExecuteActionResult{}, err
	}
	query := url.Values{}
	for key, value := range args.Query {
		addQueryValue(query, key, value)
	}
	if encoded := query.Encode(); encoded != "" {
		path += "?" + encoded
	}

	body, contentType, err := buildActionBody(args)
	if err != nil {
		return ExecuteActionResult{}, err
	}
	req := httptest.NewRequest(action.Method, path, body)
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	copyAllowedHeaders(req.Header, args.Headers)

	rec := httptest.NewRecorder()
	x.e.ServeHTTP(rec, req)

	return normalizeActionResponse(args.ActionID, rec), nil
}

func materializePath(action ActionDefinition, params map[string]string) (string, error) {
	path := action.Path
	for _, param := range action.PathParams {
		value := params[param]
		if value == "" {
			return "", fmt.Errorf("missing path parameter: %s", param)
		}
		path = strings.ReplaceAll(path, ":"+param, url.PathEscape(value))
	}
	return path, nil
}

func addQueryValue(values url.Values, key string, value interface{}) {
	switch v := value.(type) {
	case nil:
		return
	case string:
		values.Add(key, v)
	case []interface{}:
		for _, item := range v {
			addQueryValue(values, key, item)
		}
	case []string:
		for _, item := range v {
			values.Add(key, item)
		}
	default:
		values.Add(key, fmt.Sprint(v))
	}
}

func buildActionBody(args ExecuteActionArgs) (io.Reader, string, error) {
	if args.Multipart != nil {
		var buf bytes.Buffer
		writer := multipart.NewWriter(&buf)
		for key, value := range args.Multipart.Fields {
			if err := writer.WriteField(key, value); err != nil {
				return nil, "", err
			}
		}
		for _, file := range args.Multipart.Files {
			data, err := base64.StdEncoding.DecodeString(file.DataBase64)
			if err != nil {
				return nil, "", fmt.Errorf("decode multipart file %s: %w", file.Filename, err)
			}
			fieldName := file.FieldName
			if fieldName == "" {
				fieldName = "file"
			}
			contentType := file.ContentType
			if contentType == "" {
				contentType = "application/octet-stream"
			}
			header := make(textproto.MIMEHeader)
			header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, escapeMultipartQuote(fieldName), escapeMultipartQuote(file.Filename)))
			header.Set("Content-Type", contentType)
			part, err := writer.CreatePart(header)
			if err != nil {
				return nil, "", err
			}
			if _, err := part.Write(data); err != nil {
				return nil, "", err
			}
		}
		if err := writer.Close(); err != nil {
			return nil, "", err
		}
		return &buf, writer.FormDataContentType(), nil
	}
	if len(args.Body) > 0 && string(args.Body) != "null" {
		return bytes.NewReader(args.Body), "application/json", nil
	}
	return nil, "", nil
}

func escapeMultipartQuote(value string) string {
	return strings.NewReplacer("\\", "\\\\", `"`, "\\\"").Replace(value)
}

func copyAllowedHeaders(headers http.Header, input map[string]string) {
	for key, value := range input {
		switch http.CanonicalHeaderKey(key) {
		case "Accept-Language":
			headers.Set("Accept-Language", value)
		}
	}
}

func normalizeActionResponse(actionID string, rec *httptest.ResponseRecorder) ExecuteActionResult {
	contentType := rec.Header().Get("Content-Type")
	body := rec.Body.Bytes()
	if len(body) > maxActionResponseBytes {
		body = body[:maxActionResponseBytes]
	}
	result := ExecuteActionResult{ActionID: actionID, Status: rec.Code, ContentType: contentType}
	if len(body) == 0 {
		return result
	}
	if strings.Contains(contentType, "application/json") || json.Valid(body) {
		var decoded interface{}
		if err := json.Unmarshal(body, &decoded); err == nil {
			result.Data = decoded
			return result
		}
	}
	if strings.HasPrefix(contentType, "text/") || strings.Contains(contentType, "json") || strings.Contains(contentType, "xml") {
		result.BodyText = string(body)
		return result
	}
	result.BodyBase64 = base64.StdEncoding.EncodeToString(body)
	return result
}
