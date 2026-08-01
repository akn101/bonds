package services

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/emersion/go-vcard"
	"github.com/emersion/go-webdav/carddav"
	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/search"
	"github.com/naiba/bonds/internal/testutil"
	"gorm.io/gorm"
)

type contactMoveLifecycleSearchEngine struct {
	mu     sync.Mutex
	events []string
	check  func(string, string) error
	record func(string)
}

func (e *contactMoveLifecycleSearchEngine) IndexContact(id, vaultID, _, _, _, _ string) error {
	e.mu.Lock()
	e.events = append(e.events, "search contact")
	e.mu.Unlock()
	e.record("search contact")
	return e.check(id, vaultID)
}

func (e *contactMoveLifecycleSearchEngine) IndexNote(id, vaultID, _, _, _ string) error {
	e.mu.Lock()
	e.events = append(e.events, "search note")
	e.mu.Unlock()
	e.record("search note")
	return e.check(id, vaultID)
}

func (e *contactMoveLifecycleSearchEngine) DeleteDocument(id string) error {
	e.mu.Lock()
	e.events = append(e.events, "search delete "+id)
	e.mu.Unlock()
	return nil
}

func (e *contactMoveLifecycleSearchEngine) Search(string, string, int, int) (*search.SearchResponse, error) {
	return &search.SearchResponse{}, nil
}
func (e *contactMoveLifecycleSearchEngine) Rebuild() error { return nil }
func (e *contactMoveLifecycleSearchEngine) Close() error   { return nil }

func (e *contactMoveLifecycleSearchEngine) recordedEvents() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]string(nil), e.events...)
}

type contactMoveLifecycleContext struct {
	db                 *gorm.DB
	moveService        *ContactMoveService
	pushService        *DavPushService
	clientService      *DavClientService
	contact            *dto.ContactResponse
	sourceVaultID      string
	targetVaultID      string
	userID             string
	sourceSubscription *dto.DavSubscriptionResponse
	targetSubscription *dto.DavSubscriptionResponse
	sourceState        models.ContactSubscriptionState
	note               models.Note
	remoteEvents       []string
	remoteMu           sync.Mutex
	lifecycleEvents    []string
	lifecycleMu        sync.Mutex
	searchEngine       *contactMoveLifecycleSearchEngine
}

