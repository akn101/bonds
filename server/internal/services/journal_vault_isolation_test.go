package services

import (
	"testing"
	"time"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
)

func TestJournalGetByYearOmitsForeignVaultContactsFromMalformedPivots(t *testing.T) {
	db, svc, vaultID := setupJournalTestWithDB(t)
	journal, err := svc.Create(vaultID, dto.CreateJournalRequest{Name: "Private journal"})
	if err != nil {
		t.Fatalf("create journal: %v", err)
	}
	post := models.Post{
		JournalID: journal.ID,
		Title:     strPtrOrNil("Private entry"),
		WrittenAt: time.Date(2025, time.January, 15, 0, 0, 0, 0, time.UTC),
	}
	if err := db.Create(&post).Error; err != nil {
		t.Fatalf("create post: %v", err)
	}
	localContact := models.Contact{VaultID: vaultID, FirstName: strPtrOrNil("Alice")}
	if err := db.Create(&localContact).Error; err != nil {
		t.Fatalf("create local contact: %v", err)
	}
	foreignContact := models.Contact{VaultID: "foreign-vault", FirstName: strPtrOrNil("Mallory")}
	if err := db.Create(&foreignContact).Error; err != nil {
		t.Fatalf("create foreign contact: %v", err)
	}
	if err := db.Create(&[]models.ContactPost{
		{PostID: post.ID, ContactID: localContact.ID},
		{PostID: post.ID, ContactID: foreignContact.ID},
	}).Error; err != nil {
		t.Fatalf("create malformed contact post pivots: %v", err)
	}

	posts, err := svc.GetByYear(journal.ID, vaultID, 2025)
	if err != nil {
		t.Fatalf("get posts by year: %v", err)
	}
	if len(posts) != 1 {
		t.Fatalf("posts = %d, want 1", len(posts))
	}
	if len(posts[0].Contacts) != 1 || posts[0].Contacts[0].ID != localContact.ID {
		t.Fatalf("post contacts = %+v, want only local contact %q", posts[0].Contacts, localContact.ID)
	}
}
