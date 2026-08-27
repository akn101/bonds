package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/i18n"
	"github.com/naiba/bonds/internal/models"
	userTimezone "github.com/naiba/bonds/internal/timezone"
	"gorm.io/gorm"
)

var (
	ErrInvalidNameOrder      = errors.New("name_order must contain at least one variable like %first_name%")
	ErrInvalidWeekStart      = errors.New("week_start must be sunday or monday")
	ErrInvalidViewPreference = errors.New("invalid view preference")
	ErrInvalidTimezone       = errors.New("timezone is not a valid IANA timezone")

	// ErrUnsupportedLocale is returned when a caller tries to persist a locale
	// code that the embedded i18n bundle does not load. Without this guard the
	// preference would silently be ignored at translation time (the UI falls
	// back to English), making the saved value look like a no-op to the user.
	ErrUnsupportedLocale = errors.New("locale is not supported")

	// validNameOrderVars lists all allowed template variables for name_order.
	validNameOrderVars = map[string]bool{
		"first_name":  true,
		"last_name":   true,
		"middle_name": true,
		"nickname":    true,
		"maiden_name": true,
	}
)

type PreferenceService struct {
	db *gorm.DB
}

func NewPreferenceService(db *gorm.DB) *PreferenceService {
	return &PreferenceService{db: db}
}

func (s *PreferenceService) Get(userID string) (*dto.PreferencesResponse, error) {
	var user models.User
	if err := s.db.First(&user, "id = ?", userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	tz := userTimezone.Default
	if user.Timezone != nil {
		if normalized, err := userTimezone.Normalize(*user.Timezone); err == nil {
			tz = normalized
		}
	}
	columns := defaultContactListColumns()
	if err := json.Unmarshal([]byte(user.ContactListColumns), &columns); err != nil || !validContactListColumns(columns) {
		columns = defaultContactListColumns()
	}
	return &dto.PreferencesResponse{
		NameOrder:                 user.NameOrder,
		DateFormat:                user.DateFormat,
		WeekStart:                 normalizedWeekStart(user.WeekStart),
		Timezone:                  tz,
		Locale:                    user.Locale,
		NumberFormat:              user.NumberFormat,
		DistanceFormat:            user.DistanceFormat,
		DefaultMapSite:            user.DefaultMapSite,
		HelpShown:                 user.HelpShown,
		EnableAlternativeCalendar: user.EnableAlternativeCalendar,
		ContactSortOrder:          normalizedChoice(user.ContactSortOrder, "name", "name", "first_met_at", "updated_at"),
		ContactListColumns:        columns,
		DashboardTab:              normalizedChoice(user.DashboardTab, "feed", "feed", "activities", "life_metrics"),
		TaskView:                  normalizedChoice(user.TaskView, "list", "list", "kanban"),
		TaskSort:                  normalizedChoice(user.TaskSort, "custom", "custom", "due_date"),
		Theme:                     normalizedChoice(user.Theme, "system", "light", "dark", "system"),
	}, nil
}

func (s *PreferenceService) UpdateNameOrder(userID string, req dto.UpdateNameOrderRequest) error {
	if err := ValidateNameOrder(req.NameOrder); err != nil {
		return err
	}
	return s.db.Model(&models.User{}).Where("id = ?", userID).Update("name_order", req.NameOrder).Error
}

func (s *PreferenceService) UpdateDateFormat(userID string, req dto.UpdateDateFormatRequest) error {
	return s.db.Model(&models.User{}).Where("id = ?", userID).Update("date_format", req.DateFormat).Error
}

func (s *PreferenceService) UpdateTimezone(userID string, req dto.UpdateTimezoneRequest) error {
	timezone, err := userTimezone.Normalize(req.Timezone)
	if err != nil {
		return ErrInvalidTimezone
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		timezoneChanged, err := userTimezonePreferenceChanged(tx, userID, timezone)
		if err != nil {
			return err
		}
		if err := tx.Model(&models.User{}).Where("id = ?", userID).Update("timezone", timezone).Error; err != nil {
			return err
		}
		if timezoneChanged {
			return rebuildPendingReminderSchedulesForUser(tx, userID)
		}
		return nil
	})
}

func (s *PreferenceService) UpdateLocale(userID string, req dto.UpdateLocaleRequest) error {
	if !i18n.IsSupported(req.Locale) {
		return ErrUnsupportedLocale
	}
	return s.db.Model(&models.User{}).Where("id = ?", userID).Update("locale", req.Locale).Error
}

func (s *PreferenceService) UpdateNumberFormat(userID string, req dto.UpdateNumberFormatRequest) error {
	return s.db.Model(&models.User{}).Where("id = ?", userID).Update("number_format", req.NumberFormat).Error
}

