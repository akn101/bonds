package services

import (
	"fmt"
	"time"

	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

func scheduleAllContactReminders(db *gorm.DB, channelID uint, userID string) error {
	var channel models.UserNotificationChannel
	if err := db.Preload("User").Where("id = ? AND user_id = ?", channelID, userID).First(&channel).Error; err != nil {
		return fmt.Errorf("channel load: %w", err)
	}
	if !channel.Active {
		return nil
	}

	var vaultIDs []string
	if err := db.Model(&models.UserVault{}).Where("user_id = ?", userID).Pluck("vault_id", &vaultIDs).Error; err != nil {
		return fmt.Errorf("vault pluck: %w", err)
	}
	if len(vaultIDs) == 0 {
		return nil
	}

	var contacts []models.Contact
	if err := db.Where("vault_id IN ?", vaultIDs).Find(&contacts).Error; err != nil {
		return fmt.Errorf("contact load: %w", err)
	}
	for index := range contacts {
		if err := scheduleAudienceRemindersForChannel(db, &contacts[index], &channel, userID, time.Now()); err != nil {
			return err
		}
	}
	return nil
}

func scheduleAllVaultUserRemindersForNewMember(db *gorm.DB, vaultID, userID string, now time.Time) error {
	var channels []models.UserNotificationChannel
	if err := db.Preload("User").Where("user_id = ? AND active = ?", userID, true).Find(&channels).Error; err != nil {
		return fmt.Errorf("active channel load: %w", err)
	}
	if len(channels) == 0 {
		return nil
	}

	var contacts []models.Contact
	if err := db.Where("vault_id = ?", vaultID).Find(&contacts).Error; err != nil {
		return fmt.Errorf("contact load: %w", err)
	}
	for contactIndex := range contacts {
		var reminders []models.ContactReminder
		if err := db.Where("contact_id = ?", contacts[contactIndex].ID).Find(&reminders).Error; err != nil {
			return fmt.Errorf("reminder load: %w", err)
		}
		for reminderIndex := range reminders {
			reminder := &reminders[reminderIndex]
			if reminderAudienceOrDefault(reminder.Audience) != models.ReminderAudienceAllVaultUsers {
				continue
			}
			for channelIndex := range channels {
				if err := ensureFuturePendingReminderSchedule(db, reminder, &channels[channelIndex], now); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func scheduleAudienceRemindersForChannel(db *gorm.DB, contact *models.Contact, channel *models.UserNotificationChannel, userID string, now time.Time) error {
	var reminders []models.ContactReminder
	if err := db.Where("contact_id = ?", contact.ID).Find(&reminders).Error; err != nil {
		return fmt.Errorf("reminder load: %w", err)
	}
	for reminderIndex := range reminders {
		included, err := reminderAudienceIncludesUser(db, &reminders[reminderIndex], contact.VaultID, userID)
		if err != nil {
			return err
		}
		if !included {
			continue
		}
		if err := ensureFuturePendingReminderSchedule(db, &reminders[reminderIndex], channel, now); err != nil {
			return err
		}
	}
	return nil
}

func reminderAudienceIncludesUser(db *gorm.DB, reminder *models.ContactReminder, vaultID, userID string) (bool, error) {
	var membershipCount int64
	if err := db.Model(&models.UserVault{}).Where("vault_id = ? AND user_id = ?", vaultID, userID).Count(&membershipCount).Error; err != nil {
		return false, fmt.Errorf("vault membership check: %w", err)
	}
	if membershipCount == 0 {
		return false, nil
	}
	recipientIDs, err := reminderAudienceUserIDs(db, reminder, vaultID)
	if err != nil {
		return false, fmt.Errorf("reminder audience load: %w", err)
	}
	for _, recipientID := range recipientIDs {
		if recipientID == userID {
			return true, nil
		}
	}
	return false, nil
}

func ensureFuturePendingReminderSchedule(db *gorm.DB, reminder *models.ContactReminder, channel *models.UserNotificationChannel, now time.Time) error {
	scheduledAt := calcInitialSchedule(reminder, channel.PreferredTime, userLocation(channel.User)).UTC()
	// Joining after an occurrence became due must not retroactively authorize a catch-up delivery.
	if !scheduledAt.After(now) {
		return nil
	}
	var existing models.ContactReminderScheduled
	err := db.Where("user_notification_channel_id = ? AND contact_reminder_id = ? AND triggered_at IS NULL", channel.ID, reminder.ID).First(&existing).Error
	if err == nil {
		return nil
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return fmt.Errorf("pending schedule load: %w", err)
	}
	if err := db.Create(&models.ContactReminderScheduled{
		UserNotificationChannelID: channel.ID,
		ContactReminderID:         reminder.ID,
		ScheduledAt:               scheduledAt,
	}).Error; err != nil {
		return fmt.Errorf("pending schedule create: %w", err)
	}
	return nil
}
