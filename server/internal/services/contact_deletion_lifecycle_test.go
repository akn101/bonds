package services

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/testutil"
	"gorm.io/gorm"
)

func TestContactDeletionLifecycleCommitsDatabaseAndPostCommitSideEffects(t *testing.T) {
	// Given
	ctx := setupContactDeletionLifecycle(t)

	// When
	if err := ctx.contactService.DeleteContact(ctx.contact.ID, ctx.vaultID); err != nil {
		t.Fatalf("delete contact: %v", err)
	}

	// Then
	var active models.Contact
	if err := ctx.db.Where("id = ?", ctx.contact.ID).First(&active).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("active contact lookup error = %v, want record not found", err)
	}
	var deleted models.Contact
	if err := ctx.db.Unscoped().First(&deleted, "id = ?", ctx.contact.ID).Error; err != nil || !deleted.DeletedAt.Valid {
		t.Fatalf("soft-deleted contact = (%v, deleted=%t), want retained deleted row", err, deleted.DeletedAt.Valid)
	}
	assertContactDeletionCount(t, ctx.db, &models.ContactVaultUser{}, "contact_id = ?", ctx.contact.ID, 0)
	assertContactDeletionCount(t, ctx.db, &models.ContactReminderScheduled{}, "id = ?", ctx.pendingSchedule.ID, 0)
	assertContactDeletionCount(t, ctx.db, &models.ContactReminderScheduled{}, "id = ?", ctx.triggeredSchedule.ID, 1)
	assertContactDeletionCount(t, ctx.db, &models.ContactReminder{}, "id = ?", ctx.reminder.ID, 1)
	assertContactDeletionCount(t, ctx.db, &models.Note{}, "id = ?", ctx.note.ID, 1)
	assertContactDeletionCount(t, ctx.db, &models.ContactSubscriptionState{}, "id = ?", ctx.subscriptionState.ID, 0)
	assertContactDeletionCount(t, ctx.db, &models.ContactFeedItem{}, "contact_id = ? AND action = ?", ctx.contact.ID, ActionNoteCreated, 1)
	assertContactDeletionCount(t, ctx.db, &models.ContactFeedItem{}, "contact_id = ? AND action = ?", ctx.contact.ID, ActionContactDeleted, 1)

	items, _, err := NewFeedService(ctx.db).GetFeed(ctx.vaultID, 1, 20, ctx.userID)
	if err != nil {
		t.Fatalf("get vault feed: %v", err)
	}
	var deleteItem *dto.FeedItemResponse
	for index := range items {
		if items[index].Action == ActionContactDeleted {
			deleteItem = &items[index]
			break
		}
	}
	if deleteItem == nil || deleteItem.ContactName != "Lifecycle Contact" || deleteItem.ContactLinkable {
		t.Fatalf("deleted feed projection = %+v, want snapshot with contact_linkable=false", deleteItem)
	}
	if !ctx.searchEngine.deleted("contact:"+ctx.contact.ID) || !ctx.searchEngine.deleted(fmt.Sprintf("note:%d", ctx.note.ID)) {
		t.Fatalf("search deletions = %v, want contact and note document IDs", ctx.searchEngine.deleteIDs())
	}
	select {
	case state := <-ctx.sideEffectStates:
		assertContactDeletionSideEffectState(t, state, "search")
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for Search side-effect state")
	}
	select {
	case remotePath := <-ctx.remoteDeletes:
		if remotePath != ctx.subscriptionState.DistantURI {
			t.Fatalf("remote DELETE path = %q, want %q", remotePath, ctx.subscriptionState.DistantURI)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for post-commit remote DELETE")
	}
	select {
	case state := <-ctx.sideEffectStates:
		assertContactDeletionSideEffectState(t, state, "DAV")
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for DAV side-effect state")
	}
}

