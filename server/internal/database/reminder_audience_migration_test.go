package database

import (
	"testing"

	"github.com/naiba/bonds/internal/models"
)

func TestAutoMigrateBackfillsLegacyReminderAudiencesAndCreatesRecipientPivot(t *testing.T) {
	// Given
	db := openMigrationTestDB(t)
	if err := db.Migrator().CreateTable(&models.Account{}, &models.ContactReminder{}); err != nil {
		t.Fatalf("create legacy reminder dependencies: %v", err)
	}
	if err := db.Migrator().DropColumn(&models.ContactReminder{}, "audience"); err != nil {
		t.Fatalf("remove legacy audience column: %v", err)
	}
	for _, statement := range []string{
		`INSERT INTO contact_reminders (contact_id, label, type) VALUES ('contact-1', 'Null audience', 'one_time')`,
		`INSERT INTO contact_reminders (contact_id, label, type) VALUES ('contact-2', 'Empty audience', 'one_time')`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("prepare legacy reminder schema: %v", err)
		}
	}

	// When
	if err := AutoMigrate(db); err != nil {
		t.Fatalf("migrate legacy reminder schema: %v", err)
	}

	// Then
	var audiences []string
	if err := db.Table("contact_reminders").Order("id ASC").Pluck("audience", &audiences).Error; err != nil {
		t.Fatalf("load migrated audiences: %v", err)
	}
	if len(audiences) != 2 || audiences[0] != "all_vault_users" || audiences[1] != "all_vault_users" {
		t.Fatalf("audiences = %#v, want both all_vault_users", audiences)
	}
	if !db.Migrator().HasTable("contact_reminder_selected_users") {
		t.Fatal("selected recipient pivot table was not created")
	}
	if !columnIsPrimaryKey(t, db, "contact_reminder_selected_users", "id") {
		t.Fatal("selected recipient pivot requires an explicit ID primary key")
	}
	if err := db.Exec(`INSERT INTO contact_reminder_selected_users (contact_reminder_id, user_id) VALUES (?, ?)`, 1, "user-1").Error; err != nil {
		t.Fatalf("insert selected recipient: %v", err)
	}
	if err := db.Exec(`INSERT INTO contact_reminder_selected_users (contact_reminder_id, user_id) VALUES (?, ?)`, 1, "user-1").Error; err == nil {
		t.Fatal("duplicate reminder/user recipient pair was accepted")
	}
	if err := AutoMigrate(db); err != nil {
		t.Fatalf("repeat migration: %v", err)
	}
}
