package services

import (
	"sort"

	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

func lockMovedContactDAVOperations(registry *contactDAVOperationLockRegistry, contactIDs []string) func() {
	lockedContactIDs := append([]string(nil), contactIDs...)
	sort.Strings(lockedContactIDs)

	releases := make([]func(), 0, len(lockedContactIDs))
	for _, contactID := range lockedContactIDs {
		releases = append(releases, registry.lock(contactID))
	}
	return func() {
		for index := len(releases) - 1; index >= 0; index-- {
			releases[index]()
		}
	}
}

func captureMovedContactSourceDAVDeleteTargets(tx *gorm.DB, contactIDs []string, sourceVaultID string) ([]contactRemoteDeletionTarget, error) {
	var states []models.ContactSubscriptionState
	if err := tx.Table("contact_subscription_states").
		Joins("JOIN addressbook_subscriptions ON addressbook_subscriptions.id = contact_subscription_states.address_book_subscription_id").
		Where("contact_subscription_states.contact_id IN ? AND addressbook_subscriptions.vault_id = ?", contactIDs, sourceVaultID).
		Order("contact_subscription_states.contact_id ASC, contact_subscription_states.address_book_subscription_id ASC").
		Find(&states).Error; err != nil {
		return nil, err
	}
	targets := make([]contactRemoteDeletionTarget, len(states))
	for index := range states {
		targets[index] = newContactRemoteDeletionTarget(states[index])
	}
	return targets, nil
}

func (s *ContactMoveService) runMovedContactDAVLifecycle(contactIDs []string, sourceTargets []contactRemoteDeletionTarget, targetVaultID string) {
	if s.davPushService == nil {
		return
	}
	s.davPushService.pushCapturedContactDelete(sourceTargets)
	for _, contactID := range contactIDs {
		s.davPushService.pushContactChange(contactID, targetVaultID)
	}
}
