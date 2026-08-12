package models

import (
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func setupActivityDefaultDeletabilityBackfillDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger:                                   logger.Default.LogMode(logger.Silent),
		DisableForeignKeyConstraintWhenMigrating: true,
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&ActivityCategory{}, &ActivityType{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func TestBackfillActivityDefaultDeletabilityMarksOnlySeededRowsDeletable(t *testing.T) {
	db := setupActivityDefaultDeletabilityBackfillDB(t)

	seededCategoryKey := "seed.activity_categories.social"
	customCategoryKey := "custom.category"
	seededTypeKey := "seed.activity_types.ate"
	customTypeKey := "custom.type"

	categories := []ActivityCategory{
		{VaultID: "vault-1", Label: strPtr("Social"), LabelTranslationKey: &seededCategoryKey, CanBeDeleted: false},
		{VaultID: "vault-1", Label: strPtr("Mapped custom category"), LabelTranslationKey: &customCategoryKey, CanBeDeleted: false},
		{VaultID: "vault-1", Label: strPtr("User category"), CanBeDeleted: false},
	}
	if err := db.Create(&categories).Error; err != nil {
		t.Fatalf("create categories: %v", err)
	}

	types := []ActivityType{
		{ActivityCategoryID: categories[0].ID, Label: strPtr("Ate"), LabelTranslationKey: &seededTypeKey, CanBeDeleted: false},
		{ActivityCategoryID: categories[0].ID, Label: strPtr("Mapped custom type"), LabelTranslationKey: &customTypeKey, CanBeDeleted: false},
		{ActivityCategoryID: categories[0].ID, Label: strPtr("User type"), CanBeDeleted: false},
	}
	if err := db.Create(&types).Error; err != nil {
		t.Fatalf("create types: %v", err)
	}

	if err := BackfillActivityDefaultDeletability(db); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	if err := BackfillActivityDefaultDeletability(db); err != nil {
		t.Fatalf("backfill second run: %v", err)
	}

	var reloadedCategories []ActivityCategory
	if err := db.Order("id ASC").Find(&reloadedCategories).Error; err != nil {
		t.Fatalf("reload categories: %v", err)
	}
	if !reloadedCategories[0].CanBeDeleted {
		t.Fatalf("expected seeded category to become deletable")
	}
	if reloadedCategories[1].CanBeDeleted {
		t.Fatalf("expected custom keyed category to remain unchanged")
	}
	if reloadedCategories[2].CanBeDeleted {
		t.Fatalf("expected user category without seed key to remain unchanged")
	}

	var reloadedTypes []ActivityType
	if err := db.Order("id ASC").Find(&reloadedTypes).Error; err != nil {
		t.Fatalf("reload types: %v", err)
	}
	if !reloadedTypes[0].CanBeDeleted {
		t.Fatalf("expected seeded type to become deletable")
	}
	if reloadedTypes[1].CanBeDeleted {
		t.Fatalf("expected custom keyed type to remain unchanged")
	}
	if reloadedTypes[2].CanBeDeleted {
		t.Fatalf("expected user type without seed key to remain unchanged")
	}
}
