package services

import (
	"errors"
	"testing"
	"time"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/testutil"
)

func setupPreferenceTest(t *testing.T) (*PreferenceService, string) {
	t.Helper()
	db := testutil.SetupTestDB(t)
	cfg := testutil.TestJWTConfig()
	authSvc := NewAuthService(db, cfg)

	resp, err := authSvc.Register(dto.RegisterRequest{
		FirstName: "Test",
		LastName:  "User",
		Email:     "preferences-test@example.com",
		Password:  "password123",
	}, "en")
	if err != nil {
		t.Fatalf("Register failed: %v", err)
	}

	return NewPreferenceService(db), resp.User.ID
}

func TestPreferenceGet(t *testing.T) {
	svc, userID := setupPreferenceTest(t)

	prefs, err := svc.Get(userID)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if prefs.Locale == "" {
		t.Error("Expected locale to be non-empty")
	}
	if prefs.DateFormat == "" {
		t.Error("Expected date_format to be non-empty")
	}
	if prefs.NameOrder == "" {
		t.Error("Expected name_order to be non-empty")
	}
	if prefs.WeekStart != "sunday" {
		t.Errorf("Expected week_start to default to sunday, got %q", prefs.WeekStart)
	}
	if prefs.Timezone != "UTC" {
		t.Errorf("Expected timezone to default to UTC, got %q", prefs.Timezone)
	}
}

func TestPreferenceRejectsInvalidTimezone(t *testing.T) {
	svc, userID := setupPreferenceTest(t)

	if err := svc.UpdateTimezone(userID, dto.UpdateTimezoneRequest{Timezone: "Mars/Olympus_Mons"}); !errors.Is(err, ErrInvalidTimezone) {
		t.Fatalf("UpdateTimezone invalid error = %v, want ErrInvalidTimezone", err)
	}
	if _, err := svc.UpdateAll(userID, dto.UpdatePreferencesRequest{Timezone: "Mars/Olympus_Mons"}); !errors.Is(err, ErrInvalidTimezone) {
		t.Fatalf("UpdateAll invalid timezone error = %v, want ErrInvalidTimezone", err)
	}
	prefs, err := svc.Get(userID)
	if err != nil {
		t.Fatalf("Get after rejected timezone: %v", err)
	}
	if prefs.Timezone != "UTC" {
		t.Fatalf("timezone changed after rejected update: %q", prefs.Timezone)
	}
}

func TestPreferenceTimezoneChangeRebuildsPendingReminderSchedules(t *testing.T) {
	notifications, userID, reminderID := setupNotificationReminderScenario(t, "timezone-reschedule@example.com")
	channel, err := notifications.Create(userID, dto.CreateNotificationChannelRequest{
		Type:          "shoutrrr",
		Content:       "ntfy://timezone-reschedule",
		PreferredTime: "09:00",
	})
	if err != nil {
		t.Fatalf("create notification channel: %v", err)
	}
	var original models.ContactReminderScheduled
	if err := notifications.db.Where("user_notification_channel_id = ? AND contact_reminder_id = ? AND triggered_at IS NULL", channel.ID, reminderID).
		First(&original).Error; err != nil {
		t.Fatalf("load original schedule: %v", err)
	}

	preferences := NewPreferenceService(notifications.db)
	if err := preferences.UpdateTimezone(userID, dto.UpdateTimezoneRequest{Timezone: "Australia/Sydney"}); err != nil {
		t.Fatalf("update timezone: %v", err)
	}

	var rebuilt models.ContactReminderScheduled
	if err := notifications.db.Where("user_notification_channel_id = ? AND contact_reminder_id = ? AND triggered_at IS NULL", channel.ID, reminderID).
		First(&rebuilt).Error; err != nil {
		t.Fatalf("load rebuilt schedule: %v", err)
	}
	if rebuilt.ID == original.ID {
		t.Fatal("timezone update kept the stale pending schedule")
	}
	sydney, err := time.LoadLocation("Australia/Sydney")
	if err != nil {
		t.Fatalf("load Australia/Sydney: %v", err)
	}
	local := rebuilt.ScheduledAt.In(sydney)
	if local.Hour() != 9 || local.Minute() != 0 {
		t.Fatalf("rebuilt schedule = %s, want 09:00 Australia/Sydney", local.Format(time.RFC3339))
	}
	var dueCount int64
	if err := notifications.db.Model(&models.ContactReminderScheduled{}).
		Where("id = ? AND scheduled_at <= ?", rebuilt.ID, rebuilt.ScheduledAt.UTC()).
		Count(&dueCount).Error; err != nil {
		t.Fatalf("query rebuilt schedule at UTC instant: %v", err)
	}
	if dueCount != 1 {
		t.Fatal("rebuilt schedule is not queryable at its UTC fire instant")
	}
	if _, err := preferences.UpdateAll(userID, dto.UpdatePreferencesRequest{Timezone: "Australia/Sydney", DateFormat: "YYYY-MM-DD"}); err != nil {
		t.Fatalf("save unchanged timezone: %v", err)
	}
	var unchanged models.ContactReminderScheduled
	if err := notifications.db.Where("user_notification_channel_id = ? AND contact_reminder_id = ? AND triggered_at IS NULL", channel.ID, reminderID).
		First(&unchanged).Error; err != nil {
		t.Fatalf("load schedule after unchanged timezone save: %v", err)
	}
	if unchanged.ID != rebuilt.ID {
		t.Fatalf("unchanged timezone replaced schedule %d with %d", rebuilt.ID, unchanged.ID)
	}
}

