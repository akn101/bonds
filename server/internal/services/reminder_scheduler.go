package services

import (
	"log"
	"time"

	"github.com/naiba/bonds/internal/i18n"
	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

const maxChannelFails = 10

type ReminderSchedulerService struct {
	db     *gorm.DB
	mailer Mailer
	sender NotificationSender
}

func NewReminderSchedulerService(db *gorm.DB, mailer Mailer, sender NotificationSender) *ReminderSchedulerService {
	return &ReminderSchedulerService{db: db, mailer: mailer, sender: sender}
}

// ProcessDueReminders finds all scheduled reminders that are due and processes them.
func (s *ReminderSchedulerService) ProcessDueReminders() {
	now := time.Now().Truncate(time.Minute)

	var scheduled []models.ContactReminderScheduled
	err := s.db.
		Where("scheduled_at <= ? AND triggered_at IS NULL", now).
		Preload("ContactReminder.Contact").
		Preload("UserNotificationChannel.User").
		Find(&scheduled).Error
	if err != nil {
		log.Printf("[reminder-scheduler] Failed to query due reminders: %v", err)
		return
	}

	if len(scheduled) == 0 {
		return
	}

	log.Printf("[reminder-scheduler] Found %d due reminders", len(scheduled))

	for i := range scheduled {
		s.processOne(&scheduled[i])
	}
}

// userLocation returns the time.Location for the given user's saved
// timezone preference, falling back to UTC if the user is nil, has no
// timezone set, or the saved string fails to load. Callers should pass
// this to any date math that ends up persisted (scheduled fire times,
// reminder dates) so different users in the same vault don't all fire at
// the server's wall-clock 09:00.
func userLocation(user *models.User) *time.Location {
	if user == nil || user.Timezone == nil || *user.Timezone == "" {
		return time.UTC
	}
	loc, err := time.LoadLocation(*user.Timezone)
	if err != nil {
		return time.UTC
	}
	return loc
}

func buildContactName(contact *models.Contact, locale string) string {
	name := ""
	if contact.FirstName != nil {
		name = *contact.FirstName
	}
	if contact.LastName != nil {
		if name != "" {
			name += " "
		}
		name += *contact.LastName
	}
	if name == "" {
		name = i18n.T(locale, "reminder.unknown_contact")
	}
	return name
}
