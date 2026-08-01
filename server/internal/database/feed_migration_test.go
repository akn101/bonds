package database

import (
	"testing"

	"github.com/naiba/bonds/internal/models"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestAutoMigrateBackfillsLegacyFeedEventContext(t *testing.T) {
	// Given
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(models.AllModels()...); err != nil {
		t.Fatalf("create legacy feed schema: %v", err)
	}
	account := models.Account{ID: "feed-migration-account"}
	vault := models.Vault{ID: "feed-migration-vault", AccountID: account.ID, Name: "Feed Migration", Type: "personal"}
	firstName, lastName := "Legacy", "Contact"
	contact := models.Contact{ID: "legacy-feed-contact", VaultID: vault.ID, FirstName: &firstName, LastName: &lastName}
	normalFirstName, normalLastName := "Normal", "Contact"
	normalContact := models.Contact{ID: "normal-feed-contact", VaultID: vault.ID, FirstName: &normalFirstName, LastName: &normalLastName}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("create account: %v", err)
	}
	if err := db.Create(&vault).Error; err != nil {
		t.Fatalf("create vault: %v", err)
	}
	if err := db.Create(&contact).Error; err != nil {
		t.Fatalf("create contact: %v", err)
	}
	if err := db.Create(&normalContact).Error; err != nil {
		t.Fatalf("create normal contact: %v", err)
	}
	legacy := models.ContactFeedItem{ContactID: contact.ID, Action: "note_created"}
	normal := models.ContactFeedItem{ContactID: normalContact.ID, Action: "note_created"}
	preserved := models.ContactFeedItem{ContactID: contact.ID, Action: "note_created"}
	orphan := models.ContactFeedItem{ContactID: "missing-contact", Action: "note_created"}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatalf("create legacy feed item: %v", err)
	}
	if err := db.Create(&normal).Error; err != nil {
		t.Fatalf("create normal feed item: %v", err)
	}
	if err := db.Create(&preserved).Error; err != nil {
		t.Fatalf("create preserved feed item: %v", err)
	}
	if err := db.Create(&orphan).Error; err != nil {
		t.Fatalf("create orphan feed item: %v", err)
	}
	if err := db.Exec("UPDATE contact_feed_items SET vault_id = ?, contact_name_snapshot = ? WHERE id = ?", "preserved-vault", "Preserved Name", preserved.ID).Error; err != nil {
		t.Fatalf("set preserved feed context: %v", err)
	}
	if err := db.Model(&models.Contact{}).Where("id = ?", contact.ID).Delete(&models.Contact{}).Error; err != nil {
		t.Fatalf("soft delete legacy contact: %v", err)
	}

	// When
	err = AutoMigrate(db)

	// Then
	if err != nil {
		t.Fatalf("migrate legacy feed schema: %v", err)
	}
	var rows []struct {
		ID                  uint
		VaultID             string
		ContactNameSnapshot string
	}
	if err := db.Table("contact_feed_items").Select("id, vault_id, contact_name_snapshot").Order("id").Scan(&rows).Error; err != nil {
		t.Fatalf("load backfilled feed rows: %v", err)
	}
	if len(rows) != 4 {
		t.Fatalf("backfilled row count = %d, want 4", len(rows))
	}
	if rows[0].VaultID != vault.ID || rows[0].ContactNameSnapshot != "Legacy Contact" {
		t.Errorf("legacy row = (%q, %q), want (%q, %q)", rows[0].VaultID, rows[0].ContactNameSnapshot, vault.ID, "Legacy Contact")
	}
	if rows[1].VaultID != vault.ID || rows[1].ContactNameSnapshot != "Normal Contact" {
		t.Errorf("normal row = (%q, %q), want (%q, %q)", rows[1].VaultID, rows[1].ContactNameSnapshot, vault.ID, "Normal Contact")
	}
	if rows[2].VaultID != "preserved-vault" || rows[2].ContactNameSnapshot != "Preserved Name" {
		t.Errorf("preserved row = (%q, %q), want unchanged values", rows[2].VaultID, rows[2].ContactNameSnapshot)
	}
	if rows[3].VaultID != "" || rows[3].ContactNameSnapshot != "" {
		t.Errorf("orphan row = (%q, %q), want empty context", rows[3].VaultID, rows[3].ContactNameSnapshot)
	}
	if err := AutoMigrate(db); err != nil {
		t.Fatalf("second migration: %v", err)
	}
	var secondPass []struct {
		ID                  uint
		VaultID             string
		ContactNameSnapshot string
	}
	if err := db.Table("contact_feed_items").Select("id, vault_id, contact_name_snapshot").Order("id").Scan(&secondPass).Error; err != nil {
		t.Fatalf("load second migration rows: %v", err)
	}
	for index := range rows {
		if rows[index] != secondPass[index] {
			t.Errorf("second migration changed row %d: got %+v, want %+v", index, secondPass[index], rows[index])
		}
	}
}
