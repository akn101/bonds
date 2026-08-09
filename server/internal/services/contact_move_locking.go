package services

import (
	"sort"

	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func loadMovableContacts(tx *gorm.DB, contactIDs []string, currentVaultID string) ([]models.Contact, error) {
	lockedContactIDs := append([]string(nil), contactIDs...)
	sort.Strings(lockedContactIDs)

	var contacts []models.Contact
	if err := tx.Clauses(clause.Locking{Strength: clause.LockingStrengthUpdate}).
		Where("id IN ? AND vault_id = ? AND can_be_deleted = ?", lockedContactIDs, currentVaultID, true).
		Order("id ASC").
		Find(&contacts).Error; err != nil {
		return nil, err
	}
	if len(contacts) != len(contactIDs) {
		return nil, ErrContactNotFound
	}
	contactsByID := make(map[string]models.Contact, len(contacts))
	for _, contact := range contacts {
		contactsByID[contact.ID] = contact
	}
	contactsInRequestOrder := make([]models.Contact, 0, len(contactIDs))
	for _, contactID := range contactIDs {
		contactsInRequestOrder = append(contactsInRequestOrder, contactsByID[contactID])
	}
	return contactsInRequestOrder, nil
}
