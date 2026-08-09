package database

import (
	"testing"
	"time"

	"github.com/naiba/bonds/internal/models"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestAutoMigrateRemovesLegacyShadowContactsWithoutLosingUserHistory(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:shadow-contact-migration?mode=memory&cache=shared"), &gorm.Config{
		Logger:      logger.Default.LogMode(logger.Silent),
		PrepareStmt: false,
	})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(AllModels()...); err != nil {
		t.Fatalf("create current schema: %v", err)
	}
	if err := db.Exec("PRAGMA foreign_keys = ON").Error; err != nil {
		t.Fatalf("enable foreign keys: %v", err)
	}
	if err := db.Exec("ALTER TABLE user_vault ADD COLUMN contact_id text").Error; err != nil {
		t.Fatalf("add legacy user_vault.contact_id: %v", err)
	}
	if err := db.Migrator().DropTable(&models.MoodTrackingEvent{}); err != nil {
		t.Fatalf("drop current mood table: %v", err)
	}
	if err := db.Exec(`CREATE TABLE mood_tracking_events (
		id integer PRIMARY KEY AUTOINCREMENT,
		contact_id text NOT NULL,
		mood_tracking_parameter_id integer NOT NULL,
		rated_at datetime NOT NULL,
		note text,
		number_of_hours_slept integer,
		created_at datetime,
		updated_at datetime,
		CONSTRAINT fk_mood_tracking_parameters_mood_tracking_events
			FOREIGN KEY (mood_tracking_parameter_id) REFERENCES mood_tracking_parameters(id),
		CONSTRAINT fk_contacts_mood_tracking_events
			FOREIGN KEY (contact_id) REFERENCES contacts(id)
	)`).Error; err != nil {
		t.Fatalf("create legacy mood table: %v", err)
	}

	account := models.Account{}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("create account: %v", err)
	}
	firstName, lastName := "Alice", "Admin"
	user := models.User{AccountID: account.ID, FirstName: &firstName, LastName: &lastName, Email: "alice@example.com"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	vault := models.Vault{AccountID: account.ID, Name: "Legacy", Type: "personal"}
	if err := db.Create(&vault).Error; err != nil {
		t.Fatalf("create vault: %v", err)
	}
	shadowName, ordinaryName := "Alice", "Friend"
	shadow := models.Contact{VaultID: vault.ID, FirstName: &shadowName}
	ordinary := models.Contact{VaultID: vault.ID, FirstName: &ordinaryName}
	if err := db.Create(&shadow).Error; err != nil {
		t.Fatalf("create shadow contact: %v", err)
	}
	if err := db.Model(&shadow).Updates(map[string]interface{}{"listed": false, "can_be_deleted": false}).Error; err != nil {
		t.Fatalf("mark shadow contact: %v", err)
	}
	if err := db.Create(&ordinary).Error; err != nil {
		t.Fatalf("create ordinary contact: %v", err)
	}
	userVault := models.UserVault{VaultID: vault.ID, UserID: user.ID, Permission: models.PermissionManager}
	if err := db.Create(&userVault).Error; err != nil {
		t.Fatalf("create membership: %v", err)
	}
	if err := db.Exec("UPDATE user_vault SET contact_id = ? WHERE id = ?", shadow.ID, userVault.ID).Error; err != nil {
		t.Fatalf("link legacy shadow contact: %v", err)
	}

	category := models.LifeEventCategory{VaultID: vault.ID}
	if err := db.Create(&category).Error; err != nil {
		t.Fatalf("create category: %v", err)
	}
	eventType := models.LifeEventType{LifeEventCategoryID: category.ID}
	if err := db.Create(&eventType).Error; err != nil {
		t.Fatalf("create event type: %v", err)
	}
	event := models.LifeEvent{VaultID: vault.ID, LifeEventTypeID: &eventType.ID, Title: "Legacy event"}
	if err := db.Create(&event).Error; err != nil {
		t.Fatalf("create event: %v", err)
	}
	for _, participantID := range []string{shadow.ID, ordinary.ID} {
		if err := db.Create(&models.LifeEventParticipant{LifeEventID: event.ID, ContactID: participantID}).Error; err != nil {
			t.Fatalf("create event participant: %v", err)
		}
	}

	label := "Good"
	parameter := models.MoodTrackingParameter{VaultID: vault.ID, Label: &label, HexColor: "#00ff00"}
	if err := db.Create(&parameter).Error; err != nil {
		t.Fatalf("create mood parameter: %v", err)
	}
	ratedAt := time.Now().UTC().Truncate(time.Second)
	if err := db.Exec(`INSERT INTO mood_tracking_events
		(mood_tracking_parameter_id, rated_at, contact_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
		parameter.ID, ratedAt, shadow.ID, ratedAt, ratedAt,
		parameter.ID, ratedAt.Add(-time.Hour), ordinary.ID, ratedAt, ratedAt,
	).Error; err != nil {
		t.Fatalf("create legacy moods: %v", err)
	}

	reminder := models.ContactReminder{ContactID: shadow.ID, Label: "Legacy reminder", Type: "one_time"}
	if err := db.Create(&reminder).Error; err != nil {
		t.Fatalf("create legacy reminder: %v", err)
	}
	if err := db.Create(&models.ContactReminderSelectedUser{ContactReminderID: reminder.ID, UserID: user.ID}).Error; err != nil {
		t.Fatalf("create legacy reminder audience: %v", err)
	}
	channel := models.UserNotificationChannel{UserID: &user.ID, Type: "email", Content: user.Email}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatalf("create notification channel: %v", err)
	}
	if err := db.Create(&models.ContactReminderScheduled{
		UserNotificationChannelID: channel.ID,
		ContactReminderID:         reminder.ID,
		ScheduledAt:               ratedAt,
	}).Error; err != nil {
		t.Fatalf("create legacy reminder schedule: %v", err)
	}

	if err := AutoMigrate(db); err != nil {
		t.Fatalf("migrate legacy shadows: %v", err)
	}
	if hasColumn(db, "user_vault", "contact_id") || hasColumn(db, "mood_tracking_events", "contact_id") {
		t.Fatal("legacy contact_id columns still exist")
	}

	var migratedEvent models.LifeEvent
	if err := db.First(&migratedEvent, event.ID).Error; err != nil {
		t.Fatalf("reload event: %v", err)
	}
	if migratedEvent.SubjectUserID == nil || *migratedEvent.SubjectUserID != user.ID {
		t.Fatalf("event subject user = %v, want %s", migratedEvent.SubjectUserID, user.ID)
	}
	if migratedEvent.SubjectUserName == nil || *migratedEvent.SubjectUserName != "Alice Admin" {
		t.Fatalf("event subject name = %v, want Alice Admin", migratedEvent.SubjectUserName)
	}
	var participantIDs []string
	if err := db.Model(&models.LifeEventParticipant{}).Where("life_event_id = ?", event.ID).Pluck("contact_id", &participantIDs).Error; err != nil {
		t.Fatalf("load remaining participants: %v", err)
	}
	if len(participantIDs) != 1 || participantIDs[0] != ordinary.ID {
		t.Fatalf("remaining participants = %v, want ordinary contact", participantIDs)
	}

	var shadowCount, ordinaryCount int64
	db.Unscoped().Model(&models.Contact{}).Where("id = ?", shadow.ID).Count(&shadowCount)
	db.Model(&models.Contact{}).Where("id = ?", ordinary.ID).Count(&ordinaryCount)
	if shadowCount != 0 || ordinaryCount != 1 {
		t.Fatalf("contact counts shadow=%d ordinary=%d, want 0/1", shadowCount, ordinaryCount)
	}
	for table, where := range map[string]string{
		"contact_reminders":               "contact_id = ?",
		"contact_reminder_selected_users": "contact_reminder_id = ?",
		"contact_reminder_scheduled":      "contact_reminder_id = ?",
	} {
		value := interface{}(reminder.ID)
		if table == "contact_reminders" {
			value = shadow.ID
		}
		var count int64
		if err := db.Table(table).Where(where, value).Count(&count).Error; err != nil {
			t.Fatalf("count remaining %s rows: %v", table, err)
		}
		if count != 0 {
			t.Fatalf("remaining %s rows = %d, want 0", table, count)
		}
	}

	var moods []models.MoodTrackingEvent
	if err := db.Order("rated_at DESC").Find(&moods).Error; err != nil {
		t.Fatalf("load moods: %v", err)
	}
	if len(moods) != 2 {
		t.Fatalf("mood rows = %d, want 2", len(moods))
	}
	if moods[0].VaultID != vault.ID || moods[0].UserID == nil || *moods[0].UserID != user.ID {
		t.Fatalf("mapped user mood = %+v", moods[0])
	}
	if moods[1].VaultID != vault.ID || moods[1].UserID != nil {
		t.Fatalf("ordinary-contact mood should be anonymous vault history: %+v", moods[1])
	}

	if err := AutoMigrate(db); err != nil {
		t.Fatalf("repeat migration: %v", err)
	}
}
