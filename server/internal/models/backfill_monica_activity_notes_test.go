package models

import (
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestBackfillMonicaActivityNotesGroupsParticipantsAndIsIdempotent(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent), DisableForeignKeyConstraintWhenMigrating: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TABLE life_event_participants (id integer primary key autoincrement, contact_id text not null, life_event_id integer not null, created_at datetime, updated_at datetime, UNIQUE(contact_id, life_event_id))`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&Note{}, &LifeEventCategory{}, &LifeEventType{}, &LifeEvent{}); err != nil {
		t.Fatal(err)
	}
	sourceType, sourceUUID := "monica_activity", "activity-1"
	happenedAt := time.Date(2024, 1, 2, 18, 0, 0, 0, time.UTC)
	notes := []Note{
		{VaultID: "vault-1", ContactID: "contact-a", Body: "[Activity: Ate together] Dinner\nA and B caught up", SourceType: &sourceType, SourceUUID: &sourceUUID, HappenedAt: &happenedAt},
		{VaultID: "vault-1", ContactID: "contact-b", Body: "[Activity: Ate together] Dinner\nA and B caught up", SourceType: &sourceType, SourceUUID: &sourceUUID, HappenedAt: &happenedAt},
	}
	if err := db.Create(&notes).Error; err != nil {
		t.Fatal(err)
	}
	if err := BackfillMonicaActivityNotes(db); err != nil {
		t.Fatal(err)
	}
	if err := BackfillMonicaActivityNotes(db); err != nil {
		t.Fatal(err)
	}
	var events []LifeEvent
	if err := db.Find(&events).Error; err != nil {
		t.Fatal(err)
	}
	var participantCount int64
	if len(events) == 1 {
		if err := db.Table("life_event_participants").Where("life_event_id = ?", events[0].ID).Count(&participantCount).Error; err != nil {
			t.Fatal(err)
		}
	}
	if len(events) != 1 || participantCount != 2 {
		t.Fatalf("events=%+v", events)
	}
	if events[0].Title != "Dinner" || events[0].Description == nil || *events[0].Description != "A and B caught up" {
		t.Fatalf("event=%+v", events[0])
	}
	var noteCount int64
	if err := db.Model(&Note{}).Count(&noteCount).Error; err != nil {
		t.Fatal(err)
	}
	if noteCount != 0 {
		t.Fatalf("legacy notes remaining=%d", noteCount)
	}
}
