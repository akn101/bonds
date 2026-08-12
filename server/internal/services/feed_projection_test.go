package services

import (
	"testing"
	"time"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/testutil"
	"gorm.io/gorm"
)

type feedProjectionContext struct {
	db      *gorm.DB
	service *FeedService
	vaultID string
	userID  string
	contact models.Contact
}

func setupFeedProjectionContext(t *testing.T) feedProjectionContext {
	t.Helper()
	db := testutil.SetupTestDB(t)
	auth, err := NewAuthService(db, testutil.TestJWTConfig()).Register(dto.RegisterRequest{
		FirstName: "Feed",
		LastName:  "Tester",
		Email:     "feed-projection@example.com",
		Password:  "password123",
	}, "en")
	if err != nil {
		t.Fatalf("register user: %v", err)
	}
	vault, err := NewVaultService(db).CreateVault(auth.User.AccountID, auth.User.ID, dto.CreateVaultRequest{Name: "Feed Vault"}, "en")
	if err != nil {
		t.Fatalf("create vault: %v", err)
	}
	firstName := "Source"
	contact := models.Contact{VaultID: vault.ID, FirstName: &firstName}
	if err := db.Create(&contact).Error; err != nil {
		t.Fatalf("create contact: %v", err)
	}
	return feedProjectionContext{db: db, service: NewFeedService(db), vaultID: vault.ID, userID: auth.User.ID, contact: contact}
}

func TestFeedSourceProjectsStaticModulesForNonFileKinds(t *testing.T) {
	ctx := setupFeedProjectionContext(t)
	otherContact := models.Contact{VaultID: ctx.vaultID}
	if err := ctx.db.Create(&otherContact).Error; err != nil {
		t.Fatalf("create related contact: %v", err)
	}

	tests := []struct {
		name   string
		kind   string
		module string
		create func() uint
	}{
		{"note", "Note", "notes", func() uint { return createFeedProjectionNote(t, ctx) }},
		{"reminder", "ContactReminder", "reminders", func() uint { return createFeedProjectionReminder(t, ctx) }},
		{"call", "Call", "calls", func() uint { return createFeedProjectionCall(t, ctx) }},
		{"task", "ContactTask", "tasks", func() uint { return createFeedProjectionTask(t, ctx) }},
		{"address", "Address", "addresses", func() uint { return createFeedProjectionAddress(t, ctx) }},
		{"activity", "Activity", "activities", func() uint { return createFeedProjectionActivity(t, ctx) }},
		{"loan", "Loan", "loans", func() uint { return createFeedProjectionLoan(t, ctx) }},
		{"relationship", "Relationship", "relationships", func() uint { return createFeedProjectionRelationship(t, ctx, otherContact.ID) }},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			// Given
			sourceID := test.create()
			kind := test.kind
			item := models.ContactFeedItem{VaultID: ctx.vaultID, ContactID: ctx.contact.ID, FeedableID: &sourceID, FeedableType: &kind}

			// When
			source, err := ctx.service.sourceAvailable(item)

			// Then
			if err != nil {
				t.Fatalf("project source: %v", err)
			}
			if source == nil || !source.Available || source.Module != test.module {
				t.Fatalf("source = %+v, want available source in module %q", source, test.module)
			}
		})
	}
}

func TestFeedSourceKeepsNonFileModuleAfterSourceDeletion(t *testing.T) {
	ctx := setupFeedProjectionContext(t)
	sourceID := createFeedProjectionNote(t, ctx)
	kind := "Note"
	if err := ctx.db.Delete(&models.Note{}, sourceID).Error; err != nil {
		t.Fatalf("delete note: %v", err)
	}

	source, err := ctx.service.sourceAvailable(models.ContactFeedItem{VaultID: ctx.vaultID, ContactID: ctx.contact.ID, FeedableID: &sourceID, FeedableType: &kind})
	if err != nil {
		t.Fatalf("project deleted source: %v", err)
	}
	if source == nil || source.Available || source.Module != "notes" {
		t.Fatalf("source = %+v, want unavailable source in notes", source)
	}
}

