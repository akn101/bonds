package services

import (
	"context"
	"errors"
	"runtime"
	"sync/atomic"
	"testing"
	"time"

	"github.com/emersion/go-vcard"
	"github.com/emersion/go-webdav/carddav"
	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/testutil"
	"gorm.io/gorm"
)

func TestContactDeletionRemovesStateCreatedByInFlightDavPush(t *testing.T) {
	// Given
	db := testutil.SetupTestDB(t)
	registration, err := NewAuthService(db, testutil.TestJWTConfig()).Register(dto.RegisterRequest{FirstName: "Race", LastName: "User", Email: "contact-deletion-dav-race@example.com", Password: "password123"}, "en")
	if err != nil {
		t.Fatalf("register user: %v", err)
	}
	vault, err := NewVaultService(db).CreateVault(registration.User.AccountID, registration.User.ID, dto.CreateVaultRequest{Name: "Race Vault"}, "en")
	if err != nil {
		t.Fatalf("create vault: %v", err)
	}
	contactService := NewContactService(db)
	contactService.SetFeedRecorder(NewFeedRecorder(db))
	contact, err := contactService.CreateContact(vault.ID, registration.User.ID, dto.CreateContactRequest{FirstName: "Race", LastName: "Contact"})
	if err != nil {
		t.Fatalf("create contact: %v", err)
	}
	clientService := NewDavClientService(db, testutil.TestJWTConfig().Secret)
	createPushSubscription(t, clientService, vault.ID, registration.User.ID, SyncWayPush)
	putStarted := make(chan string, 1)
	releasePut := make(chan struct{})
	remoteDeletes := make(chan string, 1)
	var putCalls atomic.Int32
	pushService := NewDavPushService(db, clientService, NewVCardService(db))
	pushService.SetClientFactory(&mockCardDAVClientFactory{client: &mockCardDAVClient{
		putAddrObjFn: func(_ context.Context, path string, _ vcard.Card) (*carddav.AddressObject, error) {
			putCalls.Add(1)
			putStarted <- path
			<-releasePut
			return &carddav.AddressObject{Path: path, ETag: "race-etag"}, nil
		},
		removeAllFn: func(_ context.Context, path string) error {
			remoteDeletes <- path
			return nil
		},
	}})
	contactService.SetDavPushService(pushService)

	// When
	pushDone := make(chan struct{})
	go func() {
		pushService.PushContactChange(contact.ID, vault.ID)
		close(pushDone)
	}()
	var putPath string
	select {
	case putPath = <-putStarted:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for remote PUT to begin")
	}
	deleteDone := make(chan error, 1)
	go func() { deleteDone <- contactService.DeleteContact(contact.ID, vault.ID) }()
	waitForContactDAVLockReferences(t, &pushService.operationLocks, contact.ID, 2)
	close(releasePut)
	select {
	case err := <-deleteDone:
		if err != nil {
			t.Fatalf("delete contact: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for deletion after releasing remote PUT")
	}
	select {
	case <-pushDone:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for remote PUT completion")
	}

	// Then
	var deleted models.Contact
	if err := db.Unscoped().First(&deleted, "id = ?", contact.ID).Error; err != nil || !deleted.DeletedAt.Valid {
		t.Fatalf("soft-deleted contact = (%v, deleted=%t), want deleted contact", err, deleted.DeletedAt.Valid)
	}
	assertContactDeletionCount(t, db, &models.ContactSubscriptionState{}, "contact_id = ?", contact.ID, 0)
	assertContactDeletionCount(t, db, &models.ContactFeedItem{}, "contact_id = ? AND action = ?", contact.ID, ActionContactDeleted, 1)
	select {
	case removedPath := <-remoteDeletes:
		if removedPath != putPath {
			t.Fatalf("remote DELETE path = %q, want PUT path %q", removedPath, putPath)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for remote DELETE")
	}
	pushService.PushContactChange(contact.ID, vault.ID)
	if putCalls.Load() != 1 {
		t.Fatalf("remote PUT calls = %d, want 1 after deletion", putCalls.Load())
	}
	waitForContactDAVLockRemoval(t, &pushService.operationLocks, contact.ID)
}

func TestContactDeletionRollsBackWhenSoftDeleteAffectsZeroRows(t *testing.T) {
	// Given
	ctx := setupContactDeletionLifecycle(t)
	const callbackName = "contact_deletion_zero_rows"
	if err := ctx.db.Callback().Delete().Before("gorm:delete").Register(callbackName, func(tx *gorm.DB) {
		if tx.Statement.Table == "contacts" {
			tx.Exec("UPDATE contacts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL", ctx.contact.ID)
		}
	}); err != nil {
		t.Fatalf("register zero-row callback: %v", err)
	}
	t.Cleanup(func() {
		if err := ctx.db.Callback().Delete().Remove(callbackName); err != nil {
			t.Errorf("remove zero-row callback: %v", err)
		}
	})

	// When
	err := ctx.contactService.DeleteContact(ctx.contact.ID, ctx.vaultID)

	// Then
	if !errors.Is(err, ErrContactNotFound) {
		t.Fatalf("delete contact error = %v, want %v", err, ErrContactNotFound)
	}
	var active models.Contact
	if err := ctx.db.First(&active, "id = ?", ctx.contact.ID).Error; err != nil {
		t.Fatalf("active contact after rollback: %v", err)
	}
	assertContactDeletionCount(t, ctx.db, &models.ContactVaultUser{}, "contact_id = ?", ctx.contact.ID, 1)
	assertContactDeletionCount(t, ctx.db, &models.ContactReminderScheduled{}, "id = ?", ctx.pendingSchedule.ID, 1)
	assertContactDeletionCount(t, ctx.db, &models.ContactSubscriptionState{}, "id = ?", ctx.subscriptionState.ID, 1)
	assertContactDeletionCount(t, ctx.db, &models.ContactFeedItem{}, "contact_id = ? AND action = ?", ctx.contact.ID, ActionContactDeleted, 0)
	deleteDone := make(chan struct{})
	go func() {
		ctx.contactService.davPushService.PushContactDelete(ctx.contact.ID, ctx.vaultID)
		close(deleteDone)
	}()
	select {
	case <-deleteDone:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for DAV delete after transaction rollback")
	}
	waitForContactDAVLockRemoval(t, &ctx.contactService.davPushService.operationLocks, ctx.contact.ID)
}

func TestContactDeletionWithoutRemoteTargetsReleasesDAVLock(t *testing.T) {
	// Given
	ctx := setupContactDeletionLifecycle(t)
	if err := ctx.db.Delete(&ctx.subscriptionState).Error; err != nil {
		t.Fatalf("delete subscription state: %v", err)
	}

	// When
	if err := ctx.contactService.DeleteContact(ctx.contact.ID, ctx.vaultID); err != nil {
		t.Fatalf("delete contact: %v", err)
	}

	// Then
	waitForContactDAVLockRemoval(t, &ctx.contactService.davPushService.operationLocks, ctx.contact.ID)
	pushDone := make(chan struct{})
	go func() {
		ctx.contactService.davPushService.PushContactChange(ctx.contact.ID, ctx.vaultID)
		close(pushDone)
	}()
	select {
	case <-pushDone:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for DAV push after deletion without remote targets")
	}
}

func waitForContactDAVLockReferences(t *testing.T, registry *contactDAVOperationLockRegistry, contactID string, want int) {
	t.Helper()
	timer := time.NewTimer(time.Second)
	defer timer.Stop()
	for {
		registry.mu.Lock()
		operationLock := registry.locks[contactID]
		references := 0
		if operationLock != nil {
			references = operationLock.references
		}
		registry.mu.Unlock()
		if references == want {
			return
		}
		select {
		case <-timer.C:
			t.Fatalf("DAV lock references for %s = %d, want %d", contactID, references, want)
		default:
			runtime.Gosched()
		}
	}
}

func waitForContactDAVLockRemoval(t *testing.T, registry *contactDAVOperationLockRegistry, contactID string) {
	t.Helper()
	timer := time.NewTimer(time.Second)
	defer timer.Stop()
	for {
		registry.mu.Lock()
		_, exists := registry.locks[contactID]
		registry.mu.Unlock()
		if !exists {
			return
		}
		select {
		case <-timer.C:
			t.Fatalf("DAV lock for %s was not removed", contactID)
		default:
			runtime.Gosched()
		}
	}
}