func (s *PreferenceService) UpdateDistanceFormat(userID string, req dto.UpdateDistanceFormatRequest) error {
	return s.db.Model(&models.User{}).Where("id = ?", userID).Update("distance_format", req.DistanceFormat).Error
}

func (s *PreferenceService) UpdateMapsPreference(userID string, req dto.UpdateMapsPreferenceRequest) error {
	return s.db.Model(&models.User{}).Where("id = ?", userID).Update("default_map_site", req.DefaultMapSite).Error
}

func (s *PreferenceService) UpdateHelpShown(userID string, req dto.UpdateHelpShownRequest) error {
	return s.db.Model(&models.User{}).Where("id = ?", userID).Update("help_shown", req.HelpShown).Error
}

func ValidateNameOrder(nameOrder string) error {
	foundVar, err := validateNameOrderSegment(nameOrder, false)
	if err != nil {
		return err
	}
	if !foundVar {
		return ErrInvalidNameOrder
	}
	return nil
}

func validateNameOrderSegment(segment string, inConditional bool) (bool, error) {
	foundVar := false
	for i := 0; i < len(segment); {
		switch segment[i] {
		case '%':
			end := strings.IndexByte(segment[i+1:], '%')
			if end < 0 {
				return false, fmt.Errorf("%w: unmatched %% in name_order", ErrInvalidNameOrder)
			}
			varName := segment[i+1 : i+1+end]
			if !validNameOrderVars[varName] {
				return false, fmt.Errorf("%w: unknown variable in name_order: %%%s%%", ErrInvalidNameOrder, varName)
			}
			foundVar = true
			i += end + 2
		case '{':
			if inConditional {
				return false, fmt.Errorf("%w: nested conditional blocks are not allowed", ErrInvalidNameOrder)
			}
			end := strings.IndexByte(segment[i+1:], '}')
			if end < 0 {
				return false, fmt.Errorf("%w: unclosed conditional block", ErrInvalidNameOrder)
			}
			block := segment[i+1 : i+1+end]
			blockFoundVar, err := validateNameOrderConditional(block)
			if err != nil {
				return false, err
			}
			foundVar = foundVar || blockFoundVar
			i += end + 2
		case '}':
			return false, fmt.Errorf("%w: unopened conditional block", ErrInvalidNameOrder)
		default:
			i++
		}
	}
	return foundVar, nil
}

func validateNameOrderConditional(block string) (bool, error) {
	conditionField, template, ok := strings.Cut(block, "?")
	if !ok || conditionField == "" || template == "" {
		return false, fmt.Errorf("%w: malformed conditional block", ErrInvalidNameOrder)
	}
	if strings.ContainsAny(conditionField, "{}% ") {
		return false, fmt.Errorf("%w: malformed conditional condition", ErrInvalidNameOrder)
	}
	if !validNameOrderVars[conditionField] {
		return false, fmt.Errorf("%w: unknown conditional field: %s", ErrInvalidNameOrder, conditionField)
	}
	return validateNameOrderSegment(template, true)
}

