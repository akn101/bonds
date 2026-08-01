package services

import (
	"testing"

	"github.com/naiba/bonds/internal/dto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func TestMoveManyLocksAscendingAndPreservesResponseOrder(t *testing.T) {
	svc, firstContactID, vaultID, targetVaultID, userID := setupContactMoveTest(t)
	secondContact, err := NewContactService(svc.db).CreateContact(vaultID, userID, dto.CreateContactRequest{FirstName: "Second"})
	if err != nil {
		t.Fatalf("create second contact: %v", err)
	}
	requestedContactIDs := []string{secondContact.ID, firstContactID}

	var locking clause.Locking
	var orderBy clause.OrderBy
	lockingRequested := false
	orderByRequested := false
	callbackName := "contact_move_contacts_lock_order"
	if err := svc.db.Callback().Query().Before("gorm:query").Register(callbackName, func(db *gorm.DB) {
		if db.Statement.Table != "contacts" {
			return
		}
		lockingClause, ok := db.Statement.Clauses["FOR"]
		if !ok {
			return
		}
		var isLockingClause bool
		locking, isLockingClause = lockingClause.Expression.(clause.Locking)
		if !isLockingClause || locking.Strength != clause.LockingStrengthUpdate {
			return
		}
		lockingRequested = true
		orderByClause, ok := db.Statement.Clauses["ORDER BY"]
		if !ok {
			return
		}
		orderBy, orderByRequested = orderByClause.Expression.(clause.OrderBy)
	}); err != nil {
		t.Fatalf("register contact lock query callback: %v", err)
	}
	t.Cleanup(func() {
		if err := svc.db.Callback().Query().Remove(callbackName); err != nil {
			t.Errorf("remove contact lock query callback: %v", err)
		}
	})

	response, err := svc.MoveMany(requestedContactIDs, vaultID, targetVaultID, userID)
	if err != nil {
		t.Fatalf("move contacts: %v", err)
	}
	if !lockingRequested {
		t.Fatal("expected contacts query to request an UPDATE lock")
	}
	if !orderByRequested {
		t.Fatal("expected contacts UPDATE lock query to request ORDER BY id ASC")
	}
	if len(orderBy.Columns) != 1 || orderBy.Columns[0].Column.Name != "id ASC" || !orderBy.Columns[0].Column.Raw || orderBy.Columns[0].Desc {
		t.Fatalf("expected ORDER BY id ASC, got %+v", orderBy)
	}
	if len(response.Contacts) != len(requestedContactIDs) {
		t.Fatalf("moved contacts = %d, want %d", len(response.Contacts), len(requestedContactIDs))
	}
	for index, contactID := range requestedContactIDs {
		if response.Contacts[index].ID != contactID {
			t.Fatalf("response contact at index %d = %s, want requested contact %s", index, response.Contacts[index].ID, contactID)
		}
	}
}
