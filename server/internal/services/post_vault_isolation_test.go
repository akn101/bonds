package services

import (
	"testing"
	"time"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
)

func TestPostListOmitsForeignVaultContactsFromMalformedPivots(t *testing.T) {
	ctx := setupPostTestFull(t)
	post, err := ctx.svc.Create(ctx.journalID, ctx.vaultID, dto.CreatePostRequest{
		Title:     "Private entry",
		WrittenAt: time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("create post: %v", err)
	}
	localContact := models.Contact{VaultID: ctx.vaultID, FirstName: strPtrOrNil("Alice")}
	if err := ctx.db.Create(&localContact).Error; err != nil {
		t.Fatalf("create local contact: %v", err)
	}
	foreignContact := models.Contact{VaultID: "foreign-vault", FirstName: strPtrOrNil("Mallory")}
	if err := ctx.db.Create(&foreignContact).Error; err != nil {
		t.Fatalf("create foreign contact: %v", err)
	}
	if err := ctx.db.Create(&[]models.ContactPost{
		{PostID: post.ID, ContactID: localContact.ID},
		{PostID: post.ID, ContactID: foreignContact.ID},
	}).Error; err != nil {
		t.Fatalf("create malformed contact post pivots: %v", err)
	}

	posts, err := ctx.svc.List(ctx.journalID, ctx.vaultID)
	if err != nil {
		t.Fatalf("list posts: %v", err)
	}
	if len(posts) != 1 {
		t.Fatalf("posts = %d, want 1", len(posts))
	}
	if len(posts[0].Contacts) != 1 || posts[0].Contacts[0].ID != localContact.ID {
		t.Fatalf("post contacts = %+v, want only local contact %q", posts[0].Contacts, localContact.ID)
	}
}

func TestPostGetOmitsForeignVaultContactsFromMalformedPivots(t *testing.T) {
	ctx := setupPostTestFull(t)
	post, err := ctx.svc.Create(ctx.journalID, ctx.vaultID, dto.CreatePostRequest{
		Title:     "Private entry",
		WrittenAt: time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("create post: %v", err)
	}
	localContact := models.Contact{VaultID: ctx.vaultID, FirstName: strPtrOrNil("Alice")}
	if err := ctx.db.Create(&localContact).Error; err != nil {
		t.Fatalf("create local contact: %v", err)
	}
	foreignContact := models.Contact{VaultID: "foreign-vault", FirstName: strPtrOrNil("Mallory")}
	if err := ctx.db.Create(&foreignContact).Error; err != nil {
		t.Fatalf("create foreign contact: %v", err)
	}
	if err := ctx.db.Create(&[]models.ContactPost{
		{PostID: post.ID, ContactID: localContact.ID},
		{PostID: post.ID, ContactID: foreignContact.ID},
	}).Error; err != nil {
		t.Fatalf("create malformed contact post pivots: %v", err)
	}

	got, err := ctx.svc.Get(post.ID, ctx.journalID, ctx.vaultID)
	if err != nil {
		t.Fatalf("get post: %v", err)
	}
	if len(got.Contacts) != 1 || got.Contacts[0].ID != localContact.ID {
		t.Fatalf("post contacts = %+v, want only local contact %q", got.Contacts, localContact.ID)
	}
}
