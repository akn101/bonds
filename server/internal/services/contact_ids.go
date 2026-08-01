package services

import (
	"errors"
	"sort"

	"github.com/google/uuid"
	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const maxContactIDsPerRequest = 500

var (
	ErrContactIDsLimitExceeded = errors.New("contact IDs limit exceeded")
	ErrContactIDInvalid        = errors.New("contact ID is invalid")
)

func validateAndDedupeContactIDs(contactIDs []string) ([]string, error) {
	// Enforce the limit before deduplication so repeated IDs cannot bypass it.
	if len(contactIDs) > maxContactIDsPerRequest {
		return nil, ErrContactIDsLimitExceeded
	}
	for _, contactID := range contactIDs {
		parsedID, err := uuid.Parse(contactID)
		if err != nil || parsedID == uuid.Nil {
			return nil, ErrContactIDInvalid
		}
	}
	return dedupeContactIDs(contactIDs), nil
}

func lockContactsBelongToVault(tx *gorm.DB, contactIDs []string, vaultID string) error {
	lockedContactIDs := dedupeContactIDs(append([]string(nil), contactIDs...))
	if len(lockedContactIDs) == 0 {
		return nil
	}
	sort.Strings(lockedContactIDs)

	var contacts []models.Contact
	if err := tx.Clauses(clause.Locking{Strength: clause.LockingStrengthUpdate}).
		Where("id IN ? AND vault_id = ?", lockedContactIDs, vaultID).
		Order("id ASC").
		Find(&contacts).Error; err != nil {
		return err
	}
	if len(contacts) != len(lockedContactIDs) {
		return ErrContactNotFound
	}
	return nil
}