func TestFeedSourceProjectsFileModulesAndOwnership(t *testing.T) {
	ctx := setupFeedProjectionContext(t)
	otherContact := models.Contact{VaultID: ctx.vaultID}
	if err := ctx.db.Create(&otherContact).Error; err != nil {
		t.Fatalf("create other contact: %v", err)
	}
	otherVaultID := createFeedProjectionVault(t, ctx)

	tests := []struct {
		name          string
		create        func() uint
		wantAvailable bool
		wantModule    string
	}{
		{"contact photo", func() uint { return createFeedProjectionContactFile(t, ctx, "photo", ctx.vaultID, ctx.contact.ID) }, true, "photos"},
		{"contact avatar", func() uint { return createFeedProjectionContactFile(t, ctx, "avatar", ctx.vaultID, ctx.contact.ID) }, true, "photos"},
		{"contact video", func() uint { return createFeedProjectionContactFile(t, ctx, "video", ctx.vaultID, ctx.contact.ID) }, true, "photos"},
		{"contact document", func() uint { return createFeedProjectionContactFile(t, ctx, "document", ctx.vaultID, ctx.contact.ID) }, true, "documents"},
		{"quick fact photo", func() uint {
			return createFeedProjectionQuickFactFile(t, ctx, "photo", ctx.vaultID, ctx.contact.ID, ctx.vaultID, true)
		}, true, "quick_facts"},
		{"quick fact document", func() uint {
			return createFeedProjectionQuickFactFile(t, ctx, "document", ctx.vaultID, ctx.contact.ID, ctx.vaultID, true)
		}, true, "quick_facts"},
		{"deleted file", func() uint {
			id := createFeedProjectionContactFile(t, ctx, "photo", ctx.vaultID, ctx.contact.ID)
			if err := ctx.db.Delete(&models.File{}, id).Error; err != nil {
				t.Fatalf("delete file: %v", err)
			}
			return id
		}, false, ""},
		{"moved file", func() uint { return createFeedProjectionContactFile(t, ctx, "photo", otherVaultID, ctx.contact.ID) }, false, ""},
		{"mismatched contact", func() uint { return createFeedProjectionContactFile(t, ctx, "photo", ctx.vaultID, otherContact.ID) }, false, ""},
		{"unsupported type", func() uint { return createFeedProjectionContactFile(t, ctx, "audio", ctx.vaultID, ctx.contact.ID) }, false, ""},
		{"quick fact cross vault template", func() uint {
			return createFeedProjectionQuickFactFile(t, ctx, "photo", ctx.vaultID, ctx.contact.ID, otherVaultID, true)
		}, false, ""},
		{"quick fact mismatched file back reference", func() uint {
			return createFeedProjectionQuickFactFile(t, ctx, "photo", ctx.vaultID, ctx.contact.ID, ctx.vaultID, false)
		}, false, ""},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			// Given
			fileID := test.create()
			kind := "File"
			item := models.ContactFeedItem{VaultID: ctx.vaultID, ContactID: ctx.contact.ID, FeedableID: &fileID, FeedableType: &kind}

			// When
			source, err := ctx.service.sourceAvailable(item)

			// Then
			if err != nil {
				t.Fatalf("project file source: %v", err)
			}
			if source == nil || source.Available != test.wantAvailable || source.Module != test.wantModule {
				t.Fatalf("source = %+v, want available=%t module=%q", source, test.wantAvailable, test.wantModule)
			}
		})
	}
}

func TestFeedSourceKeepsMovedContactFilesUnavailable(t *testing.T) {
	// Given
	ctx := setupFeedProjectionContext(t)
	fileID := createFeedProjectionContactFile(t, ctx, "photo", ctx.vaultID, ctx.contact.ID)
	kind := "File"
	otherVaultID := createFeedProjectionVault(t, ctx)
	if err := ctx.db.Model(&models.Contact{}).Where("id = ?", ctx.contact.ID).Update("vault_id", otherVaultID).Error; err != nil {
		t.Fatalf("move contact: %v", err)
	}

	// When
	source, err := ctx.service.sourceAvailable(models.ContactFeedItem{VaultID: ctx.vaultID, ContactID: ctx.contact.ID, FeedableID: &fileID, FeedableType: &kind})

	// Then
	if err != nil {
		t.Fatalf("project moved contact file: %v", err)
	}
	if source == nil || source.Available || source.Module != "" {
		t.Fatalf("source = %+v, want unavailable source without module", source)
	}
}

