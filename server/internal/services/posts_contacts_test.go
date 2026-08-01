package services

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
)

func TestPostCreateAssociatesContactsAndAdvancesLastContacted(t *testing.T) {
	ctx := setupPostTestFull(t)
	frequencyDays := 7
	contact := models.Contact{
		VaultID:                  ctx.vaultID,
		FirstName:                strPtrOrNil("Alice"),
		StayInTouchFrequencyDays: &frequencyDays,
	}
	if err := ctx.db.Create(&contact).Error; err != nil {
		t.Fatalf("create contact: %v", err)
	}

	writtenAt := time.Date(2025, time.January, 15, 10, 30, 0, 0, time.UTC)
	post, err := ctx.svc.Create(ctx.journalID, ctx.vaultID, dto.CreatePostRequest{
		Title:               "Lunch with Alice",
		WrittenAt:           writtenAt,
		ContactIDs:          []string{contact.ID, contact.ID},
		UpdateLastContacted: true,
	})
	if err != nil {
		t.Fatalf("create post: %v", err)
	}

	if len(post.Contacts) != 1 || post.Contacts[0].ID != contact.ID {
		t.Fatalf("post contacts = %+v, want only %q", post.Contacts, contact.ID)
	}
	var pivotCount int64
	if err := ctx.db.Model(&models.ContactPost{}).
		Where("post_id = ? AND contact_id = ?", post.ID, contact.ID).
		Count(&pivotCount).Error; err != nil {
		t.Fatalf("count contact post pivots: %v", err)
	}
	if pivotCount != 1 {
		t.Fatalf("contact post pivots = %d, want 1", pivotCount)
	}

	var updatedContact models.Contact
	if err := ctx.db.First(&updatedContact, "id = ?", contact.ID).Error; err != nil {
		t.Fatalf("reload contact: %v", err)
	}
	if updatedContact.LastTalkedTo == nil || !updatedContact.LastTalkedTo.Equal(writtenAt) {
		t.Fatalf("last_talked_to = %v, want %v", updatedContact.LastTalkedTo, writtenAt)
	}
	wantTrigger := writtenAt.AddDate(0, 0, frequencyDays)
	if updatedContact.StayInTouchTriggerDate == nil || !updatedContact.StayInTouchTriggerDate.Equal(wantTrigger) {
		t.Fatalf("stay_in_touch_trigger_date = %v, want %v", updatedContact.StayInTouchTriggerDate, wantTrigger)
	}
	if updatedContact.LastUpdatedAt == nil {
		t.Fatal("last_updated_at should be set when the post advances last_talked_to")
	}
}

func TestPostUpdateRejectsCrossVaultContactsAtomically(t *testing.T) {
	ctx := setupPostTestFull(t)
	contact := models.Contact{VaultID: ctx.vaultID, FirstName: strPtrOrNil("Alice")}
	if err := ctx.db.Create(&contact).Error; err != nil {
		t.Fatalf("create vault contact: %v", err)
	}
	foreignContact := models.Contact{VaultID: "foreign-vault", FirstName: strPtrOrNil("Mallory")}
	if err := ctx.db.Create(&foreignContact).Error; err != nil {
		t.Fatalf("create foreign contact: %v", err)
	}
	post, err := ctx.svc.Create(ctx.journalID, ctx.vaultID, dto.CreatePostRequest{
		Title:      "Original",
		WrittenAt:  time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC),
		ContactIDs: []string{contact.ID},
	})
	if err != nil {
		t.Fatalf("create post: %v", err)
	}

	_, err = ctx.svc.Update(post.ID, ctx.journalID, ctx.vaultID, dto.UpdatePostRequest{
		Title:      "Injected",
		ContactIDs: []string{foreignContact.ID},
	})
	if !errors.Is(err, ErrContactNotFound) {
		t.Fatalf("update error = %v, want ErrContactNotFound", err)
	}

	var storedPost models.Post
	if err := ctx.db.First(&storedPost, "id = ?", post.ID).Error; err != nil {
		t.Fatalf("reload post: %v", err)
	}
	if ptrToStr(storedPost.Title) != "Original" {
		t.Fatalf("post title = %q, want Original", ptrToStr(storedPost.Title))
	}

	var originalPivotCount int64
	if err := ctx.db.Model(&models.ContactPost{}).
		Where("post_id = ? AND contact_id = ?", post.ID, contact.ID).
		Count(&originalPivotCount).Error; err != nil {
		t.Fatalf("count original pivot: %v", err)
	}
	if originalPivotCount != 1 {
		t.Fatalf("original pivot count = %d, want 1", originalPivotCount)
	}

	var foreignPivotCount int64
	if err := ctx.db.Model(&models.ContactPost{}).
		Where("post_id = ? AND contact_id = ?", post.ID, foreignContact.ID).
		Count(&foreignPivotCount).Error; err != nil {
		t.Fatalf("count foreign pivot: %v", err)
	}
	if foreignPivotCount != 0 {
		t.Fatalf("foreign pivot count = %d, want 0", foreignPivotCount)
	}
}

