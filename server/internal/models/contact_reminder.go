package models

import "time"

const (
	ReminderAudienceAllVaultUsers = "all_vault_users"
	ReminderAudienceSelectedUsers = "selected_users"
)

type ContactReminder struct {
	ID                   uint       `json:"id" gorm:"primaryKey;autoIncrement"`
	ContactID            string     `json:"contact_id" gorm:"type:text;not null;index"`
	Label                string     `json:"label" gorm:"not null"`
	Day                  *int       `json:"day"`
	Month                *int       `json:"month"`
	Year                 *int       `json:"year"`
	CalendarType         string     `json:"calendar_type" gorm:"default:'gregorian'"`
	OriginalDay          *int       `json:"original_day"`
	OriginalMonth        *int       `json:"original_month"`
	OriginalYear         *int       `json:"original_year"`
	Type                 string     `json:"type" gorm:"not null"`
	FrequencyNumber      *int       `json:"frequency_number"`
	LastTriggeredAt      *time.Time `json:"last_triggered_at"`
	NumberTimesTriggered int        `json:"number_times_triggered" gorm:"default:0"`
	ImportantDateID      *uint      `json:"important_date_id" gorm:"index"`
	Audience             string     `json:"audience" gorm:"not null;default:'all_vault_users'"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`

	Contact       Contact                       `json:"contact,omitempty" gorm:"foreignKey:ContactID"`
	SelectedUsers []ContactReminderSelectedUser `json:"selected_users,omitempty" gorm:"foreignKey:ContactReminderID"`
}

type ContactReminderSelectedUser struct {
	ID                uint      `json:"id" gorm:"primaryKey;autoIncrement"`
	ContactReminderID uint      `json:"contact_reminder_id" gorm:"not null;index;uniqueIndex:idx_contact_reminder_selected_user_unique"`
	UserID            string    `json:"user_id" gorm:"type:text;not null;index;uniqueIndex:idx_contact_reminder_selected_user_unique"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

func (ContactReminderSelectedUser) TableName() string {
	return "contact_reminder_selected_users"
}

type ContactReminderScheduled struct {
	ID                        uint       `json:"id" gorm:"primaryKey;autoIncrement"`
	UserNotificationChannelID uint       `json:"user_notification_channel_id" gorm:"not null;index"`
	ContactReminderID         uint       `json:"contact_reminder_id" gorm:"not null;index"`
	ScheduledAt               time.Time  `json:"scheduled_at" gorm:"not null"`
	TriggeredAt               *time.Time `json:"triggered_at"`
	CreatedAt                 time.Time  `json:"created_at"`
	UpdatedAt                 time.Time  `json:"updated_at"`

	ContactReminder         ContactReminder         `json:"contact_reminder,omitempty" gorm:"foreignKey:ContactReminderID"`
	UserNotificationChannel UserNotificationChannel `json:"user_notification_channel,omitempty" gorm:"foreignKey:UserNotificationChannelID"`
}

func (ContactReminderScheduled) TableName() string {
	return "contact_reminder_scheduled"
}
