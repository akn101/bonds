package services

import (
	"fmt"

	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/utils"
	"gorm.io/gorm"
)

// Feed action constants
const (
	ActionContactCreated    = "contact_created"
	ActionContactUpdated    = "contact_updated"
	ActionContactDeleted    = "contact_deleted"
	ActionNoteCreated       = "note_created"
	ActionNoteUpdated       = "note_updated"
	ActionNoteDeleted       = "note_deleted"
	ActionReminderCreated   = "reminder_created"
	ActionCallLogged        = "call_logged"
	ActionTaskCreated       = "task_created"
	ActionTaskCompleted     = "task_completed"
	ActionAddressAdded      = "address_added"
	ActionLifeEventCreated  = "life_event_created"
	ActionFileUploaded      = "file_uploaded"
	ActionLoanCreated       = "loan_created"
	ActionRelationshipAdded = "relationship_added"
)

type FeedRecorder struct {
	db *gorm.DB
}

func NewFeedRecorder(db *gorm.DB) *FeedRecorder {
	return &FeedRecorder{db: db}
}

// Record creates a ContactFeedItem. feedableID/feedableType are optional (for polymorphic reference).
func (r *FeedRecorder) Record(contactID, authorID, action string, description string, feedableID *uint, feedableType *string) error {
	if err := validateFeedActionSource(action, feedableID, feedableType); err != nil {
		return err
	}
	var contact models.Contact
	if err := r.db.Unscoped().Preload("Vault").First(&contact, "id = ?", contactID).Error; err != nil {
		return fmt.Errorf("load feed contact %s: %w", contactID, err)
	}
	item := models.ContactFeedItem{
		VaultID:             contact.VaultID,
		ContactID:           contactID,
		ContactNameSnapshot: utils.FormatContactNameSnapshot(contact.Vault.NameOrder, &contact),
		Action:              action,
		FeedableID:          feedableID,
		FeedableType:        feedableType,
	}
	if authorID != "" {
		item.AuthorID = &authorID
	}
	if description != "" {
		item.Description = &description
	}
	if err := r.db.Create(&item).Error; err != nil {
		return fmt.Errorf("create feed item for contact %s: %w", contactID, err)
	}
	return nil
}

func validateFeedActionSource(action string, feedableID *uint, feedableType *string) error {
	if action == ActionContactCreated || action == ActionContactUpdated || action == ActionContactDeleted {
		if feedableID != nil || feedableType != nil {
			return fmt.Errorf("contact action %s must not include a source", action)
		}
		return nil
	}
	if feedableID == nil || feedableType == nil {
		return fmt.Errorf("action %s requires a source", action)
	}
	expectedKinds := map[string]string{
		ActionNoteCreated:       "Note",
		ActionNoteUpdated:       "Note",
		ActionNoteDeleted:       "Note",
		ActionReminderCreated:   "ContactReminder",
		ActionCallLogged:        "Call",
		ActionTaskCreated:       "ContactTask",
		ActionTaskCompleted:     "ContactTask",
		ActionAddressAdded:      "Address",
		ActionLifeEventCreated:  "TimelineEvent",
		ActionFileUploaded:      "File",
		ActionLoanCreated:       "Loan",
		ActionRelationshipAdded: "Relationship",
	}
	expectedKind, ok := expectedKinds[action]
	if !ok {
		return fmt.Errorf("unsupported feed action %q", action)
	}
	if *feedableType != expectedKind {
		return fmt.Errorf("action %s requires source kind %s", action, expectedKind)
	}
	return nil
}
