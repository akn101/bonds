package services

import (
	"log"
	"time"

	calendarPkg "github.com/naiba/bonds/internal/calendar"
	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

func (s *ReminderService) reschedulePendingReminder(reminder *models.ContactReminder) {
	if err := reschedulePendingReminder(s.db, reminder); err != nil {
		log.Printf("[reminder] failed to reschedule reminder %d: %v", reminder.ID, err)
	}
}

// BackfillImportantDateReminderSchedules finds important-date reminders missing schedules.
func BackfillImportantDateReminderSchedules(db *gorm.DB) {
	var reminders []models.ContactReminder
	err := db.Where("important_date_id IS NOT NULL").Where("NOT EXISTS (?)", db.Model(&models.ContactReminderScheduled{}).Select("1").Where("contact_reminder_scheduled.contact_reminder_id = contact_reminders.id")).Find(&reminders).Error
	if err != nil {
		log.Printf("[reminder-backfill] query failed: %v", err)
		return
	}
	if len(reminders) == 0 {
		return
	}
	log.Printf("[reminder-backfill] scheduling %d important-date reminders missing schedules", len(reminders))
	for index := range reminders {
		if err := scheduleReminderForVaultUsers(db, &reminders[index]); err != nil {
			log.Printf("[reminder-backfill] schedule reminder %d: %v", reminders[index].ID, err)
		}
	}
}

func reschedulePendingReminder(db *gorm.DB, reminder *models.ContactReminder) error {
	if err := db.Where("contact_reminder_id = ? AND triggered_at IS NULL", reminder.ID).Delete(&models.ContactReminderScheduled{}).Error; err != nil {
		return err
	}
	return scheduleReminderForVaultUsers(db, reminder)
}

func scheduleReminderForVaultUsers(db *gorm.DB, reminder *models.ContactReminder) error {
	var contact models.Contact
	if err := db.First(&contact, "id = ?", reminder.ContactID).Error; err != nil {
		return err
	}
	userIDs, err := reminderAudienceUserIDs(db, reminder, contact.VaultID)
	if err != nil {
		return err
	}
	if len(userIDs) == 0 {
		return nil
	}
	var channels []models.UserNotificationChannel
	if err := db.Preload("User").Where("user_id IN ? AND active = ?", userIDs, true).Find(&channels).Error; err != nil {
		return err
	}
	for index := range channels {
		channel := &channels[index]
		scheduledAt := calcInitialSchedule(reminder, channel.PreferredTime, userLocation(channel.User)).UTC()
		if err := db.Create(&models.ContactReminderScheduled{UserNotificationChannelID: channel.ID, ContactReminderID: reminder.ID, ScheduledAt: scheduledAt}).Error; err != nil {
			return err
		}
	}
	return nil
}

func calcInitialSchedule(reminder *models.ContactReminder, preferredTime *string, location *time.Location) time.Time {
	now := time.Now().In(location)
	hour, minute := parsePreferredNotificationTime(preferredTime)
	calendarType := calendarPkg.CalendarType(reminder.CalendarType)
	if calendarType != "" && calendarType != calendarPkg.Gregorian && reminder.OriginalMonth != nil && reminder.OriginalDay != nil {
		converter, ok := calendarPkg.Get(calendarType)
		if ok {
			originalDate := calendarPkg.DateInfo{}
			reminderOriginalDateForScheduling(&originalDate, *reminder.OriginalMonth, *reminder.OriginalDay, reminder.OriginalYear)
			if reminder.OriginalYear == nil {
				if converted, err := converter.FromGregorian(calendarPkg.GregorianDate{Day: now.Day(), Month: int(now.Month()), Year: now.Year()}); err == nil {
					originalDate.Year = converted.Year
				}
			}
			if gregorianDate, err := converter.NextOccurrence(originalDate, now.AddDate(0, 0, -1)); err == nil {
				return time.Date(gregorianDate.Year, time.Month(gregorianDate.Month), gregorianDate.Day, hour, minute, 0, 0, location)
			}
		}
	}
	year, month, day := now.Year(), time.January, 1
	recurring := reminder.Type != "one_time"
	if reminder.Year != nil && !recurring {
		year = *reminder.Year
	}
	if reminder.Month != nil {
		month = time.Month(*reminder.Month)
	}
	if reminder.Day != nil {
		day = *reminder.Day
	}
	scheduled := time.Date(year, month, day, hour, minute, 0, 0, location)
	if (recurring || reminder.Year == nil) && scheduled.Before(now) {
		scheduled = scheduled.AddDate(1, 0, 0)
	}
	return scheduled
}
