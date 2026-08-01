package handlers_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

func TestReminderUpdate_PreservesSelectedAudienceWhenFieldsAreOmitted(t *testing.T) {
	// Given
	ts := setupTestServer(t)
	token, auth := ts.registerTestUser(t, "reminder-audience-handler@example.com")
	vault := ts.createTestVault(t, token, "Reminder Audience Vault")
	contact := ts.createTestContact(t, token, vault.ID, "John")
	basePath := "/api/vaults/" + vault.ID + "/contacts/" + contact.ID + "/reminders"
	created := ts.doRequest(http.MethodPost, basePath, fmt.Sprintf(`{"label":"Birthday","day":15,"month":6,"type":"one_time","audience":"selected_users","selected_user_ids":[%q]}`, auth.User.ID), token)
	if created.Code != http.StatusCreated {
		t.Fatalf("create reminder: expected 201, got %d: %s", created.Code, created.Body.String())
	}
	var reminder struct {
		ID uint `json:"id"`
	}
	if err := json.Unmarshal(parseResponse(t, created).Data, &reminder); err != nil {
		t.Fatalf("decode created reminder: %v", err)
	}

	// When
	updated := ts.doRequest(http.MethodPut, fmt.Sprintf("%s/%d", basePath, reminder.ID), `{"label":"Updated birthday","day":16,"month":6,"type":"one_time"}`, token)

	// Then
	if updated.Code != http.StatusOK {
		t.Fatalf("update reminder: expected 200, got %d: %s", updated.Code, updated.Body.String())
	}
	var response struct {
		Audience        string   `json:"audience"`
		SelectedUserIDs []string `json:"selected_user_ids"`
	}
	if err := json.Unmarshal(parseResponse(t, updated).Data, &response); err != nil {
		t.Fatalf("decode updated reminder: %v", err)
	}
	if response.Audience != "selected_users" {
		t.Fatalf("audience = %q, want selected_users", response.Audience)
	}
	if len(response.SelectedUserIDs) != 1 || response.SelectedUserIDs[0] != auth.User.ID {
		t.Fatalf("selected_user_ids = %#v, want [%q]", response.SelectedUserIDs, auth.User.ID)
	}
}