func TestPreferenceUpdateSingleField(t *testing.T) {
	svc, userID := setupPreferenceTest(t)

	tests := []struct {
		name   string
		update func() error
		check  func(*dto.PreferencesResponse) string
	}{
		{
			"name_order",
			func() error {
				return svc.UpdateNameOrder(userID, dto.UpdateNameOrderRequest{NameOrder: "%last_name% %first_name%"})
			},
			func(p *dto.PreferencesResponse) string { return p.NameOrder },
		},
		{
			"date_format",
			func() error {
				return svc.UpdateDateFormat(userID, dto.UpdateDateFormatRequest{DateFormat: "DD/MM/YYYY"})
			},
			func(p *dto.PreferencesResponse) string { return p.DateFormat },
		},
		{
			"timezone",
			func() error {
				return svc.UpdateTimezone(userID, dto.UpdateTimezoneRequest{Timezone: "America/New_York"})
			},
			func(p *dto.PreferencesResponse) string { return p.Timezone },
		},
		{
			"locale",
			func() error {
				return svc.UpdateLocale(userID, dto.UpdateLocaleRequest{Locale: "es"})
			},
			func(p *dto.PreferencesResponse) string { return p.Locale },
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.update(); err != nil {
				t.Fatalf("Update failed: %v", err)
			}
			prefs, err := svc.Get(userID)
			if err != nil {
				t.Fatalf("Get failed: %v", err)
			}
			got := tt.check(prefs)
			if got == "" {
				t.Errorf("Expected non-empty value for %s", tt.name)
			}
		})
	}
}

func TestPreferenceUpdateAll(t *testing.T) {
	svc, userID := setupPreferenceTest(t)

	prefs, err := svc.UpdateAll(userID, dto.UpdatePreferencesRequest{
		NameOrder:          "%last_name% %first_name%",
		DateFormat:         "DD/MM/YYYY",
		Timezone:           "Asia/Shanghai",
		Locale:             "zh",
		WeekStart:          "monday",
		ContactSortOrder:   "first_met_at",
		ContactListColumns: []string{"name", "birthday", "groups"},
		DashboardTab:       "activities",
		TaskView:           "kanban",
		TaskSort:           "due_date",
		Theme:              "dark",
	})
	if err != nil {
		t.Fatalf("UpdateAll failed: %v", err)
	}
	if prefs.NameOrder != "%last_name% %first_name%" {
		t.Errorf("Expected name_order '%%last_name%% %%first_name%%', got '%s'", prefs.NameOrder)
	}
	if prefs.DateFormat != "DD/MM/YYYY" {
		t.Errorf("Expected date_format 'DD/MM/YYYY', got '%s'", prefs.DateFormat)
	}
	if prefs.Timezone != "Asia/Shanghai" {
		t.Errorf("Expected timezone 'Asia/Shanghai', got '%s'", prefs.Timezone)
	}
	if prefs.Locale != "zh" {
		t.Errorf("Expected locale 'zh', got '%s'", prefs.Locale)
	}
	if prefs.WeekStart != "monday" {
		t.Errorf("Expected week_start 'monday', got '%s'", prefs.WeekStart)
	}
	if prefs.ContactSortOrder != "first_met_at" || prefs.DashboardTab != "activities" ||
		prefs.TaskView != "kanban" || prefs.TaskSort != "due_date" || prefs.Theme != "dark" {
		t.Fatalf("view preferences were not persisted: %+v", prefs)
	}
	if len(prefs.ContactListColumns) != 3 || prefs.ContactListColumns[1] != "birthday" {
		t.Fatalf("contact columns were not persisted: %v", prefs.ContactListColumns)
	}
}

