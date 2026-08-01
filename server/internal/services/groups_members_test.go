package services

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
)

func TestGroupAddMembersDeduplicatesAndIsIdempotent(t *testing.T) {
	ctx := setupGroupTest(t)
	group, err := ctx.svc.Create(ctx.vaultID, dto.CreateGroupRequest{Name: "Friends"})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	firstContact := models.Contact{VaultID: ctx.vaultID, FirstName: strPtrOrNil("Alice")}
	secondContact := models.Contact{VaultID: ctx.vaultID, FirstName: strPtrOrNil("Bob")}
	if err := ctx.db.Create(&firstContact).Error; err != nil {
		t.Fatalf("create first contact: %v", err)
	}
	if err := ctx.db.Create(&secondContact).Error; err != nil {
		t.Fatalf("create second contact: %v", err)
	}

	affectedCount, err := ctx.svc.AddMembers(group.ID, ctx.vaultID, dto.GroupMembersRequest{
		ContactIDs: []string{firstContact.ID, secondContact.ID, firstContact.ID},
	})
	if err != nil {
		t.Fatalf("add members: %v", err)
	}
	if affectedCount != 2 {
		t.Fatalf("affected count = %d, want 2", affectedCount)
	}

	affectedCount, err = ctx.svc.AddMembers(group.ID, ctx.vaultID, dto.GroupMembersRequest{
		ContactIDs: []string{firstContact.ID, secondContact.ID},
	})
	if err != nil {
		t.Fatalf("repeat add members: %v", err)
	}
	if affectedCount != 0 {
		t.Fatalf("repeat affected count = %d, want 0", affectedCount)
	}

	var memberCount int64
	if err := ctx.db.Model(&models.ContactGroup{}).Where("group_id = ?", group.ID).Count(&memberCount).Error; err != nil {
		t.Fatalf("count members: %v", err)
	}
	if memberCount != 2 {
		t.Fatalf("member count = %d, want 2", memberCount)
	}
}

func TestGroupRemoveMembersRejectsForeignContactAtomically(t *testing.T) {
	ctx := setupGroupTest(t)
	group, err := ctx.svc.Create(ctx.vaultID, dto.CreateGroupRequest{Name: "Friends"})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	firstContact := models.Contact{VaultID: ctx.vaultID, FirstName: strPtrOrNil("Alice")}
	secondContact := models.Contact{VaultID: ctx.vaultID, FirstName: strPtrOrNil("Bob")}
	foreignContact := models.Contact{VaultID: "foreign-vault", FirstName: strPtrOrNil("Mallory")}
	for _, contact := range []*models.Contact{&firstContact, &secondContact, &foreignContact} {
		if err := ctx.db.Create(contact).Error; err != nil {
			t.Fatalf("create contact: %v", err)
		}
	}
	if _, err := ctx.svc.AddMembers(group.ID, ctx.vaultID, dto.GroupMembersRequest{
		ContactIDs: []string{firstContact.ID, secondContact.ID},
	}); err != nil {
		t.Fatalf("seed members: %v", err)
	}

	_, err = ctx.svc.RemoveMembers(group.ID, ctx.vaultID, dto.GroupMembersRequest{
		ContactIDs: []string{firstContact.ID, foreignContact.ID},
	})
	if !errors.Is(err, ErrContactNotFound) {
		t.Fatalf("remove error = %v, want ErrContactNotFound", err)
	}

	var memberCount int64
	if err := ctx.db.Model(&models.ContactGroup{}).Where("group_id = ?", group.ID).Count(&memberCount).Error; err != nil {
		t.Fatalf("count members after rejected remove: %v", err)
	}
	if memberCount != 2 {
		t.Fatalf("member count after rejected remove = %d, want 2", memberCount)
	}

	affectedCount, err := ctx.svc.RemoveMembers(group.ID, ctx.vaultID, dto.GroupMembersRequest{
		ContactIDs: []string{firstContact.ID, firstContact.ID},
	})
	if err != nil {
		t.Fatalf("remove member: %v", err)
	}
	if affectedCount != 1 {
		t.Fatalf("affected count = %d, want 1", affectedCount)
	}
}

func TestGroupMembersRejectMoreThanFiveHundredRawIDsBeforeDeduplication(t *testing.T) {
	ctx := setupGroupTest(t)
	group, err := ctx.svc.Create(ctx.vaultID, dto.CreateGroupRequest{Name: "Friends"})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}

	_, err = ctx.svc.AddMembers(group.ID, ctx.vaultID, dto.GroupMembersRequest{})
	if !errors.Is(err, ErrGroupMembersEmpty) {
		t.Fatalf("empty members error = %v, want ErrGroupMembersEmpty", err)
	}

	contactID := uuid.NewString()
	contactIDs := make([]string, 501)
	for index := range contactIDs {
		contactIDs[index] = contactID
	}
	_, err = ctx.svc.AddMembers(group.ID, ctx.vaultID, dto.GroupMembersRequest{ContactIDs: contactIDs})
	if !errors.Is(err, ErrGroupMembersLimitExceeded) {
		t.Fatalf("more than 500 raw IDs error = %v, want ErrGroupMembersLimitExceeded", err)
	}
}

func TestGroupMembersRejectInvalidAndEmptyUUIDs(t *testing.T) {
	ctx := setupGroupTest(t)
	group, err := ctx.svc.Create(ctx.vaultID, dto.CreateGroupRequest{Name: "Friends"})
	if err != nil {
		t.Fatalf("create group: %v", err)
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
			_, err := ctx.svc.AddMembers(group.ID, ctx.vaultID, dto.GroupMembersRequest{ContactIDs: test.contactIDs})

			if !errors.Is(err, ErrContactIDInvalid) {
				t.Fatalf("invalid contact ID error = %v, want ErrContactIDInvalid", err)
			}
		})
	}
}
