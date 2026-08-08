package database

import (
	"testing"

	"github.com/naiba/bonds/internal/models"
)

func TestMigrateLegacyTimelineLifeEventsPreservesAndFlattensData(t *testing.T) {
	db := openMigrationTestDB(t)
	statements := []string{
		`CREATE TABLE timeline_events (id integer PRIMARY KEY AUTOINCREMENT, vault_id text NOT NULL, started_at datetime NOT NULL, label text, collapsed numeric, created_at datetime, updated_at datetime)`,
		`CREATE TABLE life_events (id integer PRIMARY KEY AUTOINCREMENT, timeline_event_id integer NOT NULL, life_event_type_id integer NOT NULL, emotion_id integer, happened_at datetime NOT NULL, calendar_type text, original_day integer, original_month integer, original_year integer, collapsed numeric, summary text, description text, costs integer, currency_id integer, paid_by_contact_id text, duration_in_minutes integer, distance integer, distance_unit text, from_place text, to_place text, place text, created_at datetime, updated_at datetime)`,
		`CREATE TABLE timeline_event_participants (id integer PRIMARY KEY AUTOINCREMENT, contact_id text NOT NULL, timeline_event_id integer NOT NULL, created_at datetime, updated_at datetime)`,
		`CREATE TABLE life_event_participants (id integer PRIMARY KEY AUTOINCREMENT, contact_id text NOT NULL, life_event_id integer NOT NULL, created_at datetime, updated_at datetime)`,
		`INSERT INTO timeline_events (id, vault_id, started_at, label, created_at, updated_at) VALUES (1, 'v1', '2020-01-01', 'Career', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), (2, 'v1', '2021-01-01', 'Single', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), (3, 'v1', '2022-01-01', 'Empty but meaningful', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		`INSERT INTO life_events (id, timeline_event_id, life_event_type_id, happened_at, summary, description, calendar_type, created_at, updated_at) VALUES (10, 1, 5, '2020-01-02', 'Joined', 'With Alice', 'gregorian', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), (11, 1, 5, '2020-02-02', 'Promoted', '', 'gregorian', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), (12, 2, 5, '2021-01-02', 'Only child', '', 'lunar', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		`INSERT INTO timeline_event_participants (contact_id, timeline_event_id) VALUES ('owner', 1), ('single-owner', 2), ('empty-owner', 3)`,
		`INSERT INTO life_event_participants (contact_id, life_event_id) VALUES ('alice', 10)`,
	}
	for _, statement := range statements {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("prepare legacy schema: %v", err)
		}
	}
	if err := migrateLegacyTimelineLifeEvents(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if db.Migrator().HasTable("timeline_events") || db.Migrator().HasTable("timeline_event_participants") {
		t.Fatal("legacy timeline tables still exist")
	}
	for _, id := range []uint{10, 11, 12} {
		var count int64
		if err := db.Model(&models.LifeEvent{}).Where("id = ?", id).Count(&count).Error; err != nil || count != 1 {
			t.Fatalf("event %d not preserved", id)
		}
	}
	var grouped []models.LifeEvent
	if err := db.Where("parent_id IS NOT NULL").Find(&grouped).Error; err != nil || len(grouped) != 2 {
		t.Fatalf("grouped children = %d, err=%v", len(grouped), err)
	}
	var parents []models.LifeEvent
	if err := db.Where("life_event_type_id IS NULL").Order("title").Find(&parents).Error; err != nil {
		t.Fatal(err)
	}
	if len(parents) != 2 {
		t.Fatalf("parents = %d, want multi-event and empty parents", len(parents))
	}
	var participantCount int64
	if err := db.Model(&models.LifeEventParticipant{}).Where("life_event_id = ?", 10).Count(&participantCount).Error; err != nil || participantCount != 2 {
		t.Fatalf("event 10 participants = %d", participantCount)
	}
	var single models.LifeEvent
	if err := db.First(&single, 12).Error; err != nil {
		t.Fatal(err)
	}
	if single.ParentID != nil || single.CalendarType != "lunar" {
		t.Fatalf("single event migration = %+v", single)
	}
	if err := migrateLegacyTimelineLifeEvents(db); err != nil {
		t.Fatalf("idempotent rerun: %v", err)
	}
	created := models.LifeEvent{VaultID: "v1", Title: "After migration", StartPrecision: "day", EndStatus: "none"}
	if err := db.Create(&created).Error; err != nil {
		t.Fatalf("create after migration: %v", err)
	}
	if created.ID <= 12 {
		t.Fatalf("post-migration sequence did not advance: id=%d", created.ID)
	}
}
