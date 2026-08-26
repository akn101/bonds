package mcp

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/labstack/echo/v5"
	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

const mcpProtocolVersion = "2025-06-18"

type Handler struct {
	db       *gorm.DB
	registry *ActionRegistry
	executor *ActionExecutor
	searcher *BondsSearcher
	fetcher  *ResourceFetcher
}

func NewHandler(db *gorm.DB, registry *ActionRegistry, executor *ActionExecutor, searcher *BondsSearcher, fetcher *ResourceFetcher) *Handler {
	return &Handler{db: db, registry: registry, executor: executor, searcher: searcher, fetcher: fetcher}
}

func (h *Handler) Handle(c *echo.Context) error {
	if err := validateProtocolVersionHeader(c); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse(nil, -32600, err.Error(), nil))
	}
	var req jsonRPCRequest
	if err := json.NewDecoder(c.Request().Body).Decode(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse(nil, -32700, "parse error", nil))
	}
	if req.JSONRPC != jsonRPCVersion {
		return c.JSON(http.StatusBadRequest, errorResponse(req.ID, -32600, "invalid jsonrpc version", nil))
	}
	if isPeerResponse(req) {
		return c.NoContent(http.StatusAccepted)
	}
	if isNotification(req) {
		h.dispatch(c, req)
		return c.NoContent(http.StatusAccepted)
	}
	resp := h.dispatch(c, req)
	status := http.StatusOK
	if resp.Error != nil && resp.Error.Code == -32600 {
		status = http.StatusBadRequest
	}
	return c.JSON(status, resp)
}

func (h *Handler) MethodNotAllowed(c *echo.Context) error {
	return c.NoContent(http.StatusMethodNotAllowed)
}

func (h *Handler) dispatch(c *echo.Context, req jsonRPCRequest) jsonRPCResponse {
	switch req.Method {
	case "initialize":
		return successResponse(req.ID, map[string]interface{}{
			"protocolVersion": mcpProtocolVersion,
			"capabilities": map[string]interface{}{
				"tools":     map[string]interface{}{"listChanged": false},
				"resources": map[string]interface{}{},
			},
			"serverInfo": map[string]string{"name": "bonds", "version": "mcp-v1"},
		})
	case "notifications/initialized":
		return successResponse(req.ID, map[string]interface{}{})
	case "tools/list":
		return successResponse(req.ID, map[string]interface{}{"tools": h.tools()})
	case "tools/call":
		params, err := decodeParams[toolCallParams](req.Params)
		if err != nil {
			return errorResponse(req.ID, -32602, "invalid tool call params", err.Error())
		}
		return successResponse(req.ID, h.callTool(c, params))
	case "resources/read":
		params, err := decodeParams[FetchResourceArgs](req.Params)
		if err != nil {
			return errorResponse(req.ID, -32602, "invalid resource params", err.Error())
		}
		return h.readResource(c, req.ID, params)
	case "resources/list":
		return successResponse(req.ID, map[string]interface{}{"resources": []interface{}{}})
	default:
		return errorResponse(req.ID, -32601, "method not found", req.Method)
	}
}

func (h *Handler) tools() []toolDefinition {
	return []toolDefinition{
		{
			Name:        "get_current_context",
			Title:       "Get Current Context",
			Description: "Return the authenticated Bonds user and accessible vaults.",
			InputSchema: objectSchema(nil, nil),
			Annotations: readOnlyAnnotations(),
		},
		{
			Name:        "discover_capabilities",
			Title:       "Discover API Capabilities",
			Description: "List registered Bonds API actions available through execute_action.",
			InputSchema: objectSchema(map[string]interface{}{
				"filter": map[string]interface{}{"type": "string", "description": "Optional filter for action id, method, or path."},
				"limit":  map[string]interface{}{"type": "integer", "description": "Maximum actions to return, capped at 100."},
				"offset": map[string]interface{}{"type": "integer", "description": "Pagination offset."},
			}, nil),
			Annotations: readOnlyAnnotations(),
		},
		{
			Name:        "describe_capability",
			Title:       "Describe API Capability",
			Description: "Return metadata for one registered Bonds API action.",
			InputSchema: objectSchema(map[string]interface{}{
				"action_id": map[string]interface{}{"type": "string"},
			}, []string{"action_id"}),
			Annotations: readOnlyAnnotations(),
		},
		{
			Name:        "execute_action",
			Title:       "Execute API Action",
			Description: "Execute a registered Bonds /api action through the existing backend routes and permissions.",
			InputSchema: objectSchema(map[string]interface{}{
				"action_id":   map[string]interface{}{"type": "string"},
				"path_params": map[string]interface{}{"type": "object", "additionalProperties": map[string]interface{}{"type": "string"}},
				"query":       map[string]interface{}{"type": "object"},
				"body":        map[string]interface{}{"type": "object"},
				"multipart":   map[string]interface{}{"type": "object"},
				"headers":     map[string]interface{}{"type": "object", "additionalProperties": map[string]interface{}{"type": "string"}},
			}, []string{"action_id"}),
			Annotations: map[string]interface{}{"readOnlyHint": false, "destructiveHint": true, "openWorldHint": false},
		},
		{
			Name:        "search_bonds",
			Title:       "Search Bonds",
			Description: "Search a vault using fixed structured queries and the existing Bleve full-text index. No vector search or arbitrary SQL is used.",
			InputSchema: objectSchema(map[string]interface{}{
				"vault_id": map[string]interface{}{"type": "string"},
				"query":    map[string]interface{}{"type": "string"},
				"page":     map[string]interface{}{"type": "integer"},
				"per_page": map[string]interface{}{"type": "integer"},
			}, []string{"vault_id", "query"}),
			Annotations: readOnlyAnnotations(),
		},
		{
			Name:        "fetch_resource",
			Title:       "Fetch Bonds Resource",
			Description: "Read a Bonds resource by bonds:// URI with viewer permission checks.",
			InputSchema: objectSchema(map[string]interface{}{
				"uri": map[string]interface{}{"type": "string", "description": "Resource URI such as bonds://contact/{id}."},
			}, []string{"uri"}),
			Annotations: readOnlyAnnotations(),
		},
	}
}

