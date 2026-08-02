package services

import (
	"strings"
	"testing"

	"github.com/naiba/bonds/internal/models"
)

func TestMonicaImportIssue213_ResolvesLifeEventsFromSourceMetadata(t *testing.T) {
	svc, vaultID, userID, _ := setupMonicaImportTest(t)

	resp, err := svc.Import(vaultID, userID, monicaIssue213LifeEventResolutionFixture())
	if err != nil {
		t.Fatalf("import life-event resolution fixture: %v", err)
	}
	if resp.ImportedLifeEvents != 10 {
		t.Fatalf("imported life events: want 10, got %d (errors=%v)", resp.ImportedLifeEvents, resp.Errors)
	}

	var contact models.Contact
	if err := svc.DB.Where("vault_id = ? AND first_name = ?", vaultID, "Resolution Contact").First(&contact).Error; err != nil {
		t.Fatalf("load imported contact: %v", err)
	}

	var lifeEvents []models.LifeEvent
	if err := svc.DB.
		Joins("JOIN life_event_participants ON life_event_participants.life_event_id = life_events.id").
		Where("life_event_participants.contact_id = ?", contact.ID).
		Preload("LifeEventType.LifeEventCategory").
		Find(&lifeEvents).Error; err != nil {
		t.Fatalf("load imported life events: %v", err)
	}
	if len(lifeEvents) != 10 {
		t.Fatalf("stored life events: want 10, got %d", len(lifeEvents))
	}

	bySummary := make(map[string]models.LifeEvent, len(lifeEvents))
	for _, lifeEvent := range lifeEvents {
		if lifeEvent.Summary == nil {
			t.Fatal("imported life event has no summary")
		}
		bySummary[*lifeEvent.Summary] = lifeEvent
	}

	firstRelationship := bySummary["First relationship milestone"]
	secondRelationship := bySummary["Second relationship milestone"]
	if firstRelationship.LifeEventTypeID != secondRelationship.LifeEventTypeID {
		t.Errorf("events sharing type new_relationship must reuse one type: got %d and %d", firstRelationship.LifeEventTypeID, secondRelationship.LifeEventTypeID)
	}
	if firstRelationship.LifeEventType.LabelTranslationKey == nil || *firstRelationship.LifeEventType.LabelTranslationKey != "new_relationship" {
		t.Errorf("new relationship type translation key: want %q, got %v", "new_relationship", firstRelationship.LifeEventType.LabelTranslationKey)
	}
	if firstRelationship.LifeEventType.LifeEventCategory.LabelTranslationKey == nil || *firstRelationship.LifeEventType.LifeEventCategory.LabelTranslationKey != "personal_life" {
		t.Errorf("personal life category translation key: want %q, got %v", "personal_life", firstRelationship.LifeEventType.LifeEventCategory.LabelTranslationKey)
	}

	firstPromotion := bySummary["First promotion"]
	newRole := bySummary["New role"]
	if firstPromotion.LifeEventType.LifeEventCategoryID != newRole.LifeEventType.LifeEventCategoryID {
		t.Errorf("types sharing work_education must reuse one category: got %d and %d", firstPromotion.LifeEventType.LifeEventCategoryID, newRole.LifeEventType.LifeEventCategoryID)
	}
	if firstPromotion.LifeEventType.LifeEventCategory.LabelTranslationKey == nil || *firstPromotion.LifeEventType.LifeEventCategory.LabelTranslationKey != "work_education" {
		t.Errorf("work education category translation key: want %q, got %v", "work_education", firstPromotion.LifeEventType.LifeEventCategory.LabelTranslationKey)
	}

	personalChapter := bySummary["Personal chapter"]
	workChapter := bySummary["Work chapter"]
	if personalChapter.LifeEventType.LifeEventCategoryID == workChapter.LifeEventType.LifeEventCategoryID {
		t.Errorf("same source type label in different categories must not share a category: got %d", personalChapter.LifeEventType.LifeEventCategoryID)
	}
	if personalChapter.LifeEventType.LifeEventCategory.LabelTranslationKey == nil || *personalChapter.LifeEventType.LifeEventCategory.LabelTranslationKey != "personal_life" {
		t.Errorf("personal chapter category: want %q, got %v", "personal_life", personalChapter.LifeEventType.LifeEventCategory.LabelTranslationKey)
	}
	if workChapter.LifeEventType.LifeEventCategory.LabelTranslationKey == nil || *workChapter.LifeEventType.LifeEventCategory.LabelTranslationKey != "work_education" {
		t.Errorf("work chapter category: want %q, got %v", "work_education", workChapter.LifeEventType.LifeEventCategory.LabelTranslationKey)
	}

	missingType := bySummary["Missing type reference"]
	secondMissingType := bySummary["Second missing type reference"]
	if missingType.LifeEventTypeID != secondMissingType.LifeEventTypeID {
		t.Errorf("events sharing a missing source type reference must reuse one fallback type: got %d and %d", missingType.LifeEventTypeID, secondMissingType.LifeEventTypeID)
	}
	if missingType.LifeEventType.Label == nil || *missingType.LifeEventType.Label != "Monica import" {
		t.Errorf("fallback type label: want %q, got %v", "Monica import", missingType.LifeEventType.Label)
	}

	fallbackCategoryID := missingType.LifeEventType.LifeEventCategoryID
	for _, summary := range []string{"Missing category reference one", "Missing category reference two"} {
		if bySummary[summary].LifeEventType.LifeEventCategoryID != fallbackCategoryID {
			t.Errorf("%q must reuse fallback category %d, got %d", summary, fallbackCategoryID, bySummary[summary].LifeEventType.LifeEventCategoryID)
		}
	}
	if missingType.LifeEventType.LifeEventCategory.LabelTranslationKey == nil || *missingType.LifeEventType.LifeEventCategory.LabelTranslationKey != "monica_import" {
		t.Errorf("fallback category translation key: want %q, got %v", "monica_import", missingType.LifeEventType.LifeEventCategory.LabelTranslationKey)
	}

	foundMissingTypeError := false
	foundMissingCategoryError := false
	for _, importError := range resp.Errors {
		foundMissingTypeError = foundMissingTypeError || strings.Contains(importError, "missing type reference")
		foundMissingCategoryError = foundMissingCategoryError || strings.Contains(importError, "missing category reference")
	}
	if !foundMissingTypeError {
		t.Errorf("missing type metadata must be reported, got errors=%v", resp.Errors)
	}
	if !foundMissingCategoryError {
		t.Errorf("missing category metadata must be reported, got errors=%v", resp.Errors)
	}
}

