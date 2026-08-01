package services

import (
	"errors"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrGroupMembersEmpty         = errors.New("group members list is empty")
	ErrGroupMembersLimitExceeded = errors.New("group members limit exceeded")
)

func (s *GroupService) AddMembers(groupID uint, vaultID string, req dto.GroupMembersRequest) (int64, error) {
	contactIDs, err := validateGroupMemberIDs(req.ContactIDs)
	if err != nil {
		return 0, err
	}
	var affectedCount int64
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := validateGroupBelongsToVault(tx, groupID, vaultID); err != nil {
			return err
		}
		if err := lockContactsBelongToVault(tx, contactIDs, vaultID); err != nil {
			return err
		}
		if err := lockGroupBelongsToVault(tx, groupID, vaultID); err != nil {
			return err
		}
		rows := make([]models.ContactGroup, 0, len(contactIDs))
		for _, contactID := range contactIDs {
			rows = append(rows, models.ContactGroup{GroupID: groupID, ContactID: contactID})
		}
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&rows)
		if result.Error != nil {
			return result.Error
		}
		affectedCount = result.RowsAffected
		return nil
	})
	return affectedCount, err
}

func (s *GroupService) RemoveMembers(groupID uint, vaultID string, req dto.GroupMembersRequest) (int64, error) {
	contactIDs, err := validateGroupMemberIDs(req.ContactIDs)
	if err != nil {
		return 0, err
	}
	var affectedCount int64
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := validateGroupBelongsToVault(tx, groupID, vaultID); err != nil {
			return err
		}
		if err := lockContactsBelongToVault(tx, contactIDs, vaultID); err != nil {
			return err
		}
		if err := lockGroupBelongsToVault(tx, groupID, vaultID); err != nil {
			return err
		}
		result := tx.Where("group_id = ? AND contact_id IN ?", groupID, contactIDs).Delete(&models.ContactGroup{})
		if result.Error != nil {
			return result.Error
		}
		affectedCount = result.RowsAffected
		return nil
	})
	return affectedCount, err
}

func validateGroupMemberIDs(contactIDs []string) ([]string, error) {
	uniqueContactIDs, err := validateAndDedupeContactIDs(contactIDs)
	if errors.Is(err, ErrContactIDsLimitExceeded) {
		return nil, ErrGroupMembersLimitExceeded
	}
	if err != nil {
		return nil, err
	}
	if len(uniqueContactIDs) == 0 {
		return nil, ErrGroupMembersEmpty
	}
	return uniqueContactIDs, nil
}

func validateGroupBelongsToVault(db *gorm.DB, groupID uint, vaultID string) error {
	var group models.Group
	if err := db.
		Select("id").
		Where("id = ? AND vault_id = ?", groupID, vaultID).
		First(&group).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrGroupNotFound
		}
		return err
	}
	return nil
}

func lockGroupBelongsToVault(tx *gorm.DB, groupID uint, vaultID string) error {
	var group models.Group
	if err := tx.Clauses(clause.Locking{Strength: clause.LockingStrengthUpdate}).
		Select("id").
		Where("id = ? AND vault_id = ?", groupID, vaultID).
		First(&group).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrGroupNotFound
		}
		return err
	}
	return nil
}
