package models

import (
	"github.com/naiba/bonds/internal/i18n"
	"gorm.io/gorm"
)

// BackfillInteractionLifeEventTypes adds the system interaction types to vaults
// created before those defaults existed. The stable SystemKind makes the
// operation idempotent even when users rename the labels.
func BackfillInteractionLifeEventTypes(db *gorm.DB) error {
	var vaultIDs []string
	if err := db.Model(&Vault{}).Pluck("id", &vaultIDs).Error; err != nil {
		return err
	}
	for _, vaultID := range vaultIDs {
		if err := db.Transaction(func(tx *gorm.DB) error {
			var count int64
			if err := tx.Model(&LifeEventType{}).
				Joins("JOIN life_event_categories ON life_event_categories.id = life_event_types.life_event_category_id").
				Where("life_event_categories.vault_id = ? AND life_event_types.system_kind IS NOT NULL", vaultID).
				Count(&count).Error; err != nil {
				return err
			}
			if count == int64(len(interactionLifeEventTypeDefs)) {
				return nil
			}
			categoryKey := "seed.life_event_categories.interactions"
			var category LifeEventCategory
			if err := tx.Where("vault_id = ? AND label_translation_key = ?", vaultID, categoryKey).First(&category).Error; err != nil {
				if err != gorm.ErrRecordNotFound {
					return err
				}
				position := 5
				category = LifeEventCategory{VaultID: vaultID, Label: strPtr(i18n.T("en", categoryKey)), LabelTranslationKey: &categoryKey, Position: &position, CanBeDeleted: true}
				if err := tx.Create(&category).Error; err != nil {
					return err
				}
			}
			for idx, def := range interactionLifeEventTypeDefs {
				var existing int64
				if err := tx.Model(&LifeEventType{}).
					Joins("JOIN life_event_categories ON life_event_categories.id = life_event_types.life_event_category_id").
					Where("life_event_categories.vault_id = ? AND life_event_types.system_kind = ?", vaultID, def.systemKind).
					Count(&existing).Error; err != nil {
					return err
				}
				if existing > 0 {
					continue
				}
				position := idx + 1
				def := def
				item := LifeEventType{LifeEventCategoryID: category.ID, Label: strPtr(i18n.T("en", def.key)), LabelTranslationKey: strPtr(def.key), Position: &position, CanBeDeleted: true, SystemKind: &def.systemKind, Icon: &def.icon, Color: &def.color, CountsAsInteraction: true}
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
