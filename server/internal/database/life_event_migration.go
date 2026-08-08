package database

import (
	"fmt"
	"strings"
	"time"

	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

type legacyTimelineRow struct {
	ID        uint
	VaultID   string
	StartedAt time.Time
	Label     *string
	CreatedAt time.Time
	UpdatedAt time.Time
}

type legacyLifeEventRow struct {
	ID                uint
	TimelineEventID   uint
	LifeEventTypeID   uint
	EmotionID         *uint
	HappenedAt        time.Time
	CalendarType      string
	OriginalDay       *int
	OriginalMonth     *int
	OriginalYear      *int
	Summary           *string
	Description       *string
	Costs             *int
	CurrencyID        *uint
	PaidByContactID   *string
	DurationInMinutes *int
	Distance          *int
	DistanceUnit      *string
	FromPlace         *string
	ToPlace           *string
	Place             *string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type legacyParticipantRow struct {
	ContactID string
	EntityID  uint
}

// migrateLegacyTimelineLifeEvents performs the intentionally one-way schema
// replacement from the old TimelineEvent container model to standalone life
// records. The whole operation is transactional: old tables are only dropped
// after every record and association has been copied.
func migrateLegacyTimelineLifeEvents(db *gorm.DB) error {
	if !db.Migrator().HasTable("life_events") || !hasColumn(db, "life_events", "timeline_event_id") {
		return nil
	}
	return db.Transaction(func(tx *gorm.DB) error {
		const oldEvents = "legacy_life_events_v1"
		const oldParticipants = "legacy_life_event_participants_v1"
		if tx.Migrator().HasTable(oldEvents) || tx.Migrator().HasTable(oldParticipants) {
			return fmt.Errorf("migrate legacy life events: stale migration tables exist")
		}
		var timelines []legacyTimelineRow
		if err := tx.Table("timeline_events").Find(&timelines).Error; err != nil {
			return fmt.Errorf("read timelines: %w", err)
		}
		var oldRows []legacyLifeEventRow
		if err := tx.Table("life_events").Find(&oldRows).Error; err != nil {
			return fmt.Errorf("read life events: %w", err)
		}
		var oldLifeParticipants []legacyParticipantRow
		if tx.Migrator().HasTable("life_event_participants") {
			if err := tx.Table("life_event_participants").Select("contact_id, life_event_id AS entity_id").Scan(&oldLifeParticipants).Error; err != nil {
				return err
			}
		}
		var oldTimelineParticipants []legacyParticipantRow
		if tx.Migrator().HasTable("timeline_event_participants") {
			if err := tx.Table("timeline_event_participants").Select("contact_id, timeline_event_id AS entity_id").Scan(&oldTimelineParticipants).Error; err != nil {
				return err
			}
		}

		if err := tx.Migrator().RenameTable("life_events", oldEvents); err != nil {
			return fmt.Errorf("rename life events: %w", err)
		}
		if indexes, err := tx.Migrator().GetIndexes(oldEvents); err == nil {
			for _, index := range indexes {
				_ = tx.Migrator().DropIndex(oldEvents, index.Name())
			}
		}
		if tx.Migrator().HasTable("life_event_participants") {
			if err := tx.Migrator().RenameTable("life_event_participants", oldParticipants); err != nil {
				return fmt.Errorf("rename participants: %w", err)
			}
			if indexes, err := tx.Migrator().GetIndexes(oldParticipants); err == nil {
				for _, index := range indexes {
					_ = tx.Migrator().DropIndex(oldParticipants, index.Name())
				}
			}
		}
		if err := tx.Migrator().CreateTable(&models.LifeEvent{}); err != nil {
			return fmt.Errorf("create life events: %w", err)
		}
		if err := tx.Migrator().CreateTable(&models.LifeEventParticipant{}); err != nil {
			return fmt.Errorf("create participants: %w", err)
		}

		timelineByID := make(map[uint]legacyTimelineRow, len(timelines))
		childrenByTimeline := make(map[uint][]uint)
		var nextEventID uint = 1
		for _, timeline := range timelines {
			timelineByID[timeline.ID] = timeline
		}
		for _, row := range oldRows {
			childrenByTimeline[row.TimelineEventID] = append(childrenByTimeline[row.TimelineEventID], row.ID)
			if row.ID >= nextEventID {
				nextEventID = row.ID + 1
			}
		}
		parentByTimeline := make(map[uint]uint)

		for _, row := range oldRows {
			timeline, ok := timelineByID[row.TimelineEventID]
			if !ok {
				return fmt.Errorf("life event %d references missing timeline %d", row.ID, row.TimelineEventID)
			}
			typeID := row.LifeEventTypeID
			title := strings.TrimSpace(stringValue(row.Summary))
			if title == "" {
				title = strings.TrimSpace(stringValue(timeline.Label))
			}
			if title == "" {
				title = "Life event"
			}
			calendarType := row.CalendarType
			if calendarType == "" {
				calendarType = "gregorian"
			}
			start := row.HappenedAt
			event := models.LifeEvent{ID: row.ID, VaultID: timeline.VaultID, LifeEventTypeID: &typeID, EmotionID: row.EmotionID,
				StartDate: &start, StartPrecision: "day", EndStatus: "none", CalendarType: calendarType,
				OriginalDay: row.OriginalDay, OriginalMonth: row.OriginalMonth, OriginalYear: row.OriginalYear,
				Title: title, Description: row.Description, Costs: row.Costs, CurrencyID: row.CurrencyID,
				PaidByContactID: row.PaidByContactID, DurationInMinutes: row.DurationInMinutes, Distance: row.Distance,
				DistanceUnit: row.DistanceUnit, FromPlace: row.FromPlace, ToPlace: row.ToPlace, Place: row.Place,
				CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt}
			if err := tx.Create(&event).Error; err != nil {
				return fmt.Errorf("copy life event %d: %w", row.ID, err)
			}
		}

		for _, timeline := range timelines {
			children := childrenByTimeline[timeline.ID]
			if len(children) == 1 {
				continue
			}
			title := strings.TrimSpace(stringValue(timeline.Label))
			if title == "" {
				title = "Life events"
			}
			start := timeline.StartedAt
			parent := models.LifeEvent{ID: nextEventID, VaultID: timeline.VaultID, Title: title, StartDate: &start, StartPrecision: "day", EndStatus: "unknown", CalendarType: "gregorian", CreatedAt: timeline.CreatedAt, UpdatedAt: timeline.UpdatedAt}
			if err := tx.Create(&parent).Error; err != nil {
				return fmt.Errorf("create parent for timeline %d: %w", timeline.ID, err)
			}
			nextEventID++
			parentByTimeline[timeline.ID] = parent.ID
			if len(children) > 0 {
				if err := tx.Model(&models.LifeEvent{}).Where("id IN ?", children).Update("parent_id", parent.ID).Error; err != nil {
					return err
				}
			}
		}

		lifeContacts := make(map[uint][]string)
		for _, row := range oldLifeParticipants {
			lifeContacts[row.EntityID] = append(lifeContacts[row.EntityID], row.ContactID)
		}
		timelineContacts := make(map[uint][]string)
		for _, row := range oldTimelineParticipants {
			timelineContacts[row.EntityID] = append(timelineContacts[row.EntityID], row.ContactID)
		}
		for _, row := range oldRows {
			ids := uniqueStrings(append(lifeContacts[row.ID], timelineContacts[row.TimelineEventID]...))
			if err := createMigratedParticipants(tx, row.ID, ids); err != nil {
				return err
			}
		}
		for timelineID, parentID := range parentByTimeline {
			if err := createMigratedParticipants(tx, parentID, uniqueStrings(timelineContacts[timelineID])); err != nil {
				return err
			}
		}
		if tx.Dialector.Name() == "postgres" {
			if err := tx.Exec("SELECT setval(pg_get_serial_sequence('life_events', 'id'), COALESCE((SELECT MAX(id) FROM life_events), 1), true)").Error; err != nil {
				return fmt.Errorf("reset life event sequence: %w", err)
			}
		}

		for _, table := range []string{oldParticipants, oldEvents, "timeline_event_participants", "timeline_events"} {
			if tx.Migrator().HasTable(table) {
				if err := tx.Migrator().DropTable(table); err != nil {
					return fmt.Errorf("drop %s: %w", table, err)
				}
			}
		}
		return nil
	})
}

func createMigratedParticipants(tx *gorm.DB, eventID uint, ids []string) error {
	for _, id := range ids {
		if err := tx.Create(&models.LifeEventParticipant{LifeEventID: eventID, ContactID: id}).Error; err != nil {
			return fmt.Errorf("copy participant for event %d: %w", eventID, err)
		}
	}
	return nil
}
func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
