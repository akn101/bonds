package services

import (
	"time"

	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

type postContactUpdate struct {
	vaultID    string
	contactIDs []string
	writtenAt  time.Time
}

func createContactPostAssociations(tx *gorm.DB, postID uint, contactIDs []string) error {
	if len(contactIDs) == 0 {
		return nil
	}
	rows := make([]models.ContactPost, 0, len(contactIDs))
	for _, contactID := range contactIDs {
		rows = append(rows, models.ContactPost{PostID: postID, ContactID: contactID})
	}
	return tx.Create(&rows).Error
}

func advanceContactsLastTalkedTo(tx *gorm.DB, update postContactUpdate) error {
	if len(update.contactIDs) == 0 {
		return nil
	}
	var contacts []models.Contact
	if err := tx.Where("vault_id = ? AND id IN ?", update.vaultID, update.contactIDs).Find(&contacts).Error; err != nil {
		return err
	}
	for index := range contacts {
		contact := &contacts[index]
		if contact.LastTalkedTo != nil && !contact.LastTalkedTo.Before(update.writtenAt) {
			continue
		}
		triggerDate := calculateStayInTouchTriggerDate(&update.writtenAt, contact.StayInTouchFrequencyDays)
		if err := tx.Model(&models.Contact{}).
			Where("id = ? AND vault_id = ? AND (last_talked_to IS NULL OR last_talked_to < ?)", contact.ID, update.vaultID, update.writtenAt).
			Updates(map[string]interface{}{
				"last_talked_to":             update.writtenAt,
				"stay_in_touch_trigger_date": triggerDate,
				"last_updated_at":            time.Now(),
			}).Error; err != nil {
			return err
		}
	}
	return nil
}
