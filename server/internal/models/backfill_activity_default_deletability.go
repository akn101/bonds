package models

import "gorm.io/gorm"

var seededActivityCategoryTranslationKeys = map[string]struct{}{
	"seed.activity_categories.transportation": {},
	"seed.activity_categories.social":         {},
	"seed.activity_categories.sport":          {},
	"seed.activity_categories.work":           {},
}

var seededActivityTypeTranslationKeys = map[string]struct{}{
	"seed.activity_types.rode_a_bike":       {},
	"seed.activity_types.drove":             {},
	"seed.activity_types.walked":            {},
	"seed.activity_types.took_the_bus":      {},
	"seed.activity_types.took_the_metro":    {},
	"seed.activity_types.ate":               {},
	"seed.activity_types.drank":             {},
	"seed.activity_types.went_to_a_bar":     {},
	"seed.activity_types.watched_a_movie":   {},
	"seed.activity_types.watched_tv":        {},
	"seed.activity_types.watched_a_tv_show": {},
	"seed.activity_types.ran":               {},
	"seed.activity_types.played_soccer":     {},
	"seed.activity_types.played_basketball": {},
	"seed.activity_types.played_golf":       {},
	"seed.activity_types.played_tennis":     {},
	"seed.activity_types.took_a_new_job":    {},
	"seed.activity_types.quit_job":          {},
	"seed.activity_types.got_fired":         {},
	"seed.activity_types.had_a_promotion":   {},
}

// BackfillActivityDefaultDeletability repairs vaults seeded before default
// activity categories/types were marked deletable. We scope the update to known seed
// translation keys so user-created rows keep whatever delete policy they already
// had. Idempotent: runs on every boot.
func BackfillActivityDefaultDeletability(db *gorm.DB) error {
	categoryKeys := make([]string, 0, len(seededActivityCategoryTranslationKeys))
	for key := range seededActivityCategoryTranslationKeys {
		categoryKeys = append(categoryKeys, key)
	}
	typeKeys := make([]string, 0, len(seededActivityTypeTranslationKeys))
	for key := range seededActivityTypeTranslationKeys {
		typeKeys = append(typeKeys, key)
	}

	if err := db.Model(&ActivityCategory{}).
		Where("label_translation_key IN ? AND can_be_deleted = ?", categoryKeys, false).
		Update("can_be_deleted", true).Error; err != nil {
		return err
	}

	if err := db.Model(&ActivityType{}).
		Where("label_translation_key IN ? AND can_be_deleted = ?", typeKeys, false).
		Update("can_be_deleted", true).Error; err != nil {
		return err
	}

	return nil
}