func TestPreferenceUpdateAllPartial(t *testing.T) {
	svc, userID := setupPreferenceTest(t)

	if err := svc.UpdateLocale(userID, dto.UpdateLocaleRequest{Locale: "zh"}); err != nil {
		t.Fatalf("UpdateLocale failed: %v", err)
	}

	prefs, err := svc.UpdateAll(userID, dto.UpdatePreferencesRequest{
		Timezone: "Europe/Berlin",
	})
	if err != nil {
		t.Fatalf("UpdateAll partial failed: %v", err)
	}
	if prefs.Timezone != "Europe/Berlin" {
		t.Errorf("Expected timezone 'Europe/Berlin', got '%s'", prefs.Timezone)
	}
	if prefs.Locale != "zh" {
		t.Errorf("Expected locale to remain 'zh', got '%s'", prefs.Locale)
	}
}

func TestPreferenceEnableAlternativeCalendar(t *testing.T) {
	svc, userID := setupPreferenceTest(t)

	prefs, err := svc.Get(userID)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if prefs.EnableAlternativeCalendar {
		t.Error("Expected enable_alternative_calendar to default to false")
	}

	enabled := true
	prefs, err = svc.UpdateAll(userID, dto.UpdatePreferencesRequest{
		EnableAlternativeCalendar: &enabled,
	})
	if err != nil {
		t.Fatalf("UpdateAll failed: %v", err)
	}
	if !prefs.EnableAlternativeCalendar {
		t.Error("Expected enable_alternative_calendar to be true after update")
	}

	disabled := false
	prefs, err = svc.UpdateAll(userID, dto.UpdatePreferencesRequest{
		EnableAlternativeCalendar: &disabled,
	})
	if err != nil {
		t.Fatalf("UpdateAll failed: %v", err)
	}
	if prefs.EnableAlternativeCalendar {
		t.Error("Expected enable_alternative_calendar to be false after update")
	}
}

func TestValidateNameOrder(t *testing.T) {
	tests := []struct {
		name      string
		nameOrder string
		wantErr   bool
	}{
		{"valid: first_last", "%first_name% %last_name%", false},
		{"valid: last_first", "%last_name% %first_name%", false},
		{"valid: with nickname", "%first_name% %last_name% (%nickname%)", false},
		{"valid: nickname only", "%nickname%", false},
		{"valid: all fields", "%first_name% %middle_name% %last_name%", false},
		{"valid: with maiden_name", "%first_name% (%maiden_name%) %last_name%", false},
		{"valid: nickname conditional", "%first_name% %last_name%{nickname? (%nickname%)}", false},
		{"valid: middle name conditional", "%first_name%{middle_name? %middle_name%} %last_name%", false},
		{"valid: conditional literal text", "%first_name%{nickname? aka %nickname%} %last_name%", false},
		{"invalid: empty", "", true},
		{"invalid: no variables", "hello world", true},
		{"invalid: odd percent", "%first_name", true},
		{"invalid: unknown variable", "%unknown%", true},
		{"invalid: mixed valid and unknown", "%first_name% %foo%", true},
		{"invalid: unknown variable in conditional", "%first_name%{nickname? %foo%}", true},
		{"invalid: unknown conditional field", "%first_name%{display_name? %nickname%}", true},
		{"invalid: unclosed conditional", "%first_name%{nickname? %nickname%", true},
		{"invalid: unopened conditional", "%first_name%nickname? %nickname%}", true},
		{"invalid: missing conditional question", "%first_name%{nickname %nickname%}", true},
		{"invalid: empty conditional template", "%first_name%{nickname?}", true},
		{"invalid: nested conditional", "%first_name%{nickname? {maiden_name? %maiden_name%}}", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateNameOrder(tt.nameOrder)
			if tt.wantErr && err == nil {
				t.Error("Expected error but got nil")
			}
			if tt.wantErr && err != nil && !errors.Is(err, ErrInvalidNameOrder) {
				t.Errorf("Expected ErrInvalidNameOrder, got: %v", err)
			}
			if !tt.wantErr && err != nil {
				t.Errorf("Expected no error but got: %v", err)
			}
		})
	}
}

