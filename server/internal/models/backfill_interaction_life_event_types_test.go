package models

import (
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestBackfillInteractionLifeEventTypesSeedsEveryVaultIdempotently(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent), DisableForeignKeyConstraintWhenMigrating: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&Vault{}, &LifeEventCategory{}, &LifeEventType{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]Vault{{ID: "vault-a"}, {ID: "vault-b"}}).Error; err != nil {
		t.Fatal(err)
	}
	if err := BackfillInteractionLifeEventTypes(db); err != nil {
		t.Fatal(err)
	}
	if err := BackfillInteractionLifeEventTypes(db); err != nil {
		t.Fatal(err)
	}
	for _, vaultID := range []string{"vault-a", "vault-b"} {
		var count int64
		if err := db.Model(&LifeEventType{}).Joins("JOIN life_event_categories ON life_event_categories.id = life_event_types.life_event_category_id").Where("life_event_categories.vault_id = ? AND counts_as_interaction = ?", vaultID, true).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 3 {
			t.Fatalf("vault %s interaction types=%d", vaultID, count)
		}
	}
}
