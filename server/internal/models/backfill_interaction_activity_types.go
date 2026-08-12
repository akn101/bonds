package models

import (
	"github.com/naiba/bonds/internal/i18n"
	"gorm.io/gorm"
)

// BackfillInteractionActivityTypes adds the system interaction types to vaults
// created before those defaults existed. The stable SystemKind makes the
// operation idempotent even when users rename the labels.
func BackfillInteractionActivityTypes(db *gorm.DB) error {
	var vaultIDs []string
	if err := db.Model(&Vault{}).Pluck("id", &vaultIDs).Error; err != nil {
		return err
	}
	for _, vaultID := range vaultIDs {
		if err := db.Transaction(func(tx *gorm.DB) error {
			var count int64
			if err := tx.Model(&ActivityType{}).
				Joins("JOIN activity_categories ON activity_categories.id = activity_types.activity_category_id").
				Where("activity_categories.vault_id = ? AND activity_types.system_kind IS NOT NULL", vaultID).
				Count(&count).Error; err != nil {
				return err
			}
			if count == int64(len(interactionActivityTypeDefs)) {
				return nil
			}
			categoryKey := "seed.activity_categories.interactions"
			var category ActivityCategory
			if err := tx.Where("vault_id = ? AND label_translation_key = ?", vaultID, categoryKey).First(&category).Error; err != nil {
				if err != gorm.ErrRecordNotFound {
					return err
				}
				position := 5
				category = ActivityCategory{VaultID: vaultID, Label: strPtr(i18n.T("en", categoryKey)), LabelTranslationKey: &categoryKey, Position: &position, CanBeDeleted: true}
				if err := tx.Create(&category).Error; err != nil {
					return err
				}
			}
			for idx, def := range interactionActivityTypeDefs {
				var existing int64
				if err := tx.Model(&ActivityType{}).
					Joins("JOIN activity_categories ON activity_categories.id = activity_types.activity_category_id").
					Where("activity_categories.vault_id = ? AND activity_types.system_kind = ?", vaultID, def.systemKind).
					Count(&existing).Error; err != nil {
					return err
				}
				if existing > 0 {
					continue
				}
				position := idx + 1
				def := def
				item := ActivityType{ActivityCategoryID: category.ID, Label: strPtr(i18n.T("en", def.key)), LabelTranslationKey: strPtr(def.key), Position: &position, CanBeDeleted: true, SystemKind: &def.systemKind, Icon: &def.icon, Color: &def.color, CountsAsInteraction: true}
				if err := tx.Create(&item).Error; err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			return err
		}
	}
	return nil
}
