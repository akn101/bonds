package services

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/search"
	"gorm.io/gorm"
)

func TestContactMoveHydrationFailureRollsBackBeforePostCommitMaintenance(t *testing.T) {
	// Given
	ctx := setupContactMoveLifecycle(t)
	uploadDir := t.TempDir()
	ctx.moveService.SetFileService(NewVaultFileService(ctx.db, uploadDir))
	label := "source-only hydration rollback"
	template := models.VaultQuickFactsTemplate{VaultID: ctx.sourceVaultID, Label: &label, FieldType: "document"}
	if err := ctx.db.Create(&template).Error; err != nil {
		t.Fatalf("create source-only quick fact template: %v", err)
	}
	file := models.File{VaultID: ctx.sourceVaultID, UUID: "hydration-rollback-file", Name: "hydration-rollback-file", Type: "quick_fact", MimeType: "text/plain", Size: 1}
	if err := ctx.db.Create(&file).Error; err != nil {
		t.Fatalf("create quick fact file: %v", err)
	}
	quickFact := models.QuickFact{ContactID: ctx.contact.ID, VaultQuickFactsTemplateID: template.ID, FileID: &file.ID}
	if err := ctx.db.Create(&quickFact).Error; err != nil {
		t.Fatalf("create quick fact: %v", err)
	}
	filePath := filepath.Join(uploadDir, file.UUID)
	if err := os.WriteFile(filePath, []byte("hydration rollback"), 0o644); err != nil {
		t.Fatalf("write quick fact file: %v", err)
	}
	forcedErr := errors.New("forced target contact hydration failure")
	const callbackName = "contact_move_target_contact_hydration_failure"
	contactQueryCount := 0
	if err := ctx.db.Callback().Query().Before("gorm:query").Register(callbackName, func(tx *gorm.DB) {
		if tx.Statement.Table != "contacts" {
			return
		}
		contactQueryCount++
		if contactQueryCount == 2 {
			tx.AddError(forcedErr)
		}
	}); err != nil {
		t.Fatalf("register target contact hydration callback: %v", err)
	}
	t.Cleanup(func() {
		if err := ctx.db.Callback().Query().Remove(callbackName); err != nil {
			t.Errorf("remove target contact hydration callback: %v", err)
		}
	})

	// When
	_, err := ctx.moveService.MoveMany([]string{ctx.contact.ID}, ctx.sourceVaultID, ctx.targetVaultID, ctx.userID)

	// Then
	if !errors.Is(err, forcedErr) {
		t.Fatalf("move error = %v, want wrapped %v", err, forcedErr)
	}
	var sourceContact models.Contact
	if err := ctx.db.Where("id = ? AND vault_id = ?", ctx.contact.ID, ctx.sourceVaultID).First(&sourceContact).Error; err != nil {
		t.Fatalf("source contact after hydration rollback: %v", err)
	}
	assertContactMoveRecordCount(t, ctx.db, &models.QuickFact{}, quickFact.ID, 1)
	assertContactMoveRecordCount(t, ctx.db, &models.File{}, file.ID, 1)
	if _, err := os.Stat(filePath); err != nil {
		t.Fatalf("quick fact physical file after hydration failure: %v", err)
	}
	if events := ctx.recordedRemoteEvents(); len(events) != 0 {
		t.Fatalf("DAV events after hydration rollback = %#v, want none", events)
	}
	if events := ctx.searchEngine.recordedEvents(); len(events) != 0 {
		t.Fatalf("search events after hydration rollback = %#v, want none", events)
	}
}