func TestPreferenceUpdateNameOrderRejectsInvalid(t *testing.T) {
	svc, userID := setupPreferenceTest(t)

	err := svc.UpdateNameOrder(userID, dto.UpdateNameOrderRequest{NameOrder: "no variables here"})
	if !errors.Is(err, ErrInvalidNameOrder) {
		t.Errorf("Expected ErrInvalidNameOrder for invalid name_order, got %v", err)
	}

	err = svc.UpdateNameOrder(userID, dto.UpdateNameOrderRequest{NameOrder: "%unknown_var%"})
	if !errors.Is(err, ErrInvalidNameOrder) {
		t.Errorf("Expected ErrInvalidNameOrder for unknown variable, got %v", err)
	}

	err = svc.UpdateNameOrder(userID, dto.UpdateNameOrderRequest{NameOrder: "%nickname%"})
	if err != nil {
		t.Errorf("Expected no error for valid name_order, got: %v", err)
	}
	prefs, _ := svc.Get(userID)
	if prefs.NameOrder != "%nickname%" {
		t.Errorf("Expected name_order '%%nickname%%', got '%s'", prefs.NameOrder)
	}
}

func TestPreferenceUpdateAllRejectsInvalidNameOrder(t *testing.T) {
	svc, userID := setupPreferenceTest(t)

	_, err := svc.UpdateAll(userID, dto.UpdatePreferencesRequest{
		NameOrder: "invalid no variables",
	})
	if !errors.Is(err, ErrInvalidNameOrder) {
		t.Errorf("Expected ErrInvalidNameOrder for invalid name_order in UpdateAll, got %v", err)
	}

	prefs, err := svc.UpdateAll(userID, dto.UpdatePreferencesRequest{
		NameOrder: "%last_name%, %first_name%",
	})
	if err != nil {
		t.Errorf("Expected no error, got: %v", err)
	}
	if prefs.NameOrder != "%last_name%, %first_name%" {
		t.Errorf("Expected '%%last_name%%, %%first_name%%', got '%s'", prefs.NameOrder)
	}
}

func TestPreferenceUpdateAllRejectsInvalidWeekStart(t *testing.T) {
	svc, userID := setupPreferenceTest(t)

	_, err := svc.UpdateAll(userID, dto.UpdatePreferencesRequest{
		WeekStart: "friday",
	})
	if err == nil {
		t.Error("Expected error for invalid week_start, got nil")
	}

	prefs, err := svc.Get(userID)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if prefs.WeekStart != "sunday" {
		t.Errorf("Expected week_start to remain sunday, got %q", prefs.WeekStart)
	}
}

func TestPreferenceViewFieldsRejectInvalidValuesAtomically(t *testing.T) {
	svc, userID := setupPreferenceTest(t)
	tests := []dto.UpdatePreferencesRequest{
		{ContactSortOrder: "last_updated"},
		{ContactListColumns: []string{"nickname"}},
		{ContactListColumns: []string{"name", "name"}},
		{DashboardTab: "reports"},
		{TaskView: "grid"},
		{TaskSort: "priority"},
		{Theme: "blue"},
	}
	for _, req := range tests {
		request := req
		request.DateFormat = "SHOULD-NOT-BE-SAVED"
		if _, err := svc.UpdateAll(userID, request); !errors.Is(err, ErrInvalidViewPreference) {
			t.Fatalf("request %+v returned %v", req, err)
		}
		current, err := svc.Get(userID)
		if err != nil {
			t.Fatalf("get preferences: %v", err)
		}
		if current.DateFormat == "SHOULD-NOT-BE-SAVED" {
			t.Fatalf("invalid request partially updated the user: %+v", req)
		}
	}
}

func TestPreferencesAreIsolatedPerSystemUser(t *testing.T) {
	db := testutil.SetupTestDB(t)
	auth := NewAuthService(db, testutil.TestJWTConfig())
	first, err := auth.Register(dto.RegisterRequest{FirstName: "First", Email: "first-prefs@example.com", Password: "password123"}, "en")
	if err != nil {
		t.Fatalf("register first user: %v", err)
	}
	second, err := auth.Register(dto.RegisterRequest{FirstName: "Second", Email: "second-prefs@example.com", Password: "password123"}, "en")
	if err != nil {
		t.Fatalf("register second user: %v", err)
	}
	svc := NewPreferenceService(db)
	if _, err := svc.UpdateAll(first.User.ID, dto.UpdatePreferencesRequest{
		DashboardTab: "life_metrics", TaskView: "kanban", Theme: "dark",
	}); err != nil {
		t.Fatalf("update first user: %v", err)
	}
	firstPrefs, _ := svc.Get(first.User.ID)
	secondPrefs, _ := svc.Get(second.User.ID)
	if firstPrefs.DashboardTab != "life_metrics" || firstPrefs.TaskView != "kanban" || firstPrefs.Theme != "dark" {
		t.Fatalf("first preferences not saved: %+v", firstPrefs)
	}
	if secondPrefs.DashboardTab != "feed" || secondPrefs.TaskView != "list" || secondPrefs.Theme != "system" {
		t.Fatalf("first user's preferences leaked to second user: %+v", secondPrefs)
	}
}