func monicaIssue213LifeEventResolutionFixture() []byte {
	return []byte(`{
		"version": "1.0-preview.1",
		"account": {
			"uuid": "issue-213-resolution-account",
			"data": [{
				"count": 1,
				"type": "contact",
				"values": [{
					"uuid": "issue-213-resolution-contact",
					"properties": {"first_name": "Resolution Contact"},
					"data": [{
						"count": 10,
						"type": "life_event",
						"values": [
							{"uuid": "relationship-one", "properties": {"name": "First relationship milestone", "happened_at": "2020-01-01", "type": "new-relationship"}},
							{"uuid": "relationship-two", "properties": {"name": "Second relationship milestone", "happened_at": "2020-02-01", "type": "new-relationship"}},
							{"uuid": "promotion", "properties": {"name": "First promotion", "happened_at": "2020-03-01", "type": "first-promotion"}},
							{"uuid": "new-role", "properties": {"name": "New role", "happened_at": "2020-04-01", "type": "new-role"}},
							{"uuid": "personal-chapter", "properties": {"name": "Personal chapter", "happened_at": "2020-05-01", "type": "personal-chapter"}},
							{"uuid": "work-chapter", "properties": {"name": "Work chapter", "happened_at": "2020-06-01", "type": "work-chapter"}},
							{"uuid": "missing-type", "properties": {"name": "Missing type reference", "happened_at": "2020-07-01", "type": "missing-type-reference"}},
							{"uuid": "missing-type-two", "properties": {"name": "Second missing type reference", "happened_at": "2020-07-02", "type": "missing-type-reference"}},
							{"uuid": "missing-category-one", "properties": {"name": "Missing category reference one", "happened_at": "2020-08-01", "type": "missing-category-one"}},
							{"uuid": "missing-category-two", "properties": {"name": "Missing category reference two", "happened_at": "2020-09-01", "type": "missing-category-two"}}
						]
					}]
				}]
			}],
			"instance": {
				"life_event_types": [
					{"uuid": "new-relationship", "properties": {"translation_key": "new_relationship", "category": "personal-life"}},
					{"uuid": "first-promotion", "properties": {"translation_key": "first_promotion", "category": "work-education"}},
					{"uuid": "new-role", "properties": {"translation_key": "new_role", "category": "work-education"}},
					{"uuid": "personal-chapter", "properties": {"name": "New chapter", "category": "personal-life"}},
					{"uuid": "work-chapter", "properties": {"name": "New chapter", "category": "work-education"}},
					{"uuid": "missing-category-one", "properties": {"translation_key": "missing_category_one", "category": "missing-category-reference"}},
					{"uuid": "missing-category-two", "properties": {"translation_key": "missing_category_two", "category": "missing-category-reference"}}
				],
				"life_event_categories": [
					{"uuid": "personal-life", "properties": {"translation_key": "personal_life"}},
					{"uuid": "work-education", "properties": {"translation_key": "work_education"}}
				]
			}
		}
	}`)
}
