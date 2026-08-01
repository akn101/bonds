package services

import (
	"testing"
	"time"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/testutil"
	"gorm.io/gorm"
)

func setupJournalTest(t *testing.T) (*JournalService, string) {
	_, service, vaultID := setupJournalTestWithDB(t)
	return service, vaultID
}

func setupJournalTestWithDB(t *testing.T) (*gorm.DB, *JournalService, string) {
	t.Helper()
	db := testutil.SetupTestDB(t)
	cfg := testutil.TestJWTConfig()
	authSvc := NewAuthService(db, cfg)
	vaultSvc := NewVaultService(db)

	resp, err := authSvc.Register(dto.RegisterRequest{
		FirstName: "Test",
		LastName:  "User",
		Email:     "journal-test@example.com",
		Password:  "password123",
	}, "en")
	if err != nil {
		t.Fatalf("Register failed: %v", err)
	}

	vault, err := vaultSvc.CreateVault(resp.User.AccountID, resp.User.ID, dto.CreateVaultRequest{Name: "Test Vault"}, "en")
	if err != nil {
		t.Fatalf("CreateVault failed: %v", err)
	}

	return db, NewJournalService(db), vault.ID
}

func TestCreateJournal(t *testing.T) {
	svc, vaultID := setupJournalTest(t)

	journal, err := svc.Create(vaultID, dto.CreateJournalRequest{
		Name:        "My Journal",
		Description: "A daily journal",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if journal.Name != "My Journal" {
		t.Errorf("Expected name 'My Journal', got '%s'", journal.Name)
	}
	if journal.Description != "A daily journal" {
		t.Errorf("Expected description 'A daily journal', got '%s'", journal.Description)
	}
	if journal.VaultID != vaultID {
		t.Errorf("Expected vault_id '%s', got '%s'", vaultID, journal.VaultID)
	}
	if journal.PostCount != 0 {
		t.Errorf("Expected post_count 0, got %d", journal.PostCount)
	}
	if journal.ID == 0 {
		t.Error("Expected journal ID to be non-zero")
	}
}

func TestListJournals(t *testing.T) {
	svc, vaultID := setupJournalTest(t)

	_, err := svc.Create(vaultID, dto.CreateJournalRequest{Name: "Journal 1"})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	_, err = svc.Create(vaultID, dto.CreateJournalRequest{Name: "Journal 2"})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	journals, err := svc.List(vaultID)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(journals) != 2 {
		t.Errorf("Expected 2 journals, got %d", len(journals))
	}
}

func TestGetJournal(t *testing.T) {
	svc, vaultID := setupJournalTest(t)

	created, err := svc.Create(vaultID, dto.CreateJournalRequest{Name: "Get Me"})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	got, err := svc.Get(created.ID, vaultID)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got.Name != "Get Me" {
		t.Errorf("Expected name 'Get Me', got '%s'", got.Name)
	}
	if got.ID != created.ID {
		t.Errorf("Expected ID %d, got %d", created.ID, got.ID)
	}
}

func TestUpdateJournal(t *testing.T) {
	svc, vaultID := setupJournalTest(t)

	created, err := svc.Create(vaultID, dto.CreateJournalRequest{Name: "Original"})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	updated, err := svc.Update(created.ID, vaultID, dto.UpdateJournalRequest{
		Name:        "Updated",
		Description: "New description",
	})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if updated.Name != "Updated" {
		t.Errorf("Expected name 'Updated', got '%s'", updated.Name)
	}
	if updated.Description != "New description" {
		t.Errorf("Expected description 'New description', got '%s'", updated.Description)
	}
}

func TestDeleteJournal(t *testing.T) {
	svc, vaultID := setupJournalTest(t)

	created, err := svc.Create(vaultID, dto.CreateJournalRequest{Name: "To delete"})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if err := svc.Delete(created.ID, vaultID); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	journals, err := svc.List(vaultID)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(journals) != 0 {
		t.Errorf("Expected 0 journals after delete, got %d", len(journals))
	}
}

func TestJournalGetByYearReturnsPostContacts(t *testing.T) {
	db, svc, vaultID := setupJournalTestWithDB(t)
	journal, err := svc.Create(vaultID, dto.CreateJournalRequest{Name: "Yearly journal"})
	if err != nil {
		t.Fatalf("create journal: %v", err)
	}
	contact := models.Contact{VaultID: vaultID, FirstName: strPtrOrNil("Alice")}
	if err := db.Create(&contact).Error; err != nil {
		t.Fatalf("create contact: %v", err)
	}
	post := models.Post{
		JournalID: journal.ID,
		Title:     strPtrOrNil("Lunch with Alice"),
		WrittenAt: time.Date(2025, time.January, 15, 0, 0, 0, 0, time.UTC),
	}
	if err := db.Create(&post).Error; err != nil {
		t.Fatalf("create post: %v", err)
	}
	if err := db.Create(&models.ContactPost{PostID: post.ID, ContactID: contact.ID}).Error; err != nil {
		t.Fatalf("associate contact with post: %v", err)
	}

	posts, err := svc.GetByYear(journal.ID, vaultID, 2025)
	if err != nil {
		t.Fatalf("get posts by year: %v", err)
	}
	if len(posts) != 1 {
		t.Fatalf("posts = %d, want 1", len(posts))
	}
	if len(posts[0].Contacts) != 1 || posts[0].Contacts[0].ID != contact.ID {
		t.Fatalf("post contacts = %+v, want only %q", posts[0].Contacts, contact.ID)
	}
}

func TestJournalDeleteRemovesPostChildren(t *testing.T) {
	db, svc, vaultID := setupJournalTestWithDB(t)
	journal, err := svc.Create(vaultID, dto.CreateJournalRequest{Name: "Delete children"})
	if err != nil {
		t.Fatalf("create journal: %v", err)
	}
	contact := models.Contact{VaultID: vaultID, FirstName: strPtrOrNil("Alice")}
	if err := db.Create(&contact).Error; err != nil {
		t.Fatalf("create contact: %v", err)
	}
	posts := []models.Post{
		{JournalID: journal.ID, WrittenAt: time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC)},
		{JournalID: journal.ID, WrittenAt: time.Date(2025, time.January, 2, 0, 0, 0, 0, time.UTC)},
	}
	if err := db.Create(&posts).Error; err != nil {
		t.Fatalf("create posts: %v", err)
	}
	postIDs := []uint{posts[0].ID, posts[1].ID}
	sections := []models.PostSection{
		{PostID: posts[0].ID, Position: 1, Label: "First"},
		{PostID: posts[1].ID, Position: 1, Label: "Second"},
	}
	if err := db.Create(&sections).Error; err != nil {
		t.Fatalf("create post sections: %v", err)
	}
	associations := []models.ContactPost{
		{PostID: posts[0].ID, ContactID: contact.ID},
		{PostID: posts[1].ID, ContactID: contact.ID},
	}
	if err := db.Create(&associations).Error; err != nil {
		t.Fatalf("associate contacts with posts: %v", err)
	}

	if err := svc.Delete(journal.ID, vaultID); err != nil {
		t.Fatalf("delete journal: %v", err)
	}

	var associationCount int64
	if err := db.Model(&models.ContactPost{}).Where("post_id IN ?", postIDs).Count(&associationCount).Error; err != nil {
		t.Fatalf("count contact post associations: %v", err)
	}
	if associationCount != 0 {
		t.Fatalf("contact post associations = %d, want 0", associationCount)
	}
	var sectionCount int64
	if err := db.Model(&models.PostSection{}).Where("post_id IN ?", postIDs).Count(&sectionCount).Error; err != nil {
		t.Fatalf("count post sections: %v", err)
	}
	if sectionCount != 0 {
		t.Fatalf("post sections = %d, want 0", sectionCount)
	}
}

func TestJournalNotFound(t *testing.T) {
	svc, vaultID := setupJournalTest(t)

	_, err := svc.Get(9999, vaultID)
	if err != ErrJournalNotFound {
		t.Errorf("Expected ErrJournalNotFound, got %v", err)
	}

	_, err = svc.Update(9999, vaultID, dto.UpdateJournalRequest{Name: "nope"})
	if err != ErrJournalNotFound {
		t.Errorf("Expected ErrJournalNotFound, got %v", err)
	}

	err = svc.Delete(9999, vaultID)
	if err != ErrJournalNotFound {
		t.Errorf("Expected ErrJournalNotFound, got %v", err)
	}
}
