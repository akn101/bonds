package services

import (
	"encoding/json"
	"testing"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/testutil"
	"gorm.io/gorm"
)

func TestFeedRecorderPersistsEventContext(t *testing.T) {
	// Given
	db := testutil.SetupTestDB(t)
	ctx := setupFeedEventHistoryContext(t, db, "recorder-context@example.com")
	nameOrder := "%last_name% %first_name%{nickname? (%nickname%)}"
	if err := db.Model(&models.Vault{}).Where("id = ?", ctx.vaultID).Update("name_order", nameOrder).Error; err != nil {
		t.Fatalf("set vault name order: %v", err)
	}
	firstName, lastName, nickname := "Ada", "Lovelace", "Enchantress"
	contact := models.Contact{VaultID: ctx.vaultID, FirstName: &firstName, LastName: &lastName, Nickname: &nickname}
	if err := db.Create(&contact).Error; err != nil {
		t.Fatalf("create contact: %v", err)
	}
	note := models.Note{VaultID: ctx.vaultID, ContactID: contact.ID, Body: "A note"}
	if err := db.Create(&note).Error; err != nil {
		t.Fatalf("create note: %v", err)
	}
	sourceType := "Note"

	// When
	if err := NewFeedRecorder(db).Record(contact.ID, ctx.userID, ActionNoteCreated, "Created a note", &note.ID, &sourceType); err != nil {
		t.Fatalf("record feed event: %v", err)
	}

	// Then
	var row struct {
		VaultID             string
		ContactNameSnapshot string
		FeedableID          uint
		FeedableType        string
	}
	if err := db.Table("contact_feed_items").Select("vault_id, contact_name_snapshot, feedable_id, feedable_type").Where("contact_id = ?", contact.ID).Scan(&row).Error; err != nil {
		t.Fatalf("load event context: %v", err)
	}
	if row.VaultID != ctx.vaultID {
		t.Errorf("event vault_id = %q, want %q", row.VaultID, ctx.vaultID)
	}
	if row.ContactNameSnapshot != "Lovelace Ada(Enchantress)" {
		t.Errorf("contact snapshot = %q, want deterministic vault formatted name", row.ContactNameSnapshot)
	}
	if row.FeedableID != note.ID || row.FeedableType != sourceType {
		t.Errorf("source = (%s, %d), want (%s, %d)", row.FeedableType, row.FeedableID, sourceType, note.ID)
	}
}