func setupContactMoveLifecycle(t *testing.T) *contactMoveLifecycleContext {
	t.Helper()
	db := testutil.SetupTestDB(t)
	registration, err := NewAuthService(db, testutil.TestJWTConfig()).Register(dto.RegisterRequest{FirstName: "Move", LastName: "User", Email: "contact-move-lifecycle@example.com", Password: "password123"}, "en")
	if err != nil {
		t.Fatalf("register user: %v", err)
	}
	sourceVault, err := NewVaultService(db).CreateVault(registration.User.AccountID, registration.User.ID, dto.CreateVaultRequest{Name: "Source"}, "en")
	if err != nil {
		t.Fatalf("create source vault: %v", err)
	}
	targetVault, err := NewVaultService(db).CreateVault(registration.User.AccountID, registration.User.ID, dto.CreateVaultRequest{Name: "Target"}, "en")
	if err != nil {
		t.Fatalf("create target vault: %v", err)
	}
	contact, err := NewContactService(db).CreateContact(sourceVault.ID, registration.User.ID, dto.CreateContactRequest{FirstName: "Moving", LastName: "Contact"})
	if err != nil {
		t.Fatalf("create contact: %v", err)
	}
	title := "Moving note"
	note := models.Note{ContactID: contact.ID, VaultID: sourceVault.ID, Title: &title, Body: "body"}
	if err := db.Create(&note).Error; err != nil {
		t.Fatalf("create note: %v", err)
	}
	if err := NewFeedRecorder(db).Record(contact.ID, registration.User.ID, ActionNoteCreated, "Created note", &note.ID, stringPointer("Note")); err != nil {
		t.Fatalf("record feed event: %v", err)
	}
	clientService := NewDavClientService(db, testutil.TestJWTConfig().Secret)
	sourceSubscription := createMovePushSubscription(t, clientService, sourceVault.ID, registration.User.ID, "https://dav.example.com/source/")
	targetSubscription := createMovePushSubscription(t, clientService, targetVault.ID, registration.User.ID, "https://dav.example.com/target/")
	sourceState := models.ContactSubscriptionState{ContactID: contact.ID, AddressBookSubscriptionID: sourceSubscription.ID, DistantURI: "https://dav.example.com/source/original.vcf", DistantEtag: "source-etag"}
	if err := db.Create(&sourceState).Error; err != nil {
		t.Fatalf("create source state: %v", err)
	}
	ctx := &contactMoveLifecycleContext{db: db, clientService: clientService, contact: contact, sourceVaultID: sourceVault.ID, targetVaultID: targetVault.ID, userID: registration.User.ID, sourceSubscription: sourceSubscription, targetSubscription: targetSubscription, sourceState: sourceState, note: note}
	ctx.searchEngine = &contactMoveLifecycleSearchEngine{record: ctx.recordLifecycle, check: func(id, vaultID string) error {
		var movedContact models.Contact
		if err := db.Where("id = ? AND vault_id = ?", ctx.contact.ID, ctx.targetVaultID).First(&movedContact).Error; err != nil {
			return err
		}
		var sourceState models.ContactSubscriptionState
		if err := db.Where("id = ?", ctx.sourceState.ID).First(&sourceState).Error; err == nil {
			return errors.New("source subscription state remains during post-commit search")
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		return nil
	}}
	ctx.pushService = NewDavPushService(db, clientService, NewVCardService(db))
	ctx.pushService.SetClientFactory(&mockCardDAVClientFactory{client: &mockCardDAVClient{
		removeAllFn: func(_ context.Context, path string) error { ctx.recordRemote("source DELETE", path); return nil },
		putAddrObjFn: func(_ context.Context, path string, _ vcard.Card) (*carddav.AddressObject, error) {
			ctx.recordRemote("target PUT", path)
			return &carddav.AddressObject{Path: path, ETag: "target-etag"}, nil
		},
	}})
	ctx.moveService = NewContactMoveService(db)
	ctx.moveService.SetDavPushService(ctx.pushService)
	ctx.moveService.SetSearchService(NewSearchService(ctx.searchEngine))
	return ctx
}

func createMovePushSubscription(t *testing.T, service *DavClientService, vaultID, userID, uri string) *dto.DavSubscriptionResponse {
	t.Helper()
	subscription, err := service.Create(vaultID, userID, dto.CreateDavSubscriptionRequest{URI: uri, Username: "user", Password: "password", SyncWay: SyncWayPush})
	if err != nil {
		t.Fatalf("create push subscription: %v", err)
	}
	return subscription
}

func (c *contactMoveLifecycleContext) recordRemote(action, path string) {
	c.remoteMu.Lock()
	c.remoteEvents = append(c.remoteEvents, action+" "+path)
	c.remoteMu.Unlock()
	c.recordLifecycle(action)
}

func (c *contactMoveLifecycleContext) recordedRemoteEvents() []string {
	c.remoteMu.Lock()
	defer c.remoteMu.Unlock()
	return append([]string(nil), c.remoteEvents...)
}

func (c *contactMoveLifecycleContext) recordLifecycle(event string) {
	c.lifecycleMu.Lock()
	c.lifecycleEvents = append(c.lifecycleEvents, event)
	c.lifecycleMu.Unlock()
}

func (c *contactMoveLifecycleContext) recordedLifecycleEvents() []string {
	c.lifecycleMu.Lock()
	defer c.lifecycleMu.Unlock()
	return append([]string(nil), c.lifecycleEvents...)
}

func stringPointer(value string) *string { return &value }
