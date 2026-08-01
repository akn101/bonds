package services

import (
	"errors"

	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type contactDeletionWork struct {
	contactID           string
	noteIDs             []uint
	remoteDeleteTargets []contactRemoteDeletionTarget
}

func (s *ContactService) DeleteContact(contactID, vaultID string) error {
	var releaseDAVOperation func()
	if s.davPushService != nil {
		releaseDAVOperation = s.davPushService.operationLocks.lock(contactID)
	}
	releaseDAVOperationAfterCommit := false
	defer func() {
		if releaseDAVOperation != nil && !releaseDAVOperationAfterCommit {
			releaseDAVOperation()
		}
	}()

	work := contactDeletionWork{contactID: contactID}
	if err := s.db.Transaction(func(tx *gorm.DB) error {
		var contact models.Contact
		if err := tx.Clauses(clause.Locking{Strength: clause.LockingStrengthUpdate}).Where("id = ? AND vault_id = ?", contactID, vaultID).First(&contact).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrContactNotFound
			}
			return err
		}
		if err := tx.Model(&models.Note{}).Where("contact_id = ?", contact.ID).Pluck("id", &work.noteIDs).Error; err != nil {
			return err
		}
		var states []models.ContactSubscriptionState
		if err := tx.Where("contact_id = ?", contact.ID).Find(&states).Error; err != nil {
			return err
		}
		work.remoteDeleteTargets = make([]contactRemoteDeletionTarget, len(states))
		for index := range states {
			work.remoteDeleteTargets[index] = newContactRemoteDeletionTarget(states[index])
		}
		if err := tx.Where("contact_id = ?", contact.ID).Delete(&models.ContactVaultUser{}).Error; err != nil {
			return err
		}
		reminderIDs := tx.Model(&models.ContactReminder{}).Select("id").Where("contact_id = ?", contact.ID)
		if err := tx.Where("contact_reminder_id IN (?) AND triggered_at IS NULL", reminderIDs).Delete(&models.ContactReminderScheduled{}).Error; err != nil {
			return err
		}
		if err := tx.Where("contact_id = ?", contact.ID).Delete(&models.ContactSubscriptionState{}).Error; err != nil {
			return err
		}
		deleteResult := tx.Delete(&contact)
		if deleteResult.Error != nil {
			return deleteResult.Error
		}
		if deleteResult.RowsAffected != 1 {
			return ErrContactNotFound
		}
		if s.feedRecorder != nil {
			if err := NewFeedRecorder(tx).Record(contact.ID, "", ActionContactDeleted, "Deleted contact", nil, nil); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return err
	}

	// Search and DAV cannot move into the transaction: neither side effect can roll back with the database.
	if s.searchService != nil {
		_ = s.searchService.DeleteContact(work.contactID)
		for _, noteID := range work.noteIDs {
			_ = s.searchService.DeleteNote(noteID)
		}
	}
	if s.davPushService != nil && len(work.remoteDeleteTargets) > 0 {
		releaseDAVOperationAfterCommit = true
		// The worker owns the DAV lock after commit so remote deletion cannot race a later push.
		go func() {
			defer releaseDAVOperation()
			s.davPushService.pushCapturedContactDelete(work.remoteDeleteTargets)
		}()
	}
	return nil
}