func TestFeedKeepsEventInSourceVaultAndProjectsUnavailableHistory(t *testing.T) {
	// Given
	db := testutil.SetupTestDB(t)
	ctx := setupFeedEventHistoryContext(t, db, "move-history@example.com")
	otherVault, err := NewVaultService(db).CreateVault(ctx.accountID, ctx.userID, dto.CreateVaultRequest{Name: "Target Vault"}, "en")
	if err != nil {
		t.Fatalf("create target vault: %v", err)
	}
	firstName, lastName := "Original", "Name"
	contact := models.Contact{VaultID: ctx.vaultID, FirstName: &firstName, LastName: &lastName}
	if err := db.Create(&contact).Error; err != nil {
		t.Fatalf("create contact: %v", err)
	}
	note := models.Note{VaultID: ctx.vaultID, ContactID: contact.ID, Body: "A note"}
	if err := db.Create(&note).Error; err != nil {
		t.Fatalf("create note: %v", err)
	}
	sourceType := "Note"
	if err := NewFeedRecorder(db).Record(contact.ID, ctx.userID, ActionNoteCreated, "Created a note", &note.ID, &sourceType); err != nil {
		t.Fatalf("record feed event: %v", err)
	}
	if err := db.Model(&models.Contact{}).Where("id = ?", contact.ID).Update("vault_id", otherVault.ID).Error; err != nil {
		t.Fatalf("move contact directly: %v", err)
	}
	if err := db.Model(&models.Contact{}).Where("id = ?", contact.ID).Update("first_name", "Renamed").Error; err != nil {
		t.Fatalf("rename moved contact directly: %v", err)
	}
	if err := db.Model(&models.Note{}).Where("id = ?", note.ID).Update("vault_id", otherVault.ID).Error; err != nil {
		t.Fatalf("move note directly: %v", err)
	}

	// When
	sourceItems, _, err := NewFeedService(db).GetFeed(ctx.vaultID, 1, 15, ctx.userID)
	if err != nil {
		t.Fatalf("get source vault feed: %v", err)
	}
	targetItems, _, err := NewFeedService(db).GetFeed(otherVault.ID, 1, 15, ctx.userID)
	if err != nil {
		t.Fatalf("get target vault feed: %v", err)
	}

	// Then
	if len(sourceItems) != 1 {
		t.Fatalf("source vault event count = %d, want 1", len(sourceItems))
	}
	if len(targetItems) != 0 {
		t.Fatalf("target vault event count = %d, want 0", len(targetItems))
	}
	payload, err := json.Marshal(sourceItems[0])
	if err != nil {
		t.Fatalf("marshal feed item: %v", err)
	}
	var projected map[string]json.RawMessage
	if err := json.Unmarshal(payload, &projected); err != nil {
		t.Fatalf("unmarshal feed item: %v", err)
	}
	if string(projected["contact_linkable"]) != "false" {
		t.Errorf("moved contact linkability = %s, want false", projected["contact_linkable"])
	}
	if string(projected["contact_name"]) != `"Original Name"` {
		t.Errorf("moved contact name = %s, want snapshot", projected["contact_name"])
	}
	assertFeedSourceAvailability(t, projected, sourceType, note.ID, false)
}

func TestFeedProjectsExistingAndDeletedSources(t *testing.T) {
	// Given
	db := testutil.SetupTestDB(t)
	ctx := setupFeedEventHistoryContext(t, db, "source-availability@example.com")
	firstName := "Active"
	contact := models.Contact{VaultID: ctx.vaultID, FirstName: &firstName}
	if err := db.Create(&contact).Error; err != nil {
		t.Fatalf("create contact: %v", err)
	}
	note := models.Note{VaultID: ctx.vaultID, ContactID: contact.ID, Body: "A note"}
	if err := db.Create(&note).Error; err != nil {
		t.Fatalf("create note: %v", err)
	}
	sourceType := "Note"
	if err := NewFeedRecorder(db).Record(contact.ID, ctx.userID, ActionNoteCreated, "Created a note", &note.ID, &sourceType); err != nil {
		t.Fatalf("record existing source event: %v", err)
	}

	// When
	items, _, err := NewFeedService(db).GetFeed(ctx.vaultID, 1, 15, ctx.userID)
	if err != nil {
		t.Fatalf("get feed with existing source: %v", err)
	}

	// Then
	if len(items) != 1 {
		t.Fatalf("existing source event count = %d, want 1", len(items))
	}
	payload, err := json.Marshal(items[0])
	if err != nil {
		t.Fatalf("marshal existing source feed item: %v", err)
	}
	var projected map[string]json.RawMessage
	if err := json.Unmarshal(payload, &projected); err != nil {
		t.Fatalf("unmarshal existing source feed item: %v", err)
	}
	if string(projected["contact_linkable"]) != "true" {
		t.Errorf("active contact linkability = %s, want true", projected["contact_linkable"])
	}
	assertFeedSourceAvailability(t, projected, sourceType, note.ID, true)

	if err := db.Delete(&note).Error; err != nil {
		t.Fatalf("delete note: %v", err)
	}
	items, _, err = NewFeedService(db).GetFeed(ctx.vaultID, 1, 15, ctx.userID)
	if err != nil {
		t.Fatalf("get feed with deleted source: %v", err)
	}
	payload, err = json.Marshal(items[0])
	if err != nil {
		t.Fatalf("marshal deleted source feed item: %v", err)
	}
	if err := json.Unmarshal(payload, &projected); err != nil {
		t.Fatalf("unmarshal deleted source feed item: %v", err)
	}
	assertFeedSourceAvailability(t, projected, sourceType, note.ID, false)
}

