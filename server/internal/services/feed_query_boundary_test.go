package services

import (
	"testing"

	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/testutil"
)

func TestGetFeedExcludesLegacyRowsWithoutEventVaultID(t *testing.T) {
	// Given
	db := testutil.SetupTestDB(t)
	ctx := setupFeedEventHistoryContext(t, db, "vault-feed-boundary@example.com")
	firstName := "Vault"
	contact := models.Contact{VaultID: ctx.vaultID, FirstName: &firstName}
	if err := db.Create(&contact).Error; err != nil {
		t.Fatalf("create contact: %v", err)
	}
	if err := db.Create(&models.ContactFeedItem{ContactID: contact.ID, Action: ActionContactCreated}).Error; err != nil {
		t.Fatalf("create legacy feed item without event vault: %v", err)
	}

	// When
	items, meta, err := NewFeedService(db).GetFeed(ctx.vaultID, 1, 15, ctx.userID)

	// Then
	if err != nil {
		t.Fatalf("get vault feed: %v", err)
	}
	if len(items) != 0 {
		t.Errorf("vault feed item count = %d, want 0", len(items))
	}
	if meta.Total != 0 {
		t.Errorf("vault feed total = %d, want 0", meta.Total)
	}
}

func TestListContactFeedDoesNotLeakLegacyRowsFromAnotherContact(t *testing.T) {
	// Given
	db := testutil.SetupTestDB(t)
	ctx := setupFeedEventHistoryContext(t, db, "contact-feed-boundary@example.com")
	requestedFirstName, otherFirstName := "Requested", "Other"
	requestedContact := models.Contact{VaultID: ctx.vaultID, FirstName: &requestedFirstName}
	otherContact := models.Contact{VaultID: ctx.vaultID, FirstName: &otherFirstName}
	if err := db.Create(&requestedContact).Error; err != nil {
		t.Fatalf("create requested contact: %v", err)
	}
	if err := db.Create(&otherContact).Error; err != nil {
		t.Fatalf("create other contact: %v", err)
	}
	if err := db.Create(&models.ContactFeedItem{ContactID: otherContact.ID, Action: ActionContactCreated}).Error; err != nil {
		t.Fatalf("create other contact legacy feed item: %v", err)
	}

	// When
	items, meta, err := NewFeedService(db).ListContactFeed(requestedContact.ID, ctx.vaultID, 1, 15, ctx.userID)

	// Then
	if err != nil {
		t.Fatalf("list requested contact feed: %v", err)
	}
	if len(items) != 0 {
		t.Errorf("requested contact feed item count = %d, want 0", len(items))
	}
	if meta.Total != 0 {
		t.Errorf("requested contact feed total = %d, want 0", meta.Total)
	}
}
