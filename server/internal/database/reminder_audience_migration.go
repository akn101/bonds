package database

import (
	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

func backfillContactReminderAudience(db *gorm.DB) error {
	if !db.Migrator().HasTable(&models.ContactReminder{}) || !hasColumn(db, "contact_reminders", "audience") {
		return nil
	}
	return db.Model(&models.ContactReminder{}).
		Where("audience IS NULL OR audience = ?", "").
		Update("audience", models.ReminderAudienceAllVaultUsers).Error
}
