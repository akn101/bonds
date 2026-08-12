package services

import (
	"testing"
	"time"

	"github.com/naiba/bonds/internal/models"
)

func TestMonicaImportIssue213_PreservesMetadata(t *testing.T) {
	svc, vaultID, userID, _ := setupMonicaImportTest(t)

	// Given a Monica 4.1.2 export that contains distinct legacy activity types,
	// a reminder description, duplicate arbitrary emotion input, and source timestamps.
	// When importing the export.
	resp, err := svc.Import(vaultID, userID, monicaIssue213MetadataFixture())
	if err != nil {
		t.Fatalf("import Monica 4.1.2 metadata fixture: %v", err)
	}
	if resp.ImportedActivities != 2 {
		t.Fatalf("imported activities: want 2, got %d", resp.ImportedActivities)
	}
	if resp.ImportedNotes != 1 {
		t.Fatalf("imported fallback notes: want 1, got %d", resp.ImportedNotes)
	}

	var contact models.Contact
	if err := svc.DB.Where("vault_id = ? AND first_name = ?", vaultID, "Issue 213 Contact").First(&contact).Error; err != nil {
		t.Fatalf("load imported contact: %v", err)
	}

	// Then activities retain their source type and timestamps.
	t.Run("activity types and timestamps", func(t *testing.T) {
		var marriage models.Activity
		if err := svc.DB.
			Joins("JOIN activity_participants ON activity_participants.activity_id = activities.id").
			Where("activity_participants.contact_id = ? AND activities.title = ?", contact.ID, "Marriage celebration").
			Preload("ActivityType").
			First(&marriage).Error; err != nil {
			t.Fatalf("load imported marriage activity: %v", err)
		}
		marriageGotLabel := ""
		if marriage.ActivityType.Label != nil {
			marriageGotLabel = *marriage.ActivityType.Label
		}
		if marriageGotLabel != "Marriage" {
			t.Errorf("marriage activity type label: want %q, got %q", "Marriage", marriageGotLabel)
		}
		if !marriage.ActivityType.CanBeDeleted {
			t.Error("custom marriage activity type must be deletable")
		}
		wantMarriageCreatedAt := time.Date(2016, time.April, 5, 8, 30, 0, 0, time.UTC)
		wantMarriageUpdatedAt := time.Date(2017, time.May, 6, 9, 45, 0, 0, time.UTC)
		if !marriage.CreatedAt.Equal(wantMarriageCreatedAt) {
			t.Errorf("marriage activity created_at: want %v, got %v", wantMarriageCreatedAt, marriage.CreatedAt)
		}
		if !marriage.UpdatedAt.Equal(wantMarriageUpdatedAt) {
			t.Errorf("marriage activity updated_at: want %v, got %v", wantMarriageUpdatedAt, marriage.UpdatedAt)
		}

		var moved models.Activity
		if err := svc.DB.
			Joins("JOIN activity_participants ON activity_participants.activity_id = activities.id").
			Where("activity_participants.contact_id = ? AND activities.title = ?", contact.ID, "Moved to Lisbon").
			Preload("ActivityType").
			First(&moved).Error; err != nil {
			t.Fatalf("load imported moved activity: %v", err)
		}
		movedGotLabel := ""
		if moved.ActivityType.Label != nil {
			movedGotLabel = *moved.ActivityType.Label
		}
		if movedGotLabel != "Moved" {
			t.Errorf("moved activity type label: want %q, got %q", "Moved", movedGotLabel)
		}
		if !moved.ActivityType.CanBeDeleted {
			t.Error("custom moved activity type must be deletable")
		}
		if marriage.ActivityTypeID == nil || moved.ActivityTypeID == nil || *marriage.ActivityTypeID == *moved.ActivityTypeID {
			t.Errorf("distinct source types must map to distinct types, got IDs %v and %v", marriage.ActivityTypeID, moved.ActivityTypeID)
		}
		wantMovedCreatedAt := time.Date(2015, time.February, 3, 7, 20, 0, 0, time.UTC)
		wantMovedUpdatedAt := time.Date(2015, time.March, 4, 8, 25, 0, 0, time.UTC)
		if !moved.CreatedAt.Equal(wantMovedCreatedAt) {
			t.Errorf("moved activity created_at: want %v, got %v", wantMovedCreatedAt, moved.CreatedAt)
		}
		if !moved.UpdatedAt.Equal(wantMovedUpdatedAt) {
			t.Errorf("moved activity updated_at: want %v, got %v", wantMovedUpdatedAt, moved.UpdatedAt)
		}
	})

	// Then the reminder description survives in a source-linked note without changing the reminder title.
	t.Run("reminder description and timestamps", func(t *testing.T) {
		const reminderDescription = "Bring the card selected for the anniversary"
		var reminder models.ContactReminder
		if err := svc.DB.Where("contact_id = ? AND label = ?", contact.ID, "Anniversary reminder").First(&reminder).Error; err != nil {
			t.Fatalf("load imported reminder: %v", err)
		}
		if reminder.Label != "Anniversary reminder" {
			t.Errorf("reminder title must remain unchanged, got %q", reminder.Label)
		}
		var reminderNote models.Note
		if err := svc.DB.Where("contact_id = ? AND source_type = ? AND source_uuid = ?", contact.ID, "monica_reminder_description", "issue-213-reminder").First(&reminderNote).Error; err != nil {
			t.Fatalf("load imported reminder description note: %v", err)
		}
		if reminderNote.Body != reminderDescription {
			t.Errorf("reminder description note: want %q, got %q", reminderDescription, reminderNote.Body)
		}
		if reminderNote.Title == nil || *reminderNote.Title != reminder.Label {
			t.Errorf("reminder description note title: want %q, got %v", reminder.Label, reminderNote.Title)
		}
		wantReminderCreatedAt := time.Date(2018, time.June, 7, 10, 15, 0, 0, time.UTC)
		wantReminderUpdatedAt := time.Date(2019, time.July, 8, 11, 20, 0, 0, time.UTC)
		if !reminder.CreatedAt.Equal(wantReminderCreatedAt) {
			t.Errorf("reminder created_at: want %v, got %v", wantReminderCreatedAt, reminder.CreatedAt)
		}
		if !reminder.UpdatedAt.Equal(wantReminderUpdatedAt) {
			t.Errorf("reminder updated_at: want %v, got %v", wantReminderUpdatedAt, reminder.UpdatedAt)
		}
		if !reminderNote.CreatedAt.Equal(wantReminderCreatedAt) {
			t.Errorf("reminder description note created_at: want %v, got %v", wantReminderCreatedAt, reminderNote.CreatedAt)
		}
		if !reminderNote.UpdatedAt.Equal(wantReminderUpdatedAt) {
			t.Errorf("reminder description note updated_at: want %v, got %v", wantReminderUpdatedAt, reminderNote.UpdatedAt)
		}
	})

	// Then arbitrary emotion labels are stably deduplicated in the call description and timestamps survive.
	t.Run("call emotion and timestamps", func(t *testing.T) {
		var call models.Call
		if err := svc.DB.Where("contact_id = ?", contact.ID).First(&call).Error; err != nil {
			t.Fatalf("load imported call: %v", err)
		}
		if call.Description == nil {
			t.Fatal("imported call should retain its Monica content and emotion labels")
		}
		wantDescription := "Checked in about the move\n\nMonica emotions: hope, joy"
		if *call.Description != wantDescription {
			t.Errorf("call description: want %q, got %q", wantDescription, *call.Description)
		}
		wantCallCreatedAt := time.Date(2020, time.August, 9, 12, 25, 0, 0, time.UTC)
		wantCallUpdatedAt := time.Date(2021, time.September, 10, 13, 35, 0, 0, time.UTC)
		if !call.CreatedAt.Equal(wantCallCreatedAt) {
			t.Errorf("call created_at: want %v, got %v", wantCallCreatedAt, call.CreatedAt)
		}
		if !call.UpdatedAt.Equal(wantCallUpdatedAt) {
			t.Errorf("call updated_at: want %v, got %v", wantCallUpdatedAt, call.UpdatedAt)
		}
	})
}

