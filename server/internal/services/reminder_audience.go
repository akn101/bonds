package services

import (
	"sort"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

func toReminderResponse(reminder *models.ContactReminder) dto.ReminderResponse {
	selectedUserIDs := reminderSelectedUserIDs(reminder)
	sort.Strings(selectedUserIDs)
	return dto.ReminderResponse{
		ID:                   reminder.ID,
		ContactID:            reminder.ContactID,
		Label:                reminder.Label,
		Day:                  reminder.Day,
		Month:                reminder.Month,
		Year:                 reminder.Year,
		CalendarType:         reminder.CalendarType,
		OriginalDay:          reminder.OriginalDay,
		OriginalMonth:        reminder.OriginalMonth,
		OriginalYear:         reminder.OriginalYear,
		Type:                 reminder.Type,
		FrequencyNumber:      reminder.FrequencyNumber,
		LastTriggeredAt:      reminder.LastTriggeredAt,
		NumberTimesTriggered: reminder.NumberTimesTriggered,
		Audience:             reminderAudienceOrDefault(reminder.Audience),
		SelectedUserIDs:      selectedUserIDs,
		CreatedAt:            reminder.CreatedAt,
		UpdatedAt:            reminder.UpdatedAt,
	}
}

func normalizeReminderAudience(audience string, selectedUserIDs []string) (string, []string, error) {
	if audience == "" {
		audience = models.ReminderAudienceAllVaultUsers
	}
	if audience != models.ReminderAudienceAllVaultUsers && audience != models.ReminderAudienceSelectedUsers {
		return "", nil, ErrReminderInvalidAudience
	}
	if audience == models.ReminderAudienceAllVaultUsers && len(selectedUserIDs) > 0 {
		return "", nil, ErrReminderInvalidAudience
	}
	uniqueUserIDs := make(map[string]struct{}, len(selectedUserIDs))
	for _, userID := range selectedUserIDs {
		if userID == "" {
			return "", nil, ErrReminderAudienceUserNotInVault
		}
		uniqueUserIDs[userID] = struct{}{}
	}
	result := make([]string, 0, len(uniqueUserIDs))
	for userID := range uniqueUserIDs {
		result = append(result, userID)
	}
	sort.Strings(result)
	return audience, result, nil
}

func reminderAudienceForUpdate(req dto.UpdateReminderRequest, reminder *models.ContactReminder) (string, []string, error) {
	if req.Audience == nil && req.SelectedUserIDs == nil {
		return reminderAudienceOrDefault(reminder.Audience), reminderSelectedUserIDs(reminder), nil
	}
	audience := reminderAudienceOrDefault(reminder.Audience)
	selectedUserIDs := reminderSelectedUserIDs(reminder)
	if req.Audience != nil {
		audience = *req.Audience
	}
	if req.SelectedUserIDs != nil {
		selectedUserIDs = *req.SelectedUserIDs
	} else if audience == models.ReminderAudienceAllVaultUsers {
		selectedUserIDs = nil
	}
	return normalizeReminderAudience(audience, selectedUserIDs)
}

func reminderSelectedUserIDs(reminder *models.ContactReminder) []string {
	selectedUserIDs := make([]string, len(reminder.SelectedUsers))
	for index := range reminder.SelectedUsers {
		selectedUserIDs[index] = reminder.SelectedUsers[index].UserID
	}
	return selectedUserIDs
}

func validateReminderAudienceUsers(db *gorm.DB, vaultID, audience string, selectedUserIDs []string) error {
	if audience != models.ReminderAudienceSelectedUsers || len(selectedUserIDs) == 0 {
		return nil
	}
	var count int64
	if err := db.Model(&models.UserVault{}).Where("vault_id = ? AND user_id IN ?", vaultID, selectedUserIDs).Count(&count).Error; err != nil {
		return err
	}
	if count != int64(len(selectedUserIDs)) {
		return ErrReminderAudienceUserNotInVault
	}
	return nil
}

func replaceReminderSelectedUsers(db *gorm.DB, reminderID uint, selectedUserIDs []string) error {
	if err := db.Where("contact_reminder_id = ?", reminderID).Delete(&models.ContactReminderSelectedUser{}).Error; err != nil {
		return err
	}
	if len(selectedUserIDs) == 0 {
		return nil
	}
	recipients := make([]models.ContactReminderSelectedUser, len(selectedUserIDs))
	for index := range selectedUserIDs {
		recipients[index] = models.ContactReminderSelectedUser{ContactReminderID: reminderID, UserID: selectedUserIDs[index]}
	}
	return db.Create(&recipients).Error
}

func reminderAudienceUserIDs(db *gorm.DB, reminder *models.ContactReminder, vaultID string) ([]string, error) {
	if reminderAudienceOrDefault(reminder.Audience) == models.ReminderAudienceAllVaultUsers {
		var userVaults []models.UserVault
		if err := db.Where("vault_id = ?", vaultID).Find(&userVaults).Error; err != nil {
			return nil, err
		}
		userIDs := make([]string, len(userVaults))
		for index := range userVaults {
			userIDs[index] = userVaults[index].UserID
		}
		return userIDs, nil
	}
	var recipients []models.ContactReminderSelectedUser
	if err := db.Where("contact_reminder_id = ?", reminder.ID).Order("user_id ASC").Find(&recipients).Error; err != nil {
		return nil, err
	}
	userIDs := make([]string, len(recipients))
	for index := range recipients {
		userIDs[index] = recipients[index].UserID
	}
	return userIDs, nil
}

func reminderAudienceOrDefault(audience string) string {
	if audience == "" {
		return models.ReminderAudienceAllVaultUsers
	}
	return audience
}
