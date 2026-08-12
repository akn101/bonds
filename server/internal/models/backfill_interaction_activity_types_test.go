package models

import (
	"testing"

	"github.com/naiba/bonds/internal/i18n"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestInteractionActivityTranslationKeysExistForEverySupportedLocale(t *testing.T) {
	keys := []string{"seed.activity_categories.interactions"}
	for _, def := range interactionActivityTypeDefs {
		keys = append(keys, def.key)
	}

	for _, locale := range i18n.Supported {
		for _, key := range keys {
			if translated := i18n.T(locale, key); translated == key {
				t.Errorf("missing %q translation for locale %q", key, locale)
			}
		}
	}
}

func TestBackfillInteractionActivityTypesSeedsEveryVaultIdempotently(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent), DisableForeignKeyConstraintWhenMigrating: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&Vault{}, &ActivityCategory{}, &ActivityType{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]Vault{{ID: "vault-a"}, {ID: "vault-b"}}).Error; err != nil {
		t.Fatal(err)
	}
	if err := BackfillInteractionActivityTypes(db); err != nil {
		t.Fatal(err)
	}
	if err := BackfillInteractionActivityTypes(db); err != nil {
		t.Fatal(err)
	}
	for _, vaultID := range []string{"vault-a", "vault-b"} {
		var count int64
		if err := db.Model(&ActivityType{}).Joins("JOIN activity_categories ON activity_categories.id = activity_types.activity_category_id").Where("activity_categories.vault_id = ? AND counts_as_interaction = ?", vaultID, true).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 3 {
			t.Fatalf("vault %s interaction types=%d", vaultID, count)
		}
	}
}