func TestGetFeedProjectsQuickFactFileSource(t *testing.T) {
	// Given
	ctx := setupFeedProjectionContext(t)
	fileID := createFeedProjectionQuickFactFile(t, ctx, "photo", ctx.vaultID, ctx.contact.ID, ctx.vaultID, true)
	kind := "File"
	if err := NewFeedRecorder(ctx.db).Record(ctx.contact.ID, ctx.userID, ActionFileUploaded, "Uploaded photo", &fileID, &kind); err != nil {
		t.Fatalf("record file feed event: %v", err)
	}

	// When
	items, _, err := ctx.service.GetFeed(ctx.vaultID, 1, 15, ctx.userID)

	// Then
	if err != nil {
		t.Fatalf("get feed: %v", err)
	}
	if len(items) != 1 || items[0].Source == nil || !items[0].Source.Available || items[0].Source.Module != "quick_facts" {
		t.Fatalf("items = %+v, want available Quick Fact file source", items)
	}
}

func createFeedProjectionNote(t *testing.T, ctx feedProjectionContext) uint {
	t.Helper()
	note := models.Note{VaultID: ctx.vaultID, ContactID: ctx.contact.ID, Body: "A note"}
	if err := ctx.db.Create(&note).Error; err != nil {
		t.Fatalf("create note: %v", err)
	}
	return note.ID
}

func createFeedProjectionReminder(t *testing.T, ctx feedProjectionContext) uint {
	t.Helper()
	reminder := models.ContactReminder{ContactID: ctx.contact.ID, Label: "Check in", Type: "one_time"}
	if err := ctx.db.Create(&reminder).Error; err != nil {
		t.Fatalf("create reminder: %v", err)
	}
	return reminder.ID
}

func createFeedProjectionCall(t *testing.T, ctx feedProjectionContext) uint {
	t.Helper()
	call := models.Call{ContactID: ctx.contact.ID, AuthorName: "Feed Tester", CalledAt: time.Now(), Type: "phone", WhoInitiated: "me"}
	if err := ctx.db.Create(&call).Error; err != nil {
		t.Fatalf("create call: %v", err)
	}
	return call.ID
}

func createFeedProjectionTask(t *testing.T, ctx feedProjectionContext) uint {
	t.Helper()
	task := models.ContactTask{VaultID: ctx.vaultID, AuthorName: "Feed Tester", Label: "Task"}
	if err := ctx.db.Create(&task).Error; err != nil {
		t.Fatalf("create task: %v", err)
	}
	if err := ctx.db.Create(&models.TaskContact{ContactTaskID: task.ID, ContactID: ctx.contact.ID}).Error; err != nil {
		t.Fatalf("create task contact: %v", err)
	}
	return task.ID
}

func createFeedProjectionAddress(t *testing.T, ctx feedProjectionContext) uint {
	t.Helper()
	address := models.Address{VaultID: ctx.vaultID}
	if err := ctx.db.Create(&address).Error; err != nil {
		t.Fatalf("create address: %v", err)
	}
	if err := ctx.db.Create(&models.ContactAddress{AddressID: address.ID, ContactID: ctx.contact.ID}).Error; err != nil {
		t.Fatalf("create contact address: %v", err)
	}
	return address.ID
}

func createFeedProjectionActivity(t *testing.T, ctx feedProjectionContext) uint {
	t.Helper()
	start := time.Now()
	event := models.Activity{VaultID: ctx.vaultID, Title: "Activity", StartDate: &start, StartPrecision: "day", EndStatus: "none"}
	if err := ctx.db.Create(&event).Error; err != nil {
		t.Fatalf("create activity: %v", err)
	}
	if err := ctx.db.Create(&models.ActivityParticipant{ActivityID: event.ID, ContactID: ctx.contact.ID}).Error; err != nil {
		t.Fatalf("create activity participant: %v", err)
	}
	return event.ID
}