func (h *Handler) callTool(c *echo.Context, params toolCallParams) toolResult {
	switch params.Name {
	case "get_current_context":
		return h.currentContext(c)
	case "discover_capabilities", "list_actions":
		args, err := decodeParams[listActionsArgs](params.Arguments)
		if err != nil {
			return toolFailure("invalid discover_capabilities arguments", err.Error())
		}
		actions, total := h.registry.List(args.Filter, args.Limit, args.Offset)
		return toolSuccess(map[string]interface{}{"actions": actions, "total": total})
	case "describe_capability":
		args, err := decodeParams[describeCapabilityArgs](params.Arguments)
		if err != nil {
			return toolFailure("invalid describe_capability arguments", err.Error())
		}
		action, ok := h.registry.Get(args.ActionID)
		if !ok {
			return toolFailure("unknown action_id", args.ActionID)
		}
		return toolSuccess(action)
	case "execute_action":
		args, err := decodeParams[ExecuteActionArgs](params.Arguments)
		if err != nil {
			return toolFailure("invalid execute_action arguments", err.Error())
		}
		result, err := h.executor.Execute(args, c.Request().Header.Get("Authorization"))
		if err != nil {
			return toolFailure("execute_action failed", err.Error())
		}
		if result.Status >= 400 {
			return toolFailure("execute_action returned error status", result)
		}
		return toolSuccess(result)
	case "search_bonds":
		args, err := decodeParams[SearchBondsArgs](params.Arguments)
		if err != nil {
			return toolFailure("invalid search_bonds arguments", err.Error())
		}
		result, err := h.searcher.Search(currentUserID(c), args)
		if err != nil {
			return toolFailure("search_bonds failed", err.Error())
		}
		return toolSuccess(result)
	case "fetch_resource":
		args, err := decodeParams[FetchResourceArgs](params.Arguments)
		if err != nil {
			return toolFailure("invalid fetch_resource arguments", err.Error())
		}
		result, err := h.fetcher.Fetch(currentUserID(c), args)
		if err != nil {
			return toolFailure("fetch_resource failed", err.Error())
		}
		return toolSuccess(result)
	default:
		return toolFailure("unknown tool", params.Name)
	}
}

func (h *Handler) currentContext(c *echo.Context) toolResult {
	var vaults []models.Vault
	if err := h.db.Joins("JOIN user_vault ON user_vault.vault_id = vaults.id").
		Where("user_vault.user_id = ?", currentUserID(c)).
		Order("vaults.name ASC").
		Find(&vaults).Error; err != nil {
		return toolFailure("failed to load current context", err.Error())
	}
	return toolSuccess(map[string]interface{}{
		"user": map[string]interface{}{
			"id":                currentUserID(c),
			"account_id":        c.Get("account_id"),
			"email":             c.Get("email"),
			"is_admin":          c.Get("is_admin"),
			"is_instance_admin": c.Get("is_instance_admin"),
			"auth_type":         c.Get("auth_type"),
		},
		"vaults": vaults,
		"mcp": map[string]interface{}{
			"confirmation":            false,
			"audit":                   false,
			"semantic_vector_search":  false,
			"all_api_actions_enabled": true,
		},
	})
}

func (h *Handler) readResource(c *echo.Context, id json.RawMessage, args FetchResourceArgs) jsonRPCResponse {
	result, err := h.fetcher.Fetch(currentUserID(c), args)
	if err != nil {
		return errorResponse(id, -32002, "resource not found", err.Error())
	}
	text, err := json.Marshal(result)
	if err != nil {
		return errorResponse(id, -32603, "failed to encode resource", err.Error())
	}
	return successResponse(id, map[string]interface{}{
		"contents": []map[string]interface{}{{
			"uri":      args.URI,
			"mimeType": "application/json",
			"text":     string(text),
		}},
	})
}

type listActionsArgs struct {
	Filter string `json:"filter"`
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
}

type describeCapabilityArgs struct {
	ActionID string `json:"action_id"`
}

func currentUserID(c *echo.Context) string {
	userID, _ := c.Get("user_id").(string)
	return userID
}

func objectSchema(properties map[string]interface{}, required []string) map[string]interface{} {
	if properties == nil {
		properties = map[string]interface{}{}
	}
	schema := map[string]interface{}{"type": "object", "properties": properties}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func readOnlyAnnotations() map[string]interface{} {
	return map[string]interface{}{"readOnlyHint": true, "destructiveHint": false, "openWorldHint": false}
}

func isNotification(req jsonRPCRequest) bool {
	return len(req.ID) == 0
}

func isPeerResponse(req jsonRPCRequest) bool {
	return req.Method == "" && (len(req.Result) > 0 || len(req.Error) > 0)
}

func validateProtocolVersionHeader(c *echo.Context) error {
	version := c.Request().Header.Get("MCP-Protocol-Version")
	if version == "" || version == mcpProtocolVersion {
		return nil
	}
	return fmt.Errorf("unsupported MCP-Protocol-Version: %s", version)
}
