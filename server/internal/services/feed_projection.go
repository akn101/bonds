package services

import (
	"errors"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

var feedSourceModules = map[string]string{
	"Note":            "notes",
	"ContactReminder": "reminders",
	"Call":            "calls",
	"ContactTask":     "tasks",
	"Address":         "addresses",
	"Activity":        "activities",
	"Loan":            "loans",
	"Relationship":    "relationships",
}

func (s *FeedService) sourceAvailable(item models.ContactFeedItem) (*dto.FeedSourceResponse, error) {
	if item.FeedableID == nil || item.FeedableType == nil {
		return nil, nil
	}
	source := &dto.FeedSourceResponse{Kind: *item.FeedableType, ID: *item.FeedableID}
	source.Module = feedSourceModules[source.Kind]
	var count int64
	query := s.db
	switch source.Kind {
	case "Note":
		query = query.Model(&models.Note{}).Where("id = ? AND contact_id = ? AND vault_id = ?", source.ID, item.ContactID, item.VaultID)
	case "ContactReminder":
		query = query.Model(&models.ContactReminder{}).Joins("JOIN contacts ON contacts.id = contact_reminders.contact_id").Where("contact_reminders.id = ? AND contact_reminders.contact_id = ? AND contacts.vault_id = ?", source.ID, item.ContactID, item.VaultID)
	case "Call":
		query = query.Model(&models.Call{}).Joins("JOIN contacts ON contacts.id = calls.contact_id").Where("calls.id = ? AND calls.contact_id = ? AND contacts.vault_id = ?", source.ID, item.ContactID, item.VaultID)
	case "ContactTask":
		query = query.Model(&models.ContactTask{}).Joins("JOIN task_contacts ON task_contacts.contact_task_id = contact_tasks.id").Where("contact_tasks.id = ? AND contact_tasks.vault_id = ? AND task_contacts.contact_id = ?", source.ID, item.VaultID, item.ContactID)
	case "Address":
		query = query.Model(&models.Address{}).Joins("JOIN contact_address ON contact_address.address_id = addresses.id").Where("addresses.id = ? AND addresses.vault_id = ? AND contact_address.contact_id = ?", source.ID, item.VaultID, item.ContactID)
	case "Activity":
		query = query.Model(&models.Activity{}).Where("activities.id = ? AND activities.vault_id = ? AND EXISTS (SELECT 1 FROM activity_participants WHERE activity_participants.activity_id = activities.id AND activity_participants.contact_id = ?)", source.ID, item.VaultID, item.ContactID)
	case "File":
		return s.fileSourceAvailable(item, source)
	case "Loan":
		query = query.Model(&models.Loan{}).Joins("JOIN contact_loan ON contact_loan.loan_id = loans.id").Where("loans.id = ? AND loans.vault_id = ? AND (contact_loan.loaner_id = ? OR contact_loan.loanee_id = ?)", source.ID, item.VaultID, item.ContactID, item.ContactID)
	case "Relationship":
		query = query.Model(&models.Relationship{}).Joins("JOIN contacts ON contacts.id = relationships.contact_id").Where("relationships.id = ? AND relationships.contact_id = ? AND contacts.vault_id = ?", source.ID, item.ContactID, item.VaultID)
	default:
		return source, nil
	}
	if err := query.Count(&count).Error; err != nil {
		return nil, err
	}
	source.Available = count > 0
	return source, nil
}

func (s *FeedService) fileSourceAvailable(item models.ContactFeedItem, source *dto.FeedSourceResponse) (*dto.FeedSourceResponse, error) {
	var contactCount int64
	if err := s.db.Model(&models.Contact{}).Where("id = ? AND vault_id = ?", item.ContactID, item.VaultID).Count(&contactCount).Error; err != nil {
		return nil, err
	}
	if contactCount == 0 {
		return source, nil
	}

	var file models.File
	if err := s.db.Where("id = ? AND vault_id = ?", source.ID, item.VaultID).First(&file).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return source, nil
		}
		return nil, err
	}
	if file.FileableType == nil {
		return source, nil
	}

	switch *file.FileableType {
	case "Contact":
		if file.UfileableID == nil || *file.UfileableID != item.ContactID {
			return source, nil
		}
		source.Module = feedFileModule(file.Type)
		source.Available = source.Module != ""
		return source, nil
	case "QuickFact":
		if file.FileableID == nil || !isQuickFactFileType(file.Type) {
			return source, nil
		}
		var count int64
		// Quick Fact uploads are re-parented after their File feed event is recorded.
		if err := s.db.Model(&models.QuickFact{}).
			Joins("JOIN vault_quick_facts_templates ON vault_quick_facts_templates.id = quick_facts.vault_quick_facts_template_id").
			Joins("JOIN contacts ON contacts.id = quick_facts.contact_id").
			Where("quick_facts.id = ? AND quick_facts.file_id = ? AND quick_facts.contact_id = ? AND vault_quick_facts_templates.vault_id = ? AND contacts.vault_id = ?", *file.FileableID, file.ID, item.ContactID, item.VaultID, item.VaultID).
			Count(&count).Error; err != nil {
			return nil, err
		}
		if count > 0 {
			source.Module = "quick_facts"
			source.Available = true
		}
		return source, nil
	default:
		return source, nil
	}
}

func feedFileModule(fileType string) string {
	switch fileType {
	case "photo", "avatar", "video":
		return "photos"
	case "document":
		return "documents"
	default:
		return ""
	}
}

func isQuickFactFileType(fileType string) bool {
	return fileType == "photo" || fileType == "document"
}

func (s *FeedService) projectFeedItem(item models.ContactFeedItem, formatter *contactNameFormatter) (dto.FeedItemResponse, error) {
	result := dto.FeedItemResponse{ID: item.ID, ContactName: item.ContactNameSnapshot, Action: item.Action, CreatedAt: item.CreatedAt}
	if item.AuthorID != nil {
		result.AuthorID = *item.AuthorID
	}
	if item.Description != nil {
		result.Description = *item.Description
	}
	var contact models.Contact
	contactQuery := s.db.Where("id = ?", item.ContactID)
	if item.VaultID != "" {
		contactQuery = contactQuery.Where("vault_id = ?", item.VaultID)
	}
	err := contactQuery.First(&contact).Error
	if err == nil {
		name, formatErr := formatter.format(&contact, item.ContactNameSnapshot)
		if formatErr != nil {
			return dto.FeedItemResponse{}, formatErr
		}
		result.ContactID = item.ContactID
		result.ContactName = name
		result.ContactLinkable = true
	} else if err != gorm.ErrRecordNotFound {
		return dto.FeedItemResponse{}, err
	}
	if item.VaultID == "" {
		item.VaultID = contact.VaultID
	}
	source, err := s.sourceAvailable(item)
	if err != nil {
		return dto.FeedItemResponse{}, err
	}
	result.Source = source
	return result, nil
}