func TestReindexMovedSearchDocumentsContinuesAndJoinsEveryFailure(t *testing.T) {
	// Given
	svc, firstContactID, sourceVaultID, targetVaultID, userID := setupContactMoveTest(t)
	secondContact, err := NewContactService(svc.db).CreateContact(sourceVaultID, userID, dto.CreateContactRequest{FirstName: "Second"})
	if err != nil {
		t.Fatalf("create second contact: %v", err)
	}
	firstTitle := "First moved note"
	firstNote := models.Note{ContactID: firstContactID, VaultID: targetVaultID, Title: &firstTitle, Body: "first"}
	if err := svc.db.Create(&firstNote).Error; err != nil {
		t.Fatalf("create first target note: %v", err)
	}
	secondTitle := "Second moved note"
	secondNote := models.Note{ContactID: secondContact.ID, VaultID: targetVaultID, Title: &secondTitle, Body: "second"}
	if err := svc.db.Create(&secondNote).Error; err != nil {
		t.Fatalf("create second target note: %v", err)
	}
	contactIndexErr := errors.New("first contact index failed")
	contactDeleteErr := errors.New("first contact stale delete failed")
	noteIndexErr := errors.New("first note index failed")
	noteDeleteErr := errors.New("first note stale delete failed")
	engine := &contactMoveMaintenanceFailureEngine{
		contactIndexErrors:  map[string]error{firstContactID: contactIndexErr},
		firstNoteIndexError: noteIndexErr,
		contactDeleteError:  contactDeleteErr,
		noteDeleteError:     noteDeleteErr,
	}
	svc.SetSearchService(NewSearchService(engine))

	// When
	err = svc.reindexMovedSearchDocuments(
		[]string{firstContactID, secondContact.ID},
		[]models.Contact{{ID: firstContactID}, {ID: secondContact.ID}},
		targetVaultID,
	)

	// Then
	for _, expectedErr := range []error{contactIndexErr, contactDeleteErr, noteIndexErr, noteDeleteErr} {
		if !errors.Is(err, expectedErr) {
			t.Fatalf("reindex error = %v, want errors.Is(..., %v)", err, expectedErr)
		}
	}
	if !engine.indexedContact(secondContact.ID) {
		t.Fatalf("later contact %s was not indexed after first contact failure; events = %#v", secondContact.ID, engine.events)
	}
	if engine.countEventsWithPrefix("index note ") != 2 {
		t.Fatalf("later note was not indexed after first note failure; events = %#v", engine.events)
	}
	if !engine.deleted("contact:" + firstContactID) {
		t.Fatalf("failed contact stale delete was not attempted; events = %#v", engine.events)
	}
	if engine.countEventsWithPrefix("delete note:") != 1 {
		t.Fatalf("failed note stale delete was not attempted; events = %#v", engine.events)
	}
}

func TestContactMoveLogsAllReindexFailuresAndReturnsCommittedBulkSuccess(t *testing.T) {
	// Given
	ctx := setupContactMoveLifecycle(t)
	secondContact, err := NewContactService(ctx.db).CreateContact(ctx.sourceVaultID, ctx.userID, dto.CreateContactRequest{FirstName: "Second", LastName: "Moving"})
	if err != nil {
		t.Fatalf("create second contact: %v", err)
	}
	secondTitle := "Second moving note"
	secondNote := models.Note{ContactID: secondContact.ID, VaultID: ctx.sourceVaultID, Title: &secondTitle, Body: "second"}
	if err := ctx.db.Create(&secondNote).Error; err != nil {
		t.Fatalf("create second note: %v", err)
	}
	contactIndexErr := errors.New("committed first contact index failed")
	contactDeleteErr := errors.New("committed first contact stale delete failed")
	noteIndexErr := errors.New("committed first note index failed")
	noteDeleteErr := errors.New("committed first note stale delete failed")
	engine := &contactMoveMaintenanceFailureEngine{
		contactIndexErrors:  map[string]error{ctx.contact.ID: contactIndexErr},
		firstNoteIndexError: noteIndexErr,
		contactDeleteError:  contactDeleteErr,
		noteDeleteError:     noteDeleteErr,
	}
	ctx.moveService.SetSearchService(NewSearchService(engine))
	logOutput := captureContactMoveLogs(t)

	// When
	response, err := ctx.moveService.MoveMany([]string{ctx.contact.ID, secondContact.ID}, ctx.sourceVaultID, ctx.targetVaultID, ctx.userID)

	// Then
	if err != nil {
		t.Fatalf("move contacts after committed maintenance failures: %v", err)
	}
	if response.MovedCount != 2 || len(response.Contacts) != 2 || response.Contacts[0].ID != ctx.contact.ID || response.Contacts[1].ID != secondContact.ID {
		t.Fatalf("move response = %+v, want both contacts in requested order", response)
	}
	if !engine.indexedContact(secondContact.ID) || engine.countEventsWithPrefix("index note ") != 2 {
		t.Fatalf("later moved documents were not indexed; events = %#v", engine.events)
	}
	if !engine.deleted("contact:"+ctx.contact.ID) || engine.countEventsWithPrefix("delete note:") != 1 {
		t.Fatalf("failed moved document stale deletes were not attempted; events = %#v", engine.events)
	}
	if events := ctx.recordedRemoteEvents(); len(events) != 3 {
		t.Fatalf("DAV events = %#v, want source delete plus two target pushes", events)
	}
	logText := logOutput.String()
	if count := strings.Count(logText, "[contact-move] failed to reindex moved search documents"); count != 1 {
		t.Fatalf("reindex failure logs = %d, want one: %q", count, logText)
	}
	for _, expectedErr := range []error{contactIndexErr, contactDeleteErr, noteIndexErr, noteDeleteErr} {
		if !strings.Contains(logText, expectedErr.Error()) {
			t.Fatalf("reindex failure log = %q, want %q", logText, expectedErr)
		}
	}
}

