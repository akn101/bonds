package services

import (
	"bytes"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"

	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

func TestContactMoveReturnsCommittedResponseWhenQuickFactFileCleanupFails(t *testing.T) {
	// Given
	ctx := setupContactMoveLifecycle(t)
	logOutput := captureContactMoveLogs(t)
	uploadDir := t.TempDir()
	ctx.moveService.SetFileService(NewVaultFileService(ctx.db, uploadDir))
	label := "source-only file"
	template := models.VaultQuickFactsTemplate{VaultID: ctx.sourceVaultID, Label: &label, FieldType: "document"}
	if err := ctx.db.Create(&template).Error; err != nil {
		t.Fatalf("create quick fact template: %v", err)
	}
	file := models.File{VaultID: ctx.sourceVaultID, UUID: "move-cleanup-failure", Name: "move-cleanup-failure", Type: "quick_fact", MimeType: "text/plain", Size: 1}
	if err := ctx.db.Create(&file).Error; err != nil {
		t.Fatalf("create quick fact file: %v", err)
	}
	quickFact := models.QuickFact{ContactID: ctx.contact.ID, VaultQuickFactsTemplateID: template.ID, FileID: &file.ID}
	if err := ctx.db.Create(&quickFact).Error; err != nil {
		t.Fatalf("create quick fact: %v", err)
	}
	filePath := filepath.Join(uploadDir, file.UUID)
	if err := os.Mkdir(filePath, 0o755); err != nil {
		t.Fatalf("create non-empty file path directory: %v", err)
	}
	childPath := filepath.Join(filePath, "child")
	if err := os.WriteFile(childPath, []byte("child"), 0o644); err != nil {
		t.Fatalf("create directory child: %v", err)
	}
	laterFile := models.File{VaultID: ctx.sourceVaultID, UUID: "move-cleanup-continues", Name: "move-cleanup-continues", Type: "quick_fact", MimeType: "text/plain", Size: 1}
	if err := ctx.db.Create(&laterFile).Error; err != nil {
		t.Fatalf("create later quick fact file: %v", err)
	}
	laterQuickFact := models.QuickFact{ContactID: ctx.contact.ID, VaultQuickFactsTemplateID: template.ID, FileID: &laterFile.ID}
	if err := ctx.db.Create(&laterQuickFact).Error; err != nil {
		t.Fatalf("create later quick fact: %v", err)
	}
	laterFilePath := filepath.Join(uploadDir, laterFile.UUID)
	if err := os.WriteFile(laterFilePath, []byte("later file"), 0o644); err != nil {
		t.Fatalf("create later quick fact file path: %v", err)
	}

	// When
	response, err := ctx.moveService.MoveMany([]string{ctx.contact.ID}, ctx.sourceVaultID, ctx.targetVaultID, ctx.userID)

	// Then
	if err != nil {
		t.Fatalf("move contact after committed cleanup failure: %v", err)
	}
	if response.MovedCount != 1 || len(response.Contacts) != 1 || response.Contacts[0].ID != ctx.contact.ID || response.Contacts[0].VaultID != ctx.targetVaultID {
		t.Fatalf("move response = %+v, want committed target contact", response)
	}
	var contact models.Contact
	if err := ctx.db.Where("id = ? AND vault_id = ?", ctx.contact.ID, ctx.targetVaultID).First(&contact).Error; err != nil {
		t.Fatalf("target contact after committed move: %v", err)
	}
	assertContactMoveFileCleanupCount(t, ctx.db, &models.QuickFact{}, quickFact.ID, 0)
	assertContactMoveFileCleanupCount(t, ctx.db, &models.QuickFact{}, laterQuickFact.ID, 0)
	assertContactMoveFileCleanupCount(t, ctx.db, &models.File{}, file.ID, 1)
	assertContactMoveFileCleanupCount(t, ctx.db, &models.File{}, laterFile.ID, 0)
	if info, err := os.Stat(filePath); err != nil || !info.IsDir() {
		t.Fatalf("file path after cleanup failure = (%v, %v), want retained directory", info, err)
	}
	if _, err := os.Stat(childPath); err != nil {
		t.Fatalf("directory child after cleanup failure: %v", err)
	}
	if _, err := os.Stat(laterFilePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("later quick fact file after cleanup continuation: %v", err)
	}
	if events := ctx.recordedRemoteEvents(); len(events) != 2 {
		t.Fatalf("DAV events after cleanup failure = %#v, want source delete and target push", events)
	}
	if !reflect.DeepEqual(ctx.searchEngine.recordedEvents(), []string{"search contact", "search note"}) {
		t.Fatalf("search events after cleanup failure = %#v, want contact and note reindex", ctx.searchEngine.recordedEvents())
	}
	if !reflect.DeepEqual(ctx.recordedLifecycleEvents(), []string{"source DELETE", "target PUT", "search contact", "search note"}) {
		t.Fatalf("lifecycle events after cleanup failure = %#v, want DAV before search", ctx.recordedLifecycleEvents())
	}
	if logText := logOutput.String(); !strings.Contains(logText, fmt.Sprintf("[contact-move] failed to delete moved quick fact file %d:", file.ID)) || !strings.Contains(logText, syscall.ENOTEMPTY.Error()) {
		t.Fatalf("cleanup failure log = %q, want file context and underlying error", logText)
	}
	waitForContactDAVLockRemoval(t, &ctx.pushService.operationLocks, ctx.contact.ID)
}

func captureContactMoveLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	var output bytes.Buffer
	previousWriter := log.Writer()
	log.SetOutput(&output)
	t.Cleanup(func() {
		log.SetOutput(previousWriter)
	})
	return &output
}

