package database

import (
	"testing"

	"github.com/naiba/bonds/internal/models"
)

func TestMigrateStandaloneLifeEventSchemaToActivities(t *testing.T) {
	db := openMigrationTestDB(t)
	statements := []string{
		`CREATE TABLE life_event_categories (id integer PRIMARY KEY AUTOINCREMENT, vault_id text NOT NULL, label text, label_translation_key text)`,
		`CREATE TABLE life_event_types (id integer PRIMARY KEY AUTOINCREMENT, life_event_category_id integer NOT NULL, label text, label_translation_key text)`,
		`CREATE TABLE life_events (id integer PRIMARY KEY AUTOINCREMENT, vault_id text NOT NULL, life_event_type_id integer, title text NOT NULL, start_precision text, end_status text, source_type text, source_uuid text, created_at datetime, updated_at datetime)`,
		`CREATE TABLE life_event_participants (id integer PRIMARY KEY AUTOINCREMENT, contact_id text NOT NULL, life_event_id integer NOT NULL, created_at datetime, updated_at datetime)`,
		`CREATE TABLE modules (id integer PRIMARY KEY AUTOINCREMENT, type text, name_translation_key text)`,
		`CREATE TABLE template_pages (id integer PRIMARY KEY AUTOINCREMENT, name_translation_key text)`,
		`CREATE TABLE contact_feed_items (id integer PRIMARY KEY AUTOINCREMENT, action text, feedable_type text, description text)`,
		`CREATE TABLE vaults (id text PRIMARY KEY, default_activity_tab text)`,
		`INSERT INTO life_event_categories (id, vault_id, label, label_translation_key) VALUES (1, 'v1', 'Social', 'seed.life_event_categories.social')`,
		`INSERT INTO life_event_types (id, life_event_category_id, label, label_translation_key) VALUES (2, 1, 'Ate', 'seed.life_event_types.ate')`,
		`INSERT INTO life_events (id, vault_id, life_event_type_id, title, start_precision, end_status, source_type, source_uuid, created_at, updated_at) VALUES (3, 'v1', 2, 'Dinner', 'day', 'none', 'monica_activity', 'source-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		`INSERT INTO life_event_participants (id, contact_id, life_event_id, created_at, updated_at) VALUES (4, 'contact-1', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		`INSERT INTO modules (id, type, name_translation_key) VALUES (5, 'life_events', 'seed.modules.life_events')`,
		`INSERT INTO template_pages (id, name_translation_key) VALUES (6, 'seed.template_pages.life_and_goals')`,
		`INSERT INTO contact_feed_items (id, action, feedable_type, description) VALUES (7, 'life_event_created', 'LifeEvent', 'Created a life event')`,
		`INSERT INTO vaults (id, default_activity_tab) VALUES ('v1', 'life_events'), ('v2', 'activity'), ('v3', 'notes'), ('v4', 'life_metrics')`,
	}
	for _, statement := range statements {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("prepare standalone schema: %v", err)
		}
	}

	if err := migrateActivitySchema(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := migrateActivitySchema(db); err != nil {
		t.Fatalf("idempotent rerun: %v", err)
	}
	for _, table := range []string{"activity_categories", "activity_types", "activities", "activity_participants"} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("new table %s missing", table)
		}
	}
	for _, table := range []string{"life_event_categories", "life_event_types", "life_events", "life_event_participants"} {
		if db.Migrator().HasTable(table) {
			t.Fatalf("legacy table %s still exists", table)
		}
	}
	var activity models.Activity
	if err := db.First(&activity, 3).Error; err != nil {
		t.Fatalf("load migrated activity: %v", err)
	}
	if activity.ActivityTypeID == nil || *activity.ActivityTypeID != 2 || activity.Title != "Dinner" {
		t.Fatalf("migrated activity = %+v", activity)
	}
	var participant models.ActivityParticipant
	if err := db.First(&participant, 4).Error; err != nil || participant.ActivityID != 3 {
		t.Fatalf("migrated participant = %+v, err=%v", participant, err)
	}

	assertMetadata := func(table, column, want string, id interface{}) {
		t.Helper()
		var got string
		if err := db.Table(table).Where("id = ?", id).Pluck(column, &got).Error; err != nil || got != want {
			t.Fatalf("%s.%s = %q, want %q, err=%v", table, column, got, want, err)
		}
	}
	assertMetadata("activity_categories", "label_translation_key", "seed.activity_categories.social", 1)
	assertMetadata("activity_types", "label_translation_key", "seed.activity_types.ate", 2)
	assertMetadata("modules", "type", "activities", 5)
	assertMetadata("modules", "name_translation_key", "seed.modules.activities", 5)
	assertMetadata("template_pages", "name_translation_key", "seed.template_pages.activities", 6)
	assertMetadata("contact_feed_items", "action", "activity_created", 7)
	assertMetadata("contact_feed_items", "feedable_type", "Activity", 7)
	assertMetadata("contact_feed_items", "description", "Created an activity", 7)
	assertMetadata("vaults", "default_dashboard_tab", "activities", "v1")
	assertMetadata("vaults", "default_dashboard_tab", "feed", "v2")
	assertMetadata("vaults", "default_dashboard_tab", "feed", "v3")
	assertMetadata("vaults", "default_dashboard_tab", "life_metrics", "v4")
}

func TestMigrateLegacyTimelineActivitiesPreservesAndFlattensData(t *testing.T) {
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
	if err := migrateActivitySchema(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if db.Migrator().HasTable("timeline_events") || db.Migrator().HasTable("timeline_event_participants") {
		t.Fatal("legacy timeline tables still exist")
	}
	for _, id := range []uint{10, 11, 12} {
		var count int64
		if err := db.Model(&models.Activity{}).Where("id = ?", id).Count(&count).Error; err != nil || count != 1 {
			t.Fatalf("event %d not preserved", id)
		}
	}
	var grouped []models.Activity
	if err := db.Where("parent_id IS NOT NULL").Find(&grouped).Error; err != nil || len(grouped) != 2 {
		t.Fatalf("grouped children = %d, err=%v", len(grouped), err)
	}
	var parents []models.Activity
	if err := db.Where("activity_type_id IS NULL").Order("title").Find(&parents).Error; err != nil {
		t.Fatal(err)
	}
	if len(parents) != 2 {
		t.Fatalf("parents = %d, want multi-event and empty parents", len(parents))
	}
	var participantCount int64
	if err := db.Model(&models.ActivityParticipant{}).Where("activity_id = ?", 10).Count(&participantCount).Error; err != nil || participantCount != 2 {
		t.Fatalf("event 10 participants = %d", participantCount)
	}
	var single models.Activity
	if err := db.First(&single, 12).Error; err != nil {
		t.Fatal(err)
	}
	if single.ParentID != nil || single.CalendarType != "lunar" {
		t.Fatalf("single event migration = %+v", single)
	}
	if err := migrateActivitySchema(db); err != nil {
		t.Fatalf("idempotent rerun: %v", err)
	}
	created := models.Activity{VaultID: "v1", Title: "After migration", StartPrecision: "day", EndStatus: "none"}
	if err := db.Create(&created).Error; err != nil {
		t.Fatalf("create after migration: %v", err)
	}
	if created.ID <= 12 {
		t.Fatalf("post-migration sequence did not advance: id=%d", created.ID)
	}
}