func TestPostUpdateAdvancesLastContactedWithoutRegression(t *testing.T) {
	ctx := setupPostTestFull(t)
	contact := models.Contact{VaultID: ctx.vaultID, FirstName: strPtrOrNil("Alice")}
	if err := ctx.db.Create(&contact).Error; err != nil {
		t.Fatalf("create contact: %v", err)
	}
	post, err := ctx.svc.Create(ctx.journalID, ctx.vaultID, dto.CreatePostRequest{
		Title:      "Conversation",
		WrittenAt:  time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC),
		ContactIDs: []string{contact.ID},
	})
	if err != nil {
		t.Fatalf("create post: %v", err)
	}

	newerDate := time.Date(2025, time.February, 1, 0, 0, 0, 0, time.UTC)
	if _, err := ctx.svc.Update(post.ID, ctx.journalID, ctx.vaultID, dto.UpdatePostRequest{
		Title:               "Conversation",
		WrittenAt:           newerDate,
		UpdateLastContacted: true,
	}); err != nil {
		t.Fatalf("advance last contacted: %v", err)
	}

	olderDate := time.Date(2025, time.January, 15, 0, 0, 0, 0, time.UTC)
	if _, err := ctx.svc.Update(post.ID, ctx.journalID, ctx.vaultID, dto.UpdatePostRequest{
		Title:               "Conversation",
		WrittenAt:           olderDate,
		UpdateLastContacted: true,
	}); err != nil {
		t.Fatalf("update with older date: %v", err)
	}

	var updatedContact models.Contact
	if err := ctx.db.First(&updatedContact, "id = ?", contact.ID).Error; err != nil {
		t.Fatalf("reload contact: %v", err)
	}
	if updatedContact.LastTalkedTo == nil || !updatedContact.LastTalkedTo.Equal(newerDate) {
		t.Fatalf("last_talked_to = %v, want %v", updatedContact.LastTalkedTo, newerDate)
	}
}

func TestPostServiceRejectsJournalOutsideVault(t *testing.T) {
	ctx := setupPostTestFull(t)

	_, err := ctx.svc.Create(ctx.journalID, "foreign-vault", dto.CreatePostRequest{
		Title:     "Blocked",
		WrittenAt: time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC),
	})
	if !errors.Is(err, ErrJournalNotFound) {
		t.Fatalf("create error = %v, want ErrJournalNotFound", err)
	}

	_, err = ctx.svc.List(ctx.journalID, "foreign-vault")
	if !errors.Is(err, ErrJournalNotFound) {
		t.Fatalf("list error = %v, want ErrJournalNotFound", err)
	}
}

func TestPostCreateRejectsMoreThanFiveHundredRawIDsBeforeDeduplication(t *testing.T) {
	ctx := setupPostTestFull(t)
	contactID := uuid.NewString()
	contactIDs := make([]string, 501)
	for index := range contactIDs {
		contactIDs[index] = contactID
	}

	_, err := ctx.svc.Create(ctx.journalID, ctx.vaultID, dto.CreatePostRequest{
		Title:      "Over limit",
		WrittenAt:  time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC),
		ContactIDs: contactIDs,
	})

	if !errors.Is(err, ErrContactIDsLimitExceeded) {
		t.Fatalf("more than 500 raw IDs error = %v, want ErrContactIDsLimitExceeded", err)
	}
}

func TestPostCreateRejectsInvalidAndEmptyUUIDs(t *testing.T) {
	ctx := setupPostTestFull(t)
	tests := []struct {
		name       string
		contactIDs []string
	}{
		{name: "invalid UUID", contactIDs: []string{"not-a-uuid"}},
		{name: "empty UUID", contactIDs: []string{""}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ctx.svc.Create(ctx.journalID, ctx.vaultID, dto.CreatePostRequest{
				Title:      "Invalid contact",
				WrittenAt:  time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC),
				ContactIDs: test.contactIDs,
			})

			if !errors.Is(err, ErrContactIDInvalid) {
				t.Fatalf("invalid contact ID error = %v, want ErrContactIDInvalid", err)
			}
		})
	}
}

