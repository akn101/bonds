package services

import (
	"strconv"
	"testing"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/search"
)

func TestSearchService_hydrates_note_only_results_when_index_has_no_contact_hits(t *testing.T) {
	// Given
	ctx := setupNameOrderRegressionTest(t, "search-note-only-hydration@example.com")
	note := models.Note{ContactID: ctx.contact.ID, VaultID: ctx.vaultID, Body: "authoritative note"}
	if err := ctx.db.Create(&note).Error; err != nil {
		t.Fatalf("Create note failed: %v", err)
	}
	engine := &fixedSearchResultsEngine{response: search.SearchResponse{
		Contacts: []search.SearchResult{},
		Notes: []search.SearchResult{{
			ID:        strconv.FormatUint(uint64(note.ID), 10),
			Type:      "note",
			Name:      "indexed title",
			ContactID: "stale-indexed-contact",
			Score:     1,
		}},
		Total: 1,
	}}
	service := NewSearchServiceWithDB(ctx.db, engine)

	// When
	result, err := service.SearchForUser(ctx.vaultID, ctx.userID, "note", 1, 20)
	if err != nil {
		t.Fatalf("SearchForUser failed: %v", err)
	}

	// Then
	if len(result.Contacts) != 0 {
		t.Fatalf("expected no contact results, got %+v", result.Contacts)
	}
	if len(result.Notes) != 1 {
		t.Fatalf("expected 1 note result, got %+v", result.Notes)
	}
	if result.Notes[0].ContactID != ctx.contact.ID {
		t.Fatalf("note contact_id = %q, want authoritative database value %q", result.Notes[0].ContactID, ctx.contact.ID)
	}
	if result.Notes[0].Name != "indexed title" {
		t.Fatalf("note name = %q, want indexed title %q", result.Notes[0].Name, "indexed title")
	}
	if result.Total != 1 {
		t.Fatalf("total = %d, want 1", result.Total)
	}
}