func (s *PreferenceService) UpdateAll(userID string, req dto.UpdatePreferencesRequest) (*dto.PreferencesResponse, error) {
	updates := map[string]interface{}{}
	if req.NameOrder != "" {
		if err := ValidateNameOrder(req.NameOrder); err != nil {
			return nil, err
		}
		updates["name_order"] = req.NameOrder
	}
	if req.DateFormat != "" {
		updates["date_format"] = req.DateFormat
	}
	if req.WeekStart != "" {
		if !isValidWeekStart(req.WeekStart) {
			return nil, ErrInvalidWeekStart
		}
		updates["week_start"] = req.WeekStart
	}
	if req.Timezone != "" {
		timezone, err := userTimezone.Normalize(req.Timezone)
		if err != nil {
			return nil, ErrInvalidTimezone
		}
		updates["timezone"] = timezone
	}
	if req.Locale != "" {
		if !i18n.IsSupported(req.Locale) {
			return nil, ErrUnsupportedLocale
		}
		updates["locale"] = req.Locale
	}
	if req.NumberFormat != "" {
		updates["number_format"] = req.NumberFormat
	}
	if req.DistanceFormat != "" {
		updates["distance_format"] = req.DistanceFormat
	}
	if req.DefaultMapSite != "" {
		updates["default_map_site"] = req.DefaultMapSite
	}
	if req.HelpShown != nil {
		updates["help_shown"] = *req.HelpShown
	}
	if req.EnableAlternativeCalendar != nil {
		updates["enable_alternative_calendar"] = *req.EnableAlternativeCalendar
	}
	if req.ContactSortOrder != "" {
		if !isChoice(req.ContactSortOrder, "name", "first_met_at", "updated_at") {
			return nil, ErrInvalidViewPreference
		}
		updates["contact_sort_order"] = req.ContactSortOrder
	}
	if req.ContactListColumns != nil {
		if !validContactListColumns(req.ContactListColumns) {
			return nil, ErrInvalidViewPreference
		}
		encoded, err := json.Marshal(req.ContactListColumns)
		if err != nil {
			return nil, err
		}
		updates["contact_list_columns"] = string(encoded)
	}
	if req.DashboardTab != "" {
		if !isChoice(req.DashboardTab, "feed", "activities", "life_metrics") {
			return nil, ErrInvalidViewPreference
		}
		updates["dashboard_tab"] = req.DashboardTab
	}
	if req.TaskView != "" {
		if !isChoice(req.TaskView, "list", "kanban") {
			return nil, ErrInvalidViewPreference
		}
		updates["task_view"] = req.TaskView
	}
	if req.TaskSort != "" {
		if !isChoice(req.TaskSort, "custom", "due_date") {
			return nil, ErrInvalidViewPreference
		}
		updates["task_sort"] = req.TaskSort
	}
	if req.Theme != "" {
		if !isChoice(req.Theme, "light", "dark", "system") {
			return nil, ErrInvalidViewPreference
		}
		updates["theme"] = req.Theme
	}
	if len(updates) == 0 {
		return s.Get(userID)
	}
	if err := s.db.Transaction(func(tx *gorm.DB) error {
		timezoneChanged := false
		if timezone, ok := updates["timezone"].(string); ok {
			changed, err := userTimezonePreferenceChanged(tx, userID, timezone)
			if err != nil {
				return err
			}
			timezoneChanged = changed
		}
		if err := tx.Model(&models.User{}).Where("id = ?", userID).Updates(updates).Error; err != nil {
			return err
		}
		if timezoneChanged {
			return rebuildPendingReminderSchedulesForUser(tx, userID)
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return s.Get(userID)
}

func userTimezonePreferenceChanged(db *gorm.DB, userID, timezone string) (bool, error) {
	var user models.User
	if err := db.Select("timezone").First(&user, "id = ?", userID).Error; err != nil {
		return false, err
	}
	if user.Timezone == nil {
		return true, nil
	}
	current, err := userTimezone.Normalize(*user.Timezone)
	if err != nil {
		return true, nil
	}
	return current != timezone, nil
}

func rebuildPendingReminderSchedulesForUser(db *gorm.DB, userID string) error {
	var channelIDs []uint
	if err := db.Model(&models.UserNotificationChannel{}).Where("user_id = ?", userID).Pluck("id", &channelIDs).Error; err != nil {
		return err
	}
	if len(channelIDs) == 0 {
		return nil
	}
	if err := db.Where("user_notification_channel_id IN ? AND triggered_at IS NULL", channelIDs).
		Delete(&models.ContactReminderScheduled{}).Error; err != nil {
		return err
	}
	var activeChannelIDs []uint
	if err := db.Model(&models.UserNotificationChannel{}).
		Where("id IN ? AND active = ?", channelIDs, true).
		Pluck("id", &activeChannelIDs).Error; err != nil {
		return err
	}
	for _, channelID := range activeChannelIDs {
		if err := scheduleAllContactReminders(db, channelID, userID); err != nil {
			return err
		}
	}
	return nil
}

func defaultContactListColumns() []string {
	return []string{"name", "nickname", "first_met_at", "status", "updated_at"}
}

func validContactListColumns(columns []string) bool {
	if len(columns) == 0 || len(columns) > 8 {
		return false
	}
	allowed := map[string]bool{
		"name": true, "nickname": true, "birthday": true, "age": true,
		"groups": true, "status": true, "first_met_at": true, "updated_at": true,
	}
	seen := make(map[string]bool, len(columns))
	for _, column := range columns {
		if !allowed[column] || seen[column] {
			return false
		}
		seen[column] = true
	}
	return seen["name"]
}

func isChoice(value string, choices ...string) bool {
	for _, choice := range choices {
		if value == choice {
			return true
		}
	}
	return false
}

func normalizedChoice(value, fallback string, choices ...string) string {
	if isChoice(value, choices...) {
		return value
	}
	return fallback
}

func isValidWeekStart(weekStart string) bool {
	return weekStart == "sunday" || weekStart == "monday"
}

func normalizedWeekStart(weekStart string) string {
	if isValidWeekStart(weekStart) {
		return weekStart
	}
	return "sunday"
}
