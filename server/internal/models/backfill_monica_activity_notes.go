package models

import (
	"strings"

	"gorm.io/gorm"
)

// BackfillMonicaActivityNotes converts the temporary Monica activity-as-note
// representation into one participant-aware activity. It is safe to rerun.
func BackfillMonicaActivityNotes(db *gorm.DB) error {
	var notes []Note
	if err := db.Where("source_type = ? AND source_uuid IS NOT NULL", "monica_activity").Order("vault_id, source_uuid, id").Find(&notes).Error; err != nil {
		return err
	}
	groups := make(map[string][]Note)
	for _, note := range notes {
		key := note.VaultID + "\x00" + valueOf(note.SourceUUID)
		groups[key] = append(groups[key], note)
	}
	for _, group := range groups {
		if err := db.Transaction(func(tx *gorm.DB) error {
			first := group[0]
			var event Activity
			err := tx.Where("vault_id = ? AND source_type = ? AND source_uuid = ?", first.VaultID, "monica_activity", valueOf(first.SourceUUID)).First(&event).Error
			if err != nil && err != gorm.ErrRecordNotFound {
				return err
			}
			if err == gorm.ErrRecordNotFound {
				category, err := importedActivityCategory(tx, first.VaultID)
				if err != nil {
					return err
				}
				typeName, title, description := parseActivityNote(first.Body)
				var eventType ActivityType
				if err := tx.Where("activity_category_id = ? AND label = ?", category.ID, typeName).First(&eventType).Error; err != nil {
					if err != gorm.ErrRecordNotFound {
						return err
					}
					eventType = ActivityType{ActivityCategoryID: category.ID, Label: strPtr(typeName), CanBeDeleted: true}
					if err := tx.Create(&eventType).Error; err != nil {
						return err
					}
				}
				sourceType, sourceUUID := "monica_activity", valueOf(first.SourceUUID)
				event = Activity{VaultID: first.VaultID, ActivityTypeID: &eventType.ID, Title: title, Description: optionalString(description), StartDate: first.HappenedAt, StartPrecision: "day", EndStatus: "none", CalendarType: "gregorian", SourceType: &sourceType, SourceUUID: &sourceUUID, CreatedAt: first.CreatedAt, UpdatedAt: first.UpdatedAt}
				if err := tx.Create(&event).Error; err != nil {
					return err
				}
			}
			for _, note := range group {
				pivot := ActivityParticipant{ActivityID: event.ID, ContactID: note.ContactID}
				if err := tx.Where("activity_id = ? AND contact_id = ?", event.ID, note.ContactID).FirstOrCreate(&pivot).Error; err != nil {
					return err
				}
			}
			ids := make([]uint, len(group))
			for i := range group {
				ids[i] = group[i].ID
			}
			return tx.Where("id IN ?", ids).Delete(&Note{}).Error
		}); err != nil {
			return err
		}
	}
	return nil
}

func importedActivityCategory(tx *gorm.DB, vaultID string) (ActivityCategory, error) {
	const key = "system.imported_activities"
	var category ActivityCategory
	if err := tx.Where("vault_id = ? AND label_translation_key = ?", vaultID, key).First(&category).Error; err == nil {
		return category, nil
	} else if err != gorm.ErrRecordNotFound {
		return category, err
	}
	label := "Imported activities"
	category = ActivityCategory{VaultID: vaultID, Label: &label, LabelTranslationKey: strPtr(key), CanBeDeleted: true}
	return category, tx.Create(&category).Error
}

func parseActivityNote(body string) (string, string, string) {
	first, description, _ := strings.Cut(body, "\n")
	typeName, title := "Imported activity", strings.TrimSpace(first)
	if strings.HasPrefix(first, "[Activity: ") {
		if end := strings.Index(first, "]"); end > len("[Activity: ") {
			typeName = strings.TrimSpace(first[len("[Activity: "):end])
			title = strings.TrimSpace(first[end+1:])
		}
	}
	if title == "" {
		title = typeName
	}
	return typeName, title, strings.TrimSpace(description)
}

func valueOf(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
func optionalString(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return &value
}