func TestSearchService_filters_stale_results_and_preserves_order_when_index_returns_mixed_hits(t *testing.T) {
	// Given
	ctx := setupNameOrderRegressionTest(t, "search-result-hydration@example.com")
	secondContact, err := NewContactService(ctx.db).CreateContact(ctx.vaultID, ctx.userID, dto.CreateContactRequest{
		FirstName: "Bob",
		LastName:  "Yellow",
	})
	if err != nil {
		t.Fatalf("Create second contact failed: %v", err)
	}
	otherVault, err := NewVaultService(ctx.db).CreateVault(loadAccountID(t, ctx.db, ctx.userID), ctx.userID, dto.CreateVaultRequest{Name: "Other Vault"}, "en")
	if err != nil {
		t.Fatalf("Create other vault failed: %v", err)
	}
	otherContact, err := NewContactService(ctx.db).CreateContact(otherVault.ID, ctx.userID, dto.CreateContactRequest{
		FirstName: "Eve",
		LastName:  "Outside",
	})
	if err != nil {
		t.Fatalf("Create other-vault contact failed: %v", err)
	}
	firstNote := models.Note{ContactID: ctx.contact.ID, VaultID: ctx.vaultID, Body: "first valid note"}
	if err := ctx.db.Create(&firstNote).Error; err != nil {
		t.Fatalf("Create first note failed: %v", err)
	}
	secondNote := models.Note{ContactID: secondContact.ID, VaultID: ctx.vaultID, Body: "second valid note"}
	if err := ctx.db.Create(&secondNote).Error; err != nil {
		t.Fatalf("Create second note failed: %v", err)
	}
	deletedNote := models.Note{ContactID: ctx.contact.ID, VaultID: ctx.vaultID, Body: "deleted note"}
	if err := ctx.db.Create(&deletedNote).Error; err != nil {
		t.Fatalf("Create deleted note failed: %v", err)
	}
	if err := ctx.db.Delete(&deletedNote).Error; err != nil {
		t.Fatalf("Delete note failed: %v", err)
	}
	crossVaultNote := models.Note{ContactID: otherContact.ID, VaultID: otherVault.ID, Body: "cross-vault note"}
	if err := ctx.db.Create(&crossVaultNote).Error; err != nil {
		t.Fatalf("Create cross-vault note failed: %v", err)
	}
	unlistedContact, err := NewContactService(ctx.db).CreateContact(ctx.vaultID, ctx.userID, dto.CreateContactRequest{
		FirstName: "Hidden",
		LastName:  "Shadow",
	})
	if err != nil {
		t.Fatalf("Create unlisted contact failed: %v", err)
	}
	if err := ctx.db.Model(&models.Contact{}).Where("id = ?", unlistedContact.ID).Update("listed", false).Error; err != nil {
		t.Fatalf("Unlist contact failed: %v", err)
	}
	unlistedContactNote := models.Note{ContactID: unlistedContact.ID, VaultID: ctx.vaultID, Body: "hidden contact note"}
	if err := ctx.db.Create(&unlistedContactNote).Error; err != nil {
		t.Fatalf("Create unlisted contact note failed: %v", err)
	}
	softDeletedContact, err := NewContactService(ctx.db).CreateContact(ctx.vaultID, ctx.userID, dto.CreateContactRequest{
		FirstName: "Deleted",
		LastName:  "Contact",
	})
	if err != nil {
		t.Fatalf("Create soft-deleted contact failed: %v", err)
	}
	softDeletedContactNote := models.Note{ContactID: softDeletedContact.ID, VaultID: ctx.vaultID, Body: "soft-deleted contact note"}
	if err := ctx.db.Create(&softDeletedContactNote).Error; err != nil {
		t.Fatalf("Create soft-deleted contact note failed: %v", err)
	}
	if err := ctx.db.Where("id = ?", softDeletedContact.ID).Delete(&models.Contact{}).Error; err != nil {
		t.Fatalf("Soft-delete contact failed: %v", err)
	}
	inconsistentVaultNote := models.Note{ContactID: otherContact.ID, VaultID: ctx.vaultID, Body: "inconsistent vault note"}
	if err := ctx.db.Create(&inconsistentVaultNote).Error; err != nil {
		t.Fatalf("Create inconsistent-vault note failed: %v", err)
	}
	missingContactNote := models.Note{ContactID: "missing-contact-id", VaultID: ctx.vaultID, Body: "missing contact note"}
	if err := ctx.db.Create(&missingContactNote).Error; err != nil {
		t.Fatalf("Create missing-contact note failed: %v", err)
	}
	engine := &fixedSearchResultsEngine{response: search.SearchResponse{
		Contacts: []search.SearchResult{
			{ID: secondContact.ID, Type: "contact", Name: "stale second contact", Score: 5},
			{ID: ctx.contact.ID, Type: "contact", Name: "stale first contact", Score: 4},
		},
		Notes: []search.SearchResult{
			{ID: strconv.FormatUint(uint64(secondNote.ID), 10), Type: "note", Name: "second indexed note", ContactID: "stale-contact-id", Score: 3},
			{ID: "not-a-note-id", Type: "note", Name: "malformed note", ContactID: ctx.contact.ID, Score: 2},
			{ID: "0", Type: "note", Name: "zero note", ContactID: ctx.contact.ID, Score: 2},
			{ID: "999999", Type: "note", Name: "stale note", ContactID: ctx.contact.ID, Score: 2},
			{ID: strconv.FormatUint(uint64(deletedNote.ID), 10), Type: "note", Name: "deleted note", ContactID: ctx.contact.ID, Score: 1},
			{ID: strconv.FormatUint(uint64(crossVaultNote.ID), 10), Type: "note", Name: "cross-vault note", ContactID: otherContact.ID, Score: 1},
			{ID: strconv.FormatUint(uint64(unlistedContactNote.ID), 10), Type: "note", Name: "unlisted contact note", ContactID: "stale-unlisted-contact", Score: 1},
			{ID: strconv.FormatUint(uint64(softDeletedContactNote.ID), 10), Type: "note", Name: "soft-deleted contact note", ContactID: "stale-deleted-contact", Score: 1},
			{ID: strconv.FormatUint(uint64(inconsistentVaultNote.ID), 10), Type: "note", Name: "inconsistent vault note", ContactID: "stale-cross-vault-contact", Score: 1},
			{ID: strconv.FormatUint(uint64(missingContactNote.ID), 10), Type: "note", Name: "missing contact note", ContactID: "stale-missing-contact", Score: 1},
			{ID: strconv.FormatUint(uint64(firstNote.ID), 10), Type: "note", Name: "first indexed note", ContactID: "other-stale-contact-id", Score: 1},
		},
		Total: 13,
	}}
	service := NewSearchServiceWithDB(ctx.db, engine)

	// When
	result, err := service.SearchForUser(ctx.vaultID, ctx.userID, "note", 1, 20)
	if err != nil {
		t.Fatalf("SearchForUser failed: %v", err)
	}

	// Then
	if len(result.Contacts) != 2 {
		t.Fatalf("expected 2 contact results, got %+v", result.Contacts)
	}
	if result.Contacts[0].ID != secondContact.ID || result.Contacts[1].ID != ctx.contact.ID {
		t.Fatalf("contact order = %+v, want [%q %q]", result.Contacts, secondContact.ID, ctx.contact.ID)
	}
	if result.Contacts[0].Name != "Yellow, Bob" || result.Contacts[1].Name != "Zephyr, Alice (Ace)" {
		t.Fatalf("formatted contact names = [%q %q]", result.Contacts[0].Name, result.Contacts[1].Name)
	}
	if len(result.Notes) != 2 {
		t.Fatalf("expected 2 note results, got %+v", result.Notes)
	}
	if result.Notes[0].ID != strconv.FormatUint(uint64(secondNote.ID), 10) || result.Notes[1].ID != strconv.FormatUint(uint64(firstNote.ID), 10) {
		t.Fatalf("note order = %+v, want [%d %d]", result.Notes, secondNote.ID, firstNote.ID)
	}
	if result.Notes[0].ContactID != secondContact.ID || result.Notes[1].ContactID != ctx.contact.ID {
		t.Fatalf("hydrated note contact IDs = [%q %q], want [%q %q]", result.Notes[0].ContactID, result.Notes[1].ContactID, secondContact.ID, ctx.contact.ID)
	}
	if result.Total != 4 {
		t.Fatalf("total = %d, want 4 after filtering malformed, zero, stale, deleted, cross-vault, missing-contact, unlisted-contact, soft-deleted-contact, and inconsistent-vault notes", result.Total)
	}
}

type fixedSearchResultsEngine struct {
	response search.SearchResponse
}

func (e *fixedSearchResultsEngine) IndexContact(id, vaultID, firstName, lastName, nickname, jobPosition string) error {
	return nil
}

func (e *fixedSearchResultsEngine) IndexNote(id string, vaultID, contactID, title, body string) error {
	return nil
}

func (e *fixedSearchResultsEngine) DeleteDocument(id string) error {
	return nil
}

func (e *fixedSearchResultsEngine) Search(vaultID, query string, limit, offset int) (*search.SearchResponse, error) {
	contacts := append([]search.SearchResult(nil), e.response.Contacts...)
	notes := append([]search.SearchResult(nil), e.response.Notes...)
	return &search.SearchResponse{
		Contacts: contacts,
		Notes:    notes,
		Total:    e.response.Total,
		TookMs:   e.response.TookMs,
	}, nil
}

func (e *fixedSearchResultsEngine) Rebuild() error {
	return nil
}

func (e *fixedSearchResultsEngine) Close() error {
	return nil
}
