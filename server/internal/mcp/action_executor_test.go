package mcp

import (
	"net/http"
	"testing"

	"github.com/labstack/echo/v5"
)

func TestActionExecutorForwardsRegisteredAction(t *testing.T) {
	e := echo.New()
	e.GET("/api/vaults/:vault_id/contacts", func(c *echo.Context) error {
		if c.Request().Header.Get("Authorization") != "Bearer token" {
			return c.JSON(http.StatusUnauthorized, map[string]string{"error": "missing auth"})
		}
		return c.JSON(http.StatusOK, map[string]string{
			"vault_id": c.Param("vault_id"),
			"query":    c.QueryParam("q"),
		})
	})
	registry := NewActionRegistry(e)
	executor := NewActionExecutor(e, registry)

	result, err := executor.Execute(ExecuteActionArgs{
		ActionID:   "get_vaults_by_vault_id_contacts",
		PathParams: map[string]string{"vault_id": "vault 1"},
		Query:      map[string]interface{}{"q": "alice"},
	}, "Bearer token")
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if result.Status != http.StatusOK {
		t.Fatalf("expected 200, got %d: %+v", result.Status, result)
	}
	data, ok := result.Data.(map[string]interface{})
	if !ok {
		t.Fatalf("expected JSON map, got %#v", result.Data)
	}
	if data["vault_id"] != "vault 1" || data["query"] != "alice" {
		t.Fatalf("unexpected data: %+v", data)
	}
}

func TestActionExecutorRejectsUnknownAndMissingParams(t *testing.T) {
	e := echo.New()
	e.GET("/api/vaults/:vault_id", func(c *echo.Context) error { return c.NoContent(http.StatusOK) })
	executor := NewActionExecutor(e, NewActionRegistry(e))

	if _, err := executor.Execute(ExecuteActionArgs{ActionID: "missing"}, "Bearer token"); err == nil {
		t.Fatal("expected unknown action error")
	}
	if _, err := executor.Execute(ExecuteActionArgs{ActionID: "get_vaults_by_vault_id"}, "Bearer token"); err == nil {
		t.Fatal("expected missing path param error")
	}
}
