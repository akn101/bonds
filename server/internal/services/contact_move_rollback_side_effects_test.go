package services

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

func TestContactMoveRollbackSuppressesDavSearchAndQuickFactFileSideEffects(t *testing.T) {
	// Given
	ctx := setupContactMoveLifecycle(t)
	uploadDir := t.TempDir()
	ctx.moveService.SetFileService(NewVaultFileService(ctx.db, uploadDir))
	label := "source-only"
	template := models.VaultQuickFactsTemplate{VaultID: ctx.sourceVaultID, Label: &label, FieldType: "document"}
	if err := ctx.db.Create(&template).Error; err != nil {
		t.Fatalf("create quick fact template: %v", err)
	}
	file := models.File{VaultID: ctx.sourceVaultID, UUID: "rollback-quick-fact", Name: "rollback-quick-fact", Type: "quick_fact", MimeType: "text/plain", Size: 1}
	if err := ctx.db.Create(&file).Error; err != nil {
		t.Fatalf("create quick fact file: %v", err)
	}
	quickFact := models.QuickFact{ContactID: ctx.contact.ID, VaultQuickFactsTemplateID: template.ID, FileID: &file.ID}
	if err := ctx.db.Create(&quickFact).Error; err != nil {
		t.Fatalf("create quick fact: %v", err)
	}
	filePath := filepath.Join(uploadDir, file.UUID)
	if err := os.WriteFile(filePath, []byte("quick fact"), 0o644); err != nil {
		t.Fatalf("write quick fact file: %v", err)
	}
	forcedErr := errors.New("forced source DAV state cleanup failure")
	const callbackName = "contact_move_lifecycle_source_state_cleanup_failure"
	if err := ctx.db.Callback().Delete().Before("gorm:delete").Register(callbackName, func(tx *gorm.DB) {
		if tx.Statement.Table == "contact_subscription_states" {
			tx.AddError(forcedErr)
		}
	}); err != nil {
		t.Fatalf("register source state cleanup callback: %v", err)
	}
	t.Cleanup(func() {
		if err := ctx.db.Callback().Delete().Remove(callbackName); err != nil {
			t.Errorf("remove source state cleanup callback: %v", err)
		}
	})

	// When
	_, err := ctx.moveService.MoveMany([]string{ctx.contact.ID}, ctx.sourceVaultID, ctx.targetVaultID, ctx.userID)

	// Then
	if !errors.Is(err, forcedErr) {
		t.Fatalf("move error = %v, want wrapped %v", err, forcedErr)
	}
	var contact models.Contact
	if err := ctx.db.Where("id = ? AND vault_id = ?", ctx.contact.ID, ctx.sourceVaultID).First(&contact).Error; err != nil {
		t.Fatalf("source contact after rollback: %v", err)
	}
	for _, modelAndID := range []struct {
		model any
		id    uint
	}{{&models.QuickFact{}, quickFact.ID}, {&models.File{}, file.ID}, {&models.ContactSubscriptionState{}, ctx.sourceState.ID}} {
		var count int64
		if err := ctx.db.Model(modelAndID.model).Where("id = ?", modelAndID.id).Count(&count).Error; err != nil || count != 1 {
			t.Fatalf("rollback row %T count = (%d, %v), want 1", modelAndID.model, count, err)
		}
	}
	if _, err := os.Stat(filePath); err != nil {
		t.Fatalf("quick fact disk file after rollback: %v", err)
	}
	if events := ctx.recordedRemoteEvents(); len(events) != 0 {
		t.Fatalf("remote events after rollback = %#v, want none", events)
	}
	if events := ctx.searchEngine.recordedEvents(); len(events) != 0 {
		t.Fatalf("search events after rollback = %#v, want none", events)
	}
	var logs int64
	if err := ctx.db.Model(&models.DavSyncLog{}).Where("contact_id = ? AND address_book_subscription_id = ?", ctx.contact.ID, ctx.sourceSubscription.ID).Count(&logs).Error; err != nil || logs != 0 {
		t.Fatalf("source DAV logs after rollback = (%d, %v), want 0", logs, err)
	}
}