func TestDeleteContactFeedPersistsEventContext(t *testing.T) {
	// Given
	db := testutil.SetupTestDB(t)
	ctx := setupFeedEventHistoryContext(t, db, "delete-feed-context@example.com")
	contactSvc := NewContactService(db)
	contactSvc.SetFeedRecorder(NewFeedRecorder(db))
	contact, err := contactSvc.CreateContact(ctx.vaultID, ctx.userID, dto.CreateContactRequest{FirstName: "Delete", LastName: "Snapshot"})
	if err != nil {
		t.Fatalf("create contact: %v", err)
	}

	// When
	if err := contactSvc.DeleteContact(contact.ID, ctx.vaultID); err != nil {
		t.Fatalf("delete contact: %v", err)
	}

	// Then
	var item models.ContactFeedItem
	if err := db.Where("contact_id = ? AND action = ?", contact.ID, ActionContactDeleted).First(&item).Error; err != nil {
		t.Fatalf("load delete feed item: %v", err)
	}
	if item.VaultID != ctx.vaultID || item.ContactNameSnapshot != "Delete Snapshot" {
		t.Errorf("delete event context = (%q, %q), want (%q, %q)", item.VaultID, item.ContactNameSnapshot, ctx.vaultID, "Delete Snapshot")
	}
	if item.FeedableID != nil || item.FeedableType != nil {
		t.Errorf("delete event source = (%v, %v), want nil", item.FeedableID, item.FeedableType)
	}
}

func TestFeedHidesOrphanLegacyRows(t *testing.T) {
	// Given
	db := testutil.SetupTestDB(t)
	ctx := setupFeedEventHistoryContext(t, db, "orphan-feed@example.com")
	if err := db.Create(&models.ContactFeedItem{ContactID: "missing-contact", Action: ActionContactCreated}).Error; err != nil {
		t.Fatalf("create orphan legacy feed item: %v", err)
	}

	// When
	items, meta, err := NewFeedService(db).GetFeed(ctx.vaultID, 1, 15, ctx.userID)

	// Then
	if err != nil {
		t.Fatalf("get vault feed: %v", err)
	}
	if len(items) != 0 || meta.Total != 0 {
		t.Errorf("orphan legacy feed visibility = (%d, %d), want (0, 0)", len(items), meta.Total)
	}
}

type feedEventHistoryContext struct {
	vaultID   string
	userID    string
	accountID string
}

func setupFeedEventHistoryContext(t *testing.T, db *gorm.DB, email string) feedEventHistoryContext {
	t.Helper()
	auth, err := NewAuthService(db, testutil.TestJWTConfig()).Register(dto.RegisterRequest{
		FirstName: "Test",
		LastName:  "User",
		Email:     email,
		Password:  "password123",
	}, "en")
	if err != nil {
		t.Fatalf("register user: %v", err)
	}
	vault, err := NewVaultService(db).CreateVault(auth.User.AccountID, auth.User.ID, dto.CreateVaultRequest{Name: "Source Vault"}, "en")
	if err != nil {
		t.Fatalf("create source vault: %v", err)
	}
	return feedEventHistoryContext{vaultID: vault.ID, userID: auth.User.ID, accountID: auth.User.AccountID}
}

func assertFeedSourceAvailability(t *testing.T, projected map[string]json.RawMessage, kind string, id uint, available bool) {
	t.Helper()
	var source struct {
		Kind      string `json:"kind"`
		ID        uint   `json:"id"`
		Available bool   `json:"available"`
	}
	if err := json.Unmarshal(projected["source"], &source); err != nil {
		t.Fatalf("unmarshal source metadata: %v", err)
	}
	if source.Kind != kind || source.ID != id || source.Available != available {
		t.Errorf("source = (%q, %d, %t), want (%q, %d, %t)", source.Kind, source.ID, source.Available, kind, id, available)
	}
}