func TestContactDeletionLifecycleRollsBackAndSuppressesSideEffectsWhenFeedWriteFails(t *testing.T) {
	// Given
	ctx := setupContactDeletionLifecycle(t)
	forcedErr := errors.New("forced contact deletion feed failure")
	const callbackName = "contact_deletion_lifecycle_feed_failure"
	if err := ctx.db.Callback().Create().Before("gorm:create").Register(callbackName, func(tx *gorm.DB) {
		if tx.Statement.Table == "contact_feed_items" {
			tx.AddError(forcedErr)
		}
	}); err != nil {
		t.Fatalf("register feed failure callback: %v", err)
	}
	t.Cleanup(func() {
		if err := ctx.db.Callback().Create().Remove(callbackName); err != nil {
			t.Errorf("remove feed failure callback: %v", err)
		}
	})

	// When
	err := ctx.contactService.DeleteContact(ctx.contact.ID, ctx.vaultID)

	// Then
	if !errors.Is(err, forcedErr) {
		t.Fatalf("delete contact error = %v, want wrapped %v", err, forcedErr)
	}
	assertContactDeletionCount(t, ctx.db, &models.Contact{}, "id = ?", ctx.contact.ID, 1)
	assertContactDeletionCount(t, ctx.db, &models.ContactVaultUser{}, "contact_id = ?", ctx.contact.ID, 1)
	assertContactDeletionCount(t, ctx.db, &models.ContactReminderScheduled{}, "id = ?", ctx.pendingSchedule.ID, 1)
	assertContactDeletionCount(t, ctx.db, &models.ContactReminderScheduled{}, "id = ?", ctx.triggeredSchedule.ID, 1)
	assertContactDeletionCount(t, ctx.db, &models.ContactReminder{}, "id = ?", ctx.reminder.ID, 1)
	assertContactDeletionCount(t, ctx.db, &models.Note{}, "id = ?", ctx.note.ID, 1)
	assertContactDeletionCount(t, ctx.db, &models.ContactSubscriptionState{}, "id = ?", ctx.subscriptionState.ID, 1)
	assertContactDeletionCount(t, ctx.db, &models.ContactFeedItem{}, "contact_id = ? AND action = ?", ctx.contact.ID, ActionNoteCreated, 1)
	assertContactDeletionCount(t, ctx.db, &models.ContactFeedItem{}, "contact_id = ? AND action = ?", ctx.contact.ID, ActionContactDeleted, 0)
	if len(ctx.searchEngine.deleteIDs()) != 0 {
		t.Fatalf("search deletions = %v, want none after rollback", ctx.searchEngine.deleteIDs())
	}
	if ctx.remoteDeleteCalls.Load() != 0 {
		t.Fatalf("remote DELETE calls = %d, want none after rollback", ctx.remoteDeleteCalls.Load())
	}
}

type contactDeletionLifecycleContext struct {
	db                *gorm.DB
	contactService    *ContactService
	contact           *dto.ContactResponse
	vaultID           string
	userID            string
	note              models.Note
	reminder          models.ContactReminder
	pendingSchedule   models.ContactReminderScheduled
	triggeredSchedule models.ContactReminderScheduled
	subscriptionState models.ContactSubscriptionState
	searchEngine      *contactDeletionRecordingSearchEngine
	remoteDeletes     chan string
	remoteDeleteCalls *atomic.Int32
	sideEffectStates  chan contactDeletionSideEffectState
}

