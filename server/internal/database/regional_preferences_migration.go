package database

import (
	"github.com/naiba/bonds/internal/i18n"
	"github.com/naiba/bonds/internal/models"
	userTimezone "github.com/naiba/bonds/internal/timezone"
	"gorm.io/gorm"
)

type userRegionalPreference struct {
	ID       string
	Timezone *string
	Locale   string
}

// normalizeUserRegionalPreferences repairs legacy empty, invalid, and
// non-canonical regional preferences. User.Timezone and User.Locale remain the
// only persisted sources of truth after this idempotent startup migration.
func normalizeUserRegionalPreferences(db *gorm.DB) error {
	var users []userRegionalPreference
	if err := db.Model(&models.User{}).Select("id", "timezone", "locale").Find(&users).Error; err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		for _, user := range users {
			timezone := userTimezone.Default
			if user.Timezone != nil {
				if normalized, err := userTimezone.Normalize(*user.Timezone); err == nil {
					timezone = normalized
				}
			}
			locale := i18n.Default
			if matched, ok := i18n.Match(user.Locale); ok {
				locale = matched
			}
			if user.Timezone != nil && *user.Timezone == timezone && user.Locale == locale {
				continue
			}
			if err := tx.Model(&models.User{}).Where("id = ?", user.ID).UpdateColumns(map[string]interface{}{
				"timezone": timezone,
				"locale":   locale,
			}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// normalizePendingReminderScheduleTimes converts legacy SQLite values such as
// "09:00:00+10:00" to their UTC instant. SQLite otherwise compares those
// DATETIME strings lexically against the scheduler's UTC clock, delaying or
// advancing delivery by the user's offset. PostgreSQL timestamptz already
// normalizes instants and needs no repair.
func normalizePendingReminderScheduleTimes(db *gorm.DB) error {
	if db.Dialector.Name() != "sqlite" {
		return nil
	}
	var schedules []models.ContactReminderScheduled
	if err := db.Where("triggered_at IS NULL").Find(&schedules).Error; err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		for index := range schedules {
			scheduledAt := schedules[index].ScheduledAt
			_, offset := scheduledAt.Zone()
			if offset == 0 {
				continue
			}
			if err := tx.Model(&models.ContactReminderScheduled{}).
				Where("id = ?", schedules[index].ID).
				UpdateColumn("scheduled_at", scheduledAt.UTC()).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
