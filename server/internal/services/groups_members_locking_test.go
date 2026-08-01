package services

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func TestGroupMemberMutationsLockContactsBeforeGroup(t *testing.T) {
	operations := []struct {
		name          string
		expectedCount int64
	}{
		{name: "add", expectedCount: 2},
		{name: "remove", expectedCount: 2},
	}
	for _, operation := range operations {
		t.Run(operation.name, func(t *testing.T) {
			ctx := setupGroupTest(t)
			group, err := ctx.svc.Create(ctx.vaultID, dto.CreateGroupRequest{Name: "Friends"})
			if err != nil {
				t.Fatalf("create group: %v", err)
			}
			firstContact := models.Contact{VaultID: ctx.vaultID, FirstName: strPtrOrNil("Alice")}
			secondContact := models.Contact{VaultID: ctx.vaultID, FirstName: strPtrOrNil("Bob")}
			for _, contact := range []*models.Contact{&firstContact, &secondContact} {
				if err := ctx.db.Create(contact).Error; err != nil {
					t.Fatalf("create contact: %v", err)
				}
			}
			contactIDs := []string{secondContact.ID, firstContact.ID, secondContact.ID}
			if operation.name == "remove" {
				members := []models.ContactGroup{{GroupID: group.ID, ContactID: firstContact.ID}, {GroupID: group.ID, ContactID: secondContact.ID}}
				if err := ctx.db.Create(&members).Error; err != nil {
					t.Fatalf("seed group members: %v", err)
				}
			}

			lockedTables := make([]string, 0, 2)
			var contactOrderBy clause.OrderBy
			contactOrderByRequested := false
			callbackName := "group_members_lock_order_" + operation.name
			if err := ctx.db.Callback().Query().Before("gorm:query").Register(callbackName, func(db *gorm.DB) {
				lockingClause, ok := db.Statement.Clauses["FOR"]
				if !ok {
					return
				}
				locking, ok := lockingClause.Expression.(clause.Locking)
				if !ok || locking.Strength != clause.LockingStrengthUpdate {
					return
				}
				switch db.Statement.Table {
				case "contacts":
					lockedTables = append(lockedTables, db.Statement.Table)
					orderByClause, ok := db.Statement.Clauses["ORDER BY"]
					if ok {
						contactOrderBy, contactOrderByRequested = orderByClause.Expression.(clause.OrderBy)
					}
				case "groups":
					lockedTables = append(lockedTables, db.Statement.Table)
				}
			}); err != nil {
				t.Fatalf("register group member lock query callback: %v", err)
			}
			t.Cleanup(func() {
				if err := ctx.db.Callback().Query().Remove(callbackName); err != nil {
					t.Errorf("remove group member lock query callback: %v", err)
				}
			})

			var affectedCount int64
			if operation.name == "add" {
				affectedCount, err = ctx.svc.AddMembers(group.ID, ctx.vaultID, dto.GroupMembersRequest{ContactIDs: contactIDs})
			} else {
				affectedCount, err = ctx.svc.RemoveMembers(group.ID, ctx.vaultID, dto.GroupMembersRequest{ContactIDs: contactIDs})
			}
			if err != nil {
				t.Fatalf("%s members: %v", operation.name, err)
			}
			if affectedCount != operation.expectedCount {
				t.Fatalf("affected count = %d, want %d", affectedCount, operation.expectedCount)
			}
			if len(lockedTables) != 2 || lockedTables[0] != "contacts" || lockedTables[1] != "groups" {
				t.Fatalf("locked tables = %v, want [contacts groups]", lockedTables)
			}
			if !contactOrderByRequested {
				t.Fatal("expected contacts UPDATE lock query to request ORDER BY id ASC")
			}
			if len(contactOrderBy.Columns) != 1 || contactOrderBy.Columns[0].Column.Name != "id ASC" || !contactOrderBy.Columns[0].Column.Raw || contactOrderBy.Columns[0].Desc {
				t.Fatalf("expected contact ORDER BY id ASC, got %+v", contactOrderBy)
			}
		})
	}
}

func TestGroupMemberMutationsReturnGroupNotFoundBeforeContactNotFound(t *testing.T) {
	ctx := setupGroupTest(t)
	missingContactID := uuid.NewString()
	operations := []struct {
		name string
		run  func() (int64, error)
	}{
		{
			name: "add",
			run: func() (int64, error) {
				return ctx.svc.AddMembers(999_999, ctx.vaultID, dto.GroupMembersRequest{ContactIDs: []string{missingContactID}})
			},
		},
		{
			name: "remove",
			run: func() (int64, error) {
				return ctx.svc.RemoveMembers(999_999, ctx.vaultID, dto.GroupMembersRequest{ContactIDs: []string{missingContactID}})
			},
		},
	}
	for _, operation := range operations {
		t.Run(operation.name, func(t *testing.T) {
			_, err := operation.run()
			if !errors.Is(err, ErrGroupNotFound) {
				t.Fatalf("error = %v, want ErrGroupNotFound", err)
			}
		})
	}
}

func TestGroupDeleteRequestsUpdateLockBeforeMemberCleanup(t *testing.T) {
	ctx := setupGroupTest(t)
	group, err := ctx.svc.Create(ctx.vaultID, dto.CreateGroupRequest{Name: "Friends"})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	contact := models.Contact{VaultID: ctx.vaultID, FirstName: strPtrOrNil("Alice")}
	if err := ctx.db.Create(&contact).Error; err != nil {
		t.Fatalf("create contact: %v", err)
	}
	if err := ctx.db.Create(&models.ContactGroup{GroupID: group.ID, ContactID: contact.ID}).Error; err != nil {
		t.Fatalf("create group member: %v", err)
	}
	trace := recordMutationLocks(t, ctx.db)

	if err := ctx.svc.Delete(group.ID, ctx.vaultID); err != nil {
		t.Fatalf("delete group: %v", err)
	}

	trace.requireEventBefore(t, "lock:groups", "delete:contact_group")
}