func monicaIssue213MetadataFixture() []byte {
	return []byte(`{
		"version": "1.0-preview.1",
		"app_version": "4.1.2",
		"account": {
			"uuid": "issue-213-account",
			"data": [
				{
					"count": 1,
					"type": "contact",
					"values": [
						{
							"uuid": "issue-213-contact",
							"properties": {"first_name": "Issue 213 Contact"},
							"data": [
								{
									"count": 1,
									"type": "call",
									"values": [{
										"uuid": "issue-213-call",
										"created_at": "2020-08-09T12:25:00Z",
										"updated_at": "2021-09-10T13:35:00Z",
										"properties": {
											"called_at": "2020-08-08T12:00:00Z",
											"content": "Checked in about the move",
											"contact_called": false,
											"emotions": ["hope", "joy", "hope"]
										}
									}]
								},
								{
									"count": 1,
									"type": "reminder",
									"values": [{
										"uuid": "issue-213-reminder",
										"created_at": "2018-06-07T10:15:00Z",
										"updated_at": "2019-07-08T11:20:00Z",
										"properties": {
											"initial_date": "2024-06-07",
											"title": "Anniversary reminder",
											"description": "Bring the card selected for the anniversary",
											"frequency_type": "year",
											"frequency_number": 1
										}
									}]
								},
								{
									"count": 2,
									"type": "life_event",
									"values": [
										{
											"uuid": "issue-213-marriage",
											"created_at": "2016-04-05T08:30:00Z",
											"updated_at": "2017-05-06T09:45:00Z",
											"properties": {
												"name": "Marriage celebration",
												"note": "A meaningful ceremony",
												"happened_at": "2016-04-04T00:00:00Z",
												"type": "issue-213-life-event-type-marriage"
											}
										},
										{
											"uuid": "issue-213-moved",
											"created_at": "2015-02-03T07:20:00Z",
											"updated_at": "2015-03-04T08:25:00Z",
											"properties": {
												"name": "Moved to Lisbon",
												"note": "Started a new chapter",
												"happened_at": "2015-02-02T00:00:00Z",
												"type": "issue-213-life-event-type-moved"
											}
										}
									]
								}
							]
						}
					]
				}
			],
			"instance": {
				"life_event_types": [
					{"uuid": "issue-213-life-event-type-marriage", "properties": {"translation_key": "marriage", "category": "issue-213-category"}},
					{"uuid": "issue-213-life-event-type-moved", "properties": {"translation_key": "moved", "category": "issue-213-category"}}
				],
				"life_event_categories": [
					{"uuid": "issue-213-category", "properties": {"translation_key": "personal"}}
				]
			}
		}
	}`)
}
