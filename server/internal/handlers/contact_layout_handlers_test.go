package handlers_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/naiba/bonds/internal/dto"
)

func TestContactLayoutHandlersCRUDConflictAndVaultIsolation(t *testing.T) {
	ts := setupTestServer(t)
	token, _ := ts.registerTestUser(t, "contact-layout-handler@example.com")
	vaultA := ts.createTestVault(t, token, "Layout A")
	vaultB := ts.createTestVault(t, token, "Layout B")
	baseA := fmt.Sprintf("/api/vaults/%s/contact-layout/templates", vaultA.ID)

	listRec := ts.doRequest(http.MethodGet, baseA, "", token)
	if listRec.Code != http.StatusOK {
		t.Fatalf("list layouts: %d %s", listRec.Code, listRec.Body.String())
	}
	var summaries []dto.ContactLayoutTemplateSummary
	if err := json.Unmarshal(parseResponse(t, listRec).Data, &summaries); err != nil {
		t.Fatalf("decode summaries: %v", err)
	}
	if len(summaries) != 1 || !summaries[0].IsDefault {
		t.Fatalf("unexpected initial layouts: %+v", summaries)
	}

	createRec := ts.doRequest(http.MethodPost, baseA,
		fmt.Sprintf(`{"name":"Family view","source_template_id":%d}`, summaries[0].ID), token)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create layout: %d %s", createRec.Code, createRec.Body.String())
	}
	var created dto.ContactLayoutResponse
	if err := json.Unmarshal(parseResponse(t, createRec).Data, &created); err != nil {
		t.Fatalf("decode created layout: %v", err)
	}
	if created.VaultID != vaultA.ID || created.Name != "Family view" || len(created.Pages) == 0 {
		t.Fatalf("unexpected created layout: %+v", created)
	}

	save := dto.SaveContactLayoutRequest{ExpectedRevision: created.Revision}
	for _, page := range created.Pages {
		pageID := page.ID
		input := dto.SaveContactLayoutPageRequest{
			ID: &pageID, Name: page.Name, Slug: page.Slug, Type: page.Type,
			Visible: page.Visible,
		}
		for _, module := range page.Modules {
			input.Modules = append(input.Modules, dto.SaveContactLayoutModuleRequest{Key: module.Key})
		}
		save.Pages = append(save.Pages, input)
	}
	for index := range save.Pages {
		if save.Pages[index].Slug == "relationship-network" {
			save.Pages[index].Visible = false
		}
	}
	body, err := json.Marshal(save)
	if err != nil {
		t.Fatalf("encode save request: %v", err)
	}
	savePath := fmt.Sprintf("%s/%d/layout", baseA, created.ID)
	firstSave := ts.doRequest(http.MethodPut, savePath, string(body), token)
	if firstSave.Code != http.StatusOK {
		t.Fatalf("save layout: %d %s", firstSave.Code, firstSave.Body.String())
	}
	staleSave := ts.doRequest(http.MethodPut, savePath, string(body), token)
	if staleSave.Code != http.StatusConflict {
		t.Fatalf("stale save: expected 409, got %d %s", staleSave.Code, staleSave.Body.String())
	}

	crossVault := ts.doRequest(http.MethodGet,
		fmt.Sprintf("/api/vaults/%s/contact-layout/templates/%d", vaultB.ID, created.ID), "", token)
	if crossVault.Code != http.StatusNotFound {
		t.Fatalf("cross-vault layout read: expected 404, got %d %s", crossVault.Code, crossVault.Body.String())
	}

	defaultRec := ts.doRequest(http.MethodPut, fmt.Sprintf("%s/%d/default", baseA, created.ID), "", token)
	if defaultRec.Code != http.StatusNoContent {
		t.Fatalf("set default: %d %s", defaultRec.Code, defaultRec.Body.String())
	}
	deleteDefault := ts.doRequest(http.MethodDelete, fmt.Sprintf("%s/%d", baseA, created.ID), "", token)
	if deleteDefault.Code != http.StatusBadRequest {
		t.Fatalf("delete default: expected 400, got %d %s", deleteDefault.Code, deleteDefault.Body.String())
	}
}