func TestVaultFileServiceForceDeleteAllowsMissingPhysicalFile(t *testing.T) {
	// Given
	ctx := setupContactMoveLifecycle(t)
	fileService := NewVaultFileService(ctx.db, t.TempDir())
	file := models.File{VaultID: ctx.sourceVaultID, UUID: "missing-file", Name: "missing-file", Type: "document", MimeType: "text/plain", Size: 1}
	if err := ctx.db.Create(&file).Error; err != nil {
		t.Fatalf("create file: %v", err)
	}

	// When
	err := fileService.ForceDeleteFile(file.ID, ctx.sourceVaultID)

	// Then
	if err != nil {
		t.Fatalf("force delete missing physical file: %v", err)
	}
	assertContactMoveFileCleanupCount(t, ctx.db, &models.File{}, file.ID, 0)
}

func TestVaultFileServiceForceDeletePreservesFileRecordWhenPhysicalRemovalFails(t *testing.T) {
	// Given
	ctx := setupContactMoveLifecycle(t)
	uploadDir := t.TempDir()
	fileService := NewVaultFileService(ctx.db, uploadDir)
	file := models.File{VaultID: ctx.sourceVaultID, UUID: "non-empty-directory", Name: "non-empty-directory", Type: "document", MimeType: "text/plain", Size: 1}
	if err := ctx.db.Create(&file).Error; err != nil {
		t.Fatalf("create file: %v", err)
	}
	filePath := filepath.Join(uploadDir, file.UUID)
	if err := os.Mkdir(filePath, 0o755); err != nil {
		t.Fatalf("create non-empty file path directory: %v", err)
	}
	if err := os.WriteFile(filepath.Join(filePath, "child"), []byte("child"), 0o644); err != nil {
		t.Fatalf("create directory child: %v", err)
	}

	// When
	err := fileService.ForceDeleteFile(file.ID, ctx.sourceVaultID)

	// Then
	if !errors.Is(err, syscall.ENOTEMPTY) {
		t.Fatalf("force delete error = %v, want wrapped non-empty-directory error", err)
	}
	assertContactMoveFileCleanupCount(t, ctx.db, &models.File{}, file.ID, 1)
	if _, err := os.Stat(filepath.Join(filePath, "child")); err != nil {
		t.Fatalf("directory child after failed force delete: %v", err)
	}
}

func assertContactMoveFileCleanupCount(t *testing.T, db *gorm.DB, model any, id uint, want int64) {
	t.Helper()
	var got int64
	if err := db.Model(model).Where("id = ?", id).Count(&got).Error; err != nil || got != want {
		t.Fatalf("%T count for id %d = (%d, %v), want %d", model, id, got, err, want)
	}
}
