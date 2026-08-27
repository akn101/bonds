package database

import (
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestNormalizeRegionalPreferencesAndPendingReminderTimes(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open SQLite: %v", err)
	}
	for _, statement := range []string{
		`CREATE TABLE users (id text PRIMARY KEY, timezone text, locale text)`,
		`CREATE TABLE contact_reminder_scheduled (id integer PRIMARY KEY AUTOINCREMENT, scheduled_at datetime NOT NULL, triggered_at datetime)`,
		`INSERT INTO users (id, timezone, locale) VALUES ('canonical', 'Australia/Sydney', 'pt-br')`,
		`INSERT INTO users (id, timezone, locale) VALUES ('legacy', 'Mars/Olympus_Mons', 'ja')`,
		`INSERT INTO contact_reminder_scheduled (scheduled_at) VALUES ('2026-08-27 09:00:00+10:00')`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("prepare migration fixture: %v", err)
		}
	}
	dueAt := time.Date(2026, time.August, 26, 23, 0, 0, 0, time.UTC)
	var legacyDueCount int64
	if err := db.Table("contact_reminder_scheduled").Where("scheduled_at <= ?", dueAt).Count(&legacyDueCount).Error; err != nil {
		t.Fatalf("query legacy due schedule: %v", err)
	}
	if legacyDueCount != 0 {
		t.Fatalf("legacy SQLite comparison unexpectedly found %d due schedules; #256 reproduction requires 0", legacyDueCount)
	}

	if err := normalizeUserRegionalPreferences(db); err != nil {
		t.Fatalf("normalize preferences: %v", err)
	}
	if err := normalizePendingReminderScheduleTimes(db); err != nil {
		t.Fatalf("normalize reminder schedules: %v", err)
	}

	var preferences []userRegionalPreference
	if err := db.Table("users").Order("id").Find(&preferences).Error; err != nil {
		t.Fatalf("load normalized preferences: %v", err)
	}
	if len(preferences) != 2 {
		t.Fatalf("normalized users = %d, want 2", len(preferences))
	}
	if preferences[0].Timezone == nil || *preferences[0].Timezone != "Australia/Sydney" || preferences[0].Locale != "pt-BR" {
		t.Fatalf("canonical preferences = %+v", preferences[0])
	}
	if preferences[1].Timezone == nil || *preferences[1].Timezone != "UTC" || preferences[1].Locale != "en" {
		t.Fatalf("legacy preferences = %+v", preferences[1])
	}

	var dueCount int64
	if err := db.Table("contact_reminder_scheduled").Where("scheduled_at <= ?", dueAt).Count(&dueCount).Error; err != nil {
		t.Fatalf("query normalized due schedule: %v", err)
	}
	if dueCount != 1 {
		t.Fatalf("due schedules = %d, want 1 at the equivalent UTC instant", dueCount)
	}

	// Both repairs run at every startup and must remain idempotent.
	if err := normalizeUserRegionalPreferences(db); err != nil {
		t.Fatalf("normalize preferences twice: %v", err)
	}
	if err := normalizePendingReminderScheduleTimes(db); err != nil {
		t.Fatalf("normalize reminder schedules twice: %v", err)
	}
}