func setupContactDeletionLifecycle(t *testing.T) contactDeletionLifecycleContext {
	t.Helper()
	db := testutil.SetupTestDB(t)
	registration, err := NewAuthService(db, testutil.TestJWTConfig()).Register(dto.RegisterRequest{FirstName: "Lifecycle", LastName: "User", Email: "contact-deletion-lifecycle@example.com", Password: "password123"}, "en")
	if err != nil {
		t.Fatalf("register user: %v", err)
	}
	vault, err := NewVaultService(db).CreateVault(registration.User.AccountID, registration.User.ID, dto.CreateVaultRequest{Name: "Lifecycle Vault"}, "en")
	if err != nil {
		t.Fatalf("create vault: %v", err)
	}
	searchEngine := &contactDeletionRecordingSearchEngine{}
	remoteDeletes := make(chan string, 1)
	remoteDeleteCalls := &atomic.Int32{}
	sideEffectStates := make(chan contactDeletionSideEffectState, 2)
	var contact *dto.ContactResponse
	var state models.ContactSubscriptionState
	contactService := NewContactService(db)
	contactService.SetFeedRecorder(NewFeedRecorder(db))
	contactService.SetSearchService(NewSearchService(searchEngine))
	clientService := NewDavClientService(db, testutil.TestJWTConfig().Secret)
	pushService := NewDavPushService(db, clientService, NewVCardService(db))
	pushService.SetClientFactory(&mockCardDAVClientFactory{client: &mockCardDAVClient{removeAllFn: func(_ context.Context, path string) error {
		remoteDeleteCalls.Add(1)
		sideEffectStates <- observeContactDeletionSideEffect(db, contact.ID, state.ID, "DAV")
		remoteDeletes <- path
		return nil
	}}})
	contactService.SetDavPushService(pushService)
	contact, err = contactService.CreateContact(vault.ID, registration.User.ID, dto.CreateContactRequest{FirstName: "Lifecycle", LastName: "Contact"})
	if err != nil {
		t.Fatalf("create contact: %v", err)
	}
	note := models.Note{ContactID: contact.ID, VaultID: vault.ID, Body: "retained note"}
	if err := db.Create(&note).Error; err != nil {
		t.Fatalf("create note: %v", err)
	}
	noteType := "Note"
	if err := NewFeedRecorder(db).Record(contact.ID, registration.User.ID, ActionNoteCreated, "Created a note", &note.ID, &noteType); err != nil {
		t.Fatalf("record note feed event: %v", err)
	}
	now := time.Now()
	channel := models.UserNotificationChannel{UserID: &registration.User.ID, Type: "email", Content: "lifecycle@example.com", Active: true, VerifiedAt: &now}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatalf("create notification channel: %v", err)
	}
	reminder := models.ContactReminder{ContactID: contact.ID, Label: "Lifecycle reminder", Type: "one_time"}
	if err := db.Create(&reminder).Error; err != nil {
		t.Fatalf("create reminder: %v", err)
	}
	pendingSchedule := models.ContactReminderScheduled{UserNotificationChannelID: channel.ID, ContactReminderID: reminder.ID, ScheduledAt: now.Add(time.Hour)}
	triggeredSchedule := models.ContactReminderScheduled{UserNotificationChannelID: channel.ID, ContactReminderID: reminder.ID, ScheduledAt: now.Add(-time.Hour), TriggeredAt: &now}
	if err := db.Create(&pendingSchedule).Error; err != nil {
		t.Fatalf("create pending schedule: %v", err)
	}
	if err := db.Create(&triggeredSchedule).Error; err != nil {
		t.Fatalf("create triggered schedule: %v", err)
	}
	subscription := createPushSubscription(t, clientService, vault.ID, registration.User.ID, SyncWayPush)
	state = models.ContactSubscriptionState{ContactID: contact.ID, AddressBookSubscriptionID: subscription.ID, DistantURI: "https://dav.example.com/contacts/lifecycle.vcf", DistantEtag: "etag-lifecycle"}
	if err := db.Create(&state).Error; err != nil {
		t.Fatalf("create subscription state: %v", err)
	}
	searchEngine.sideEffectObserver = func() contactDeletionSideEffectState {
		return observeContactDeletionSideEffect(db, contact.ID, state.ID, "search")
	}
	searchEngine.sideEffectStates = sideEffectStates
	return contactDeletionLifecycleContext{db: db, contactService: contactService, contact: contact, vaultID: vault.ID, userID: registration.User.ID, note: note, reminder: reminder, pendingSchedule: pendingSchedule, triggeredSchedule: triggeredSchedule, subscriptionState: state, searchEngine: searchEngine, remoteDeletes: remoteDeletes, remoteDeleteCalls: remoteDeleteCalls, sideEffectStates: sideEffectStates}
}

func assertContactDeletionCount(t *testing.T, db *gorm.DB, model any, query string, arguments ...any) {
	t.Helper()
	if len(arguments) < 1 {
		t.Fatal("count assertion requires an expected count")
	}
	want, ok := arguments[len(arguments)-1].(int)
	if !ok {
		t.Fatalf("count expected value = %T, want int", arguments[len(arguments)-1])
	}
	var got int64
	if err := db.Model(model).Where(query, arguments[:len(arguments)-1]...).Count(&got).Error; err != nil || got != int64(want) {
		t.Fatalf("count %T where %q = (%d, %v), want %d", model, query, got, err, want)
	}
}