func TestPostUpdateRejectsMoreThanFiveHundredRawIDsBeforeDeduplication(t *testing.T) {
	ctx := setupPostTestFull(t)
	post, err := ctx.svc.Create(ctx.journalID, ctx.vaultID, dto.CreatePostRequest{
		Title:     "Existing",
		WrittenAt: time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("create post: %v", err)
	}
	contactID := uuid.NewString()
	contactIDs := make([]string, 501)
	for index := range contactIDs {
		contactIDs[index] = contactID
	}

	_, err = ctx.svc.Update(post.ID, ctx.journalID, ctx.vaultID, dto.UpdatePostRequest{
		Title:      "Over limit",
		ContactIDs: contactIDs,
	})

	if !errors.Is(err, ErrContactIDsLimitExceeded) {
		t.Fatalf("more than 500 raw IDs error = %v, want ErrContactIDsLimitExceeded", err)
	}
}

func TestPostUpdateRejectsInvalidAndEmptyUUIDs(t *testing.T) {
	ctx := setupPostTestFull(t)
	post, err := ctx.svc.Create(ctx.journalID, ctx.vaultID, dto.CreatePostRequest{
		Title:     "Existing",
		WrittenAt: time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("create post: %v", err)
	}
	tests := []struct {
		name       string
		contactIDs []string
	}{
		{name: "invalid UUID", contactIDs: []string{"not-a-uuid"}},
		{name: "empty UUID", contactIDs: []string{""}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ctx.svc.Update(post.ID, ctx.journalID, ctx.vaultID, dto.UpdatePostRequest{
				Title:      "Invalid contact",
				ContactIDs: test.contactIDs,
			})

			if !errors.Is(err, ErrContactIDInvalid) {
				t.Fatalf("invalid contact ID error = %v, want ErrContactIDInvalid", err)
			}
		})
	}
}

func TestPostUpdateKeepsContactsWhenContactIDsAreNil(t *testing.T) {
	ctx := setupPostTestFull(t)
	contact := models.Contact{VaultID: ctx.vaultID, FirstName: strPtrOrNil("Alice")}
	if err := ctx.db.Create(&contact).Error; err != nil {
		t.Fatalf("create contact: %v", err)
	}
	post, err := ctx.svc.Create(ctx.journalID, ctx.vaultID, dto.CreatePostRequest{
		Title:      "Existing",
		WrittenAt:  time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC),
		ContactIDs: []string{contact.ID},
	})
	if err != nil {
		t.Fatalf("create post: %v", err)
	}

	updated, err := ctx.svc.Update(post.ID, ctx.journalID, ctx.vaultID, dto.UpdatePostRequest{Title: "Renamed"})
	if err != nil {
		t.Fatalf("update post: %v", err)
	}

	if len(updated.Contacts) != 1 || updated.Contacts[0].ID != contact.ID {
		t.Fatalf("post contacts after omitted contact_ids = %+v, want only %q", updated.Contacts, contact.ID)
	}
}

func TestPostResponseReturnsNicknameOnlyContact(t *testing.T) {
	ctx := setupPostTestFull(t)
	contact := models.Contact{VaultID: ctx.vaultID, Nickname: strPtrOrNil("Handle")}
	if err := ctx.db.Create(&contact).Error; err != nil {
		t.Fatalf("create nickname-only contact: %v", err)
	}

	post, err := ctx.svc.Create(ctx.journalID, ctx.vaultID, dto.CreatePostRequest{
		Title:      "Conversation",
		WrittenAt:  time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC),
		ContactIDs: []string{contact.ID},
	})
	if err != nil {
		t.Fatalf("create post: %v", err)
	}
	if len(post.Contacts) != 1 {
		t.Fatalf("post contacts = %+v, want one contact", post.Contacts)
	}

	encodedContact, err := json.Marshal(post.Contacts[0])
	if err != nil {
		t.Fatalf("marshal post contact response: %v", err)
	}
	var response map[string]string
	if err := json.Unmarshal(encodedContact, &response); err != nil {
		t.Fatalf("unmarshal post contact response: %v", err)
	}
	if response["nickname"] != "Handle" {
		t.Fatalf("nickname = %q, want Handle", response["nickname"])
	}
}

func TestPostResponseIncludesAllContactNameFields(t *testing.T) {
	ctx := setupPostTestFull(t)
	contact := models.Contact{
		VaultID:    ctx.vaultID,
		FirstName:  strPtrOrNil("John"),
		MiddleName: strPtrOrNil("Michael"),
		LastName:   strPtrOrNil("Doe"),
		Nickname:   strPtrOrNil("Johnny"),
		MaidenName: strPtrOrNil("Smith"),
		Prefix:     strPtrOrNil("Dr."),
		Suffix:     strPtrOrNil("Jr."),
	}
	if err := ctx.db.Create(&contact).Error; err != nil {
		t.Fatalf("create contact: %v", err)
	}
	post, err := ctx.svc.Create(ctx.journalID, ctx.vaultID, dto.CreatePostRequest{
		Title:      "Conversation",
		WrittenAt:  time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC),
		ContactIDs: []string{contact.ID},
	})
	if err != nil {
		t.Fatalf("create post: %v", err)
	}

	encodedContact, err := json.Marshal(post.Contacts[0])
	if err != nil {
		t.Fatalf("marshal post contact response: %v", err)
	}
	var response map[string]string
	if err := json.Unmarshal(encodedContact, &response); err != nil {
		t.Fatalf("unmarshal post contact response: %v", err)
	}
	want := map[string]string{
		"first_name":  "John",
		"middle_name": "Michael",
		"last_name":   "Doe",
		"nickname":    "Johnny",
		"maiden_name": "Smith",
		"prefix":      "Dr.",
		"suffix":      "Jr.",
	}
	for field, expected := range want {
		if response[field] != expected {
			t.Errorf("%s = %q, want %q", field, response[field], expected)
		}
	}
}