func createFeedProjectionLoan(t *testing.T, ctx feedProjectionContext) uint {
	t.Helper()
	loan := models.Loan{VaultID: ctx.vaultID, Type: "debt", Name: "Loan"}
	if err := ctx.db.Create(&loan).Error; err != nil {
		t.Fatalf("create loan: %v", err)
	}
	if err := ctx.db.Create(&models.ContactLoan{LoanID: loan.ID, LoanerID: ctx.contact.ID, LoaneeID: ctx.contact.ID}).Error; err != nil {
		t.Fatalf("create contact loan: %v", err)
	}
	return loan.ID
}

func createFeedProjectionRelationship(t *testing.T, ctx feedProjectionContext, relatedContactID string) uint {
	t.Helper()
	relationship := models.Relationship{ContactID: ctx.contact.ID, RelatedContactID: relatedContactID, RelationshipTypeID: 1}
	if err := ctx.db.Create(&relationship).Error; err != nil {
		t.Fatalf("create relationship: %v", err)
	}
	return relationship.ID
}

func createFeedProjectionContactFile(t *testing.T, ctx feedProjectionContext, fileType, vaultID, contactID string) uint {
	t.Helper()
	fileableType := "Contact"
	file := models.File{VaultID: vaultID, UfileableID: &contactID, FileableType: &fileableType, UUID: "file", Name: "file", Type: fileType, MimeType: "application/octet-stream", Size: 1}
	if err := ctx.db.Create(&file).Error; err != nil {
		t.Fatalf("create contact file: %v", err)
	}
	return file.ID
}

func createFeedProjectionQuickFactFile(t *testing.T, ctx feedProjectionContext, fileType, fileVaultID, contactID, templateVaultID string, matchesFileBackReference bool) uint {
	t.Helper()
	template := models.VaultQuickFactsTemplate{VaultID: templateVaultID, FieldType: fileType}
	if err := ctx.db.Create(&template).Error; err != nil {
		t.Fatalf("create quick fact template: %v", err)
	}
	quickFactType := "QuickFact"
	file := models.File{VaultID: fileVaultID, FileableType: &quickFactType, UUID: "quick-fact-file", Name: "quick-fact-file", Type: fileType, MimeType: "application/octet-stream", Size: 1}
	if err := ctx.db.Create(&file).Error; err != nil {
		t.Fatalf("create quick fact file: %v", err)
	}
	fileID := file.ID
	if !matchesFileBackReference {
		fileID++
	}
	fact := models.QuickFact{VaultQuickFactsTemplateID: template.ID, ContactID: contactID, Content: "Quick fact", FileID: &fileID}
	if err := ctx.db.Create(&fact).Error; err != nil {
		t.Fatalf("create quick fact: %v", err)
	}
	if err := ctx.db.Model(&file).Update("fileable_id", fact.ID).Error; err != nil {
		t.Fatalf("link quick fact file: %v", err)
	}
	return file.ID
}

func createFeedProjectionVault(t *testing.T, ctx feedProjectionContext) string {
	t.Helper()
	var accountID string
	if err := ctx.db.Model(&models.Vault{}).Where("id = ?", ctx.vaultID).Select("account_id").Scan(&accountID).Error; err != nil {
		t.Fatalf("load account ID: %v", err)
	}
	var userVault models.UserVault
	if err := ctx.db.Where("vault_id = ?", ctx.vaultID).First(&userVault).Error; err != nil {
		t.Fatalf("load vault user: %v", err)
	}
	vault, err := NewVaultService(ctx.db).CreateVault(accountID, userVault.UserID, dto.CreateVaultRequest{Name: "Other Feed Vault"}, "en")
	if err != nil {
		t.Fatalf("create other vault: %v", err)
	}
	return vault.ID
}