func assertContactMoveRecordCount(t *testing.T, db *gorm.DB, model any, id any, want int64) {
	t.Helper()
	var got int64
	if err := db.Model(model).Where("id = ?", id).Count(&got).Error; err != nil || got != want {
		t.Fatalf("%T count for id %v = (%d, %v), want %d", model, id, got, err, want)
	}
}

type contactMoveMaintenanceFailureEngine struct {
	contactIndexErrors  map[string]error
	firstNoteIndexError error
	contactDeleteError  error
	noteDeleteError     error
	noteIndexCalls      int
	events              []string
}

func (e *contactMoveMaintenanceFailureEngine) IndexContact(id, _, _, _, _, _ string) error {
	e.events = append(e.events, "index contact "+id)
	return e.contactIndexErrors[id]
}

func (e *contactMoveMaintenanceFailureEngine) IndexNote(id, _, _, _, _ string) error {
	e.events = append(e.events, "index note "+id)
	if e.noteIndexCalls == 0 {
		e.noteIndexCalls++
		return e.firstNoteIndexError
	}
	e.noteIndexCalls++
	return nil
}

func (e *contactMoveMaintenanceFailureEngine) DeleteDocument(id string) error {
	e.events = append(e.events, "delete "+id)
	if strings.HasPrefix(id, "contact:") {
		return e.contactDeleteError
	}
	return e.noteDeleteError
}

func (e *contactMoveMaintenanceFailureEngine) Search(string, string, int, int) (*search.SearchResponse, error) {
	return &search.SearchResponse{}, nil
}

func (e *contactMoveMaintenanceFailureEngine) Rebuild() error { return nil }

func (e *contactMoveMaintenanceFailureEngine) Close() error { return nil }

func (e *contactMoveMaintenanceFailureEngine) indexedContact(contactID string) bool {
	return e.containsEvent("index contact " + contactID)
}

func (e *contactMoveMaintenanceFailureEngine) deleted(documentID string) bool {
	return e.containsEvent("delete " + documentID)
}

func (e *contactMoveMaintenanceFailureEngine) countEventsWithPrefix(prefix string) int {
	count := 0
	for _, event := range e.events {
		if strings.HasPrefix(event, prefix) {
			count++
		}
	}
	return count
}

func (e *contactMoveMaintenanceFailureEngine) containsEvent(expected string) bool {
	for _, event := range e.events {
		if event == expected {
			return true
		}
	}
	return false
}
