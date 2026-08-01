package services

import (
	"sort"
	"testing"

	"github.com/naiba/bonds/internal/models"
)

func TestReminderAudience_CreateDefaultsToAllVaultUsersWhenOmitted(t *testing.T) {
	// Given
	ctx := setupReminderAudienceTest(t)
	memberID := ctx.createVaultMember(t, "reminder-audience-member@example.com")
	ctx.createActiveChannel(t, ctx.ownerID)
	ctx.createActiveChannel(t, memberID)

	// When
	reminder, err := ctx.service.Create(ctx.contactID, ctx.vaultID, createReminderAudienceRequest(t, "", nil))
	if err != nil {
		t.Fatalf("create reminder: %v", err)
	}

	// Then
	response := decodeReminderAudienceResponse(t, reminder)
	if response.Audience != "all_vault_users" {
		t.Fatalf("audience = %q, want all_vault_users", response.Audience)
	}
	if response.SelectedUserIDs == nil || len(response.SelectedUserIDs) != 0 {
		t.Fatalf("selected_user_ids = %#v, want non-nil empty slice", response.SelectedUserIDs)
	}
	var scheduledCount int64
	if err := ctx.db.Model(&models.ContactReminderScheduled{}).Where("contact_reminder_id = ?", reminder.ID).Count(&scheduledCount).Error; err != nil {
		t.Fatalf("count scheduled reminders: %v", err)
	}
	if scheduledCount != 2 {
		t.Fatalf("scheduled reminders = %d, want 2", scheduledCount)
	}
}

func TestReminderAudience_CreateSelectedEmptySetCreatesNoSchedules(t *testing.T) {
	// Given
	ctx := setupReminderAudienceTest(t)
	ctx.createActiveChannel(t, ctx.ownerID)

	// When
	reminder, err := ctx.service.Create(ctx.contactID, ctx.vaultID, createReminderAudienceRequest(t, "selected_users", []string{}))
	if err != nil {
		t.Fatalf("create reminder: %v", err)
	}

	// Then
	response := decodeReminderAudienceResponse(t, reminder)
	if response.Audience != "selected_users" {
		t.Fatalf("audience = %q, want selected_users", response.Audience)
	}
	if response.SelectedUserIDs == nil || len(response.SelectedUserIDs) != 0 {
		t.Fatalf("selected_user_ids = %#v, want non-nil empty slice", response.SelectedUserIDs)
	}
	var scheduledCount int64
	if err := ctx.db.Model(&models.ContactReminderScheduled{}).Where("contact_reminder_id = ?", reminder.ID).Count(&scheduledCount).Error; err != nil {
		t.Fatalf("count scheduled reminders: %v", err)
	}
	if scheduledCount != 0 {
		t.Fatalf("scheduled reminders = %d, want 0", scheduledCount)
	}
}

func TestReminderAudience_CreateSelectedUsersDeduplicatesAndSchedulesOnlySelectedActiveChannels(t *testing.T) {
	// Given
	ctx := setupReminderAudienceTest(t)
	memberID := ctx.createVaultMember(t, "reminder-audience-selected@example.com")
	otherMemberID := ctx.createVaultMember(t, "reminder-audience-other@example.com")
	selectedFirst := ctx.createActiveChannel(t, memberID)
	selectedSecond := ctx.createActiveChannel(t, memberID)
	ctx.createActiveChannel(t, otherMemberID)

	// When
	reminder, err := ctx.service.Create(ctx.contactID, ctx.vaultID, createReminderAudienceRequest(t, "selected_users", []string{memberID, memberID}))
	if err != nil {
		t.Fatalf("create reminder: %v", err)
	}

	// Then
	response := decodeReminderAudienceResponse(t, reminder)
	if len(response.SelectedUserIDs) != 1 || response.SelectedUserIDs[0] != memberID {
		t.Fatalf("selected_user_ids = %#v, want [%q]", response.SelectedUserIDs, memberID)
	}
	var schedules []models.ContactReminderScheduled
	if err := ctx.db.Where("contact_reminder_id = ?", reminder.ID).Order("user_notification_channel_id ASC").Find(&schedules).Error; err != nil {
		t.Fatalf("load scheduled reminders: %v", err)
	}
	if len(schedules) != 2 || schedules[0].UserNotificationChannelID != selectedFirst.ID || schedules[1].UserNotificationChannelID != selectedSecond.ID {
		t.Fatalf("scheduled channel IDs = %#v, want [%d %d]", scheduleChannelIDs(schedules), selectedFirst.ID, selectedSecond.ID)
	}
	var recipientCount int64
	if err := ctx.db.Table("contact_reminder_selected_users").Where("contact_reminder_id = ?", reminder.ID).Count(&recipientCount).Error; err != nil {
		t.Fatalf("count selected recipients: %v", err)
	}
	if recipientCount != 1 {
		t.Fatalf("selected recipients = %d, want 1", recipientCount)
	}
}

func TestReminderAudience_CreateRejectsSelectedUsersOutsideVaultAtomically(t *testing.T) {
	// Given
	ctx := setupReminderAudienceTest(t)
	ctx.createActiveChannel(t, ctx.ownerID)
	outsiderID := "not-a-vault-member"

	// When
	_, err := ctx.service.Create(ctx.contactID, ctx.vaultID, createReminderAudienceRequest(t, "selected_users", []string{ctx.ownerID, outsiderID}))

	// Then
	if err == nil {
		t.Fatal("create selected reminder succeeded for a non-member")
	}
	var reminderCount int64
	if err := ctx.db.Model(&models.ContactReminder{}).Where("contact_id = ?", ctx.contactID).Count(&reminderCount).Error; err != nil {
		t.Fatalf("count reminders: %v", err)
	}
	if reminderCount != 0 {
		t.Fatalf("reminders persisted = %d, want 0", reminderCount)
	}
}

func TestReminderAudience_CreateRejectsSelectedUsersForAllVaultUsers(t *testing.T) {
	// Given
	ctx := setupReminderAudienceTest(t)

	// When
	_, err := ctx.service.Create(ctx.contactID, ctx.vaultID, createReminderAudienceRequest(t, "all_vault_users", []string{ctx.ownerID}))

	// Then
	if err == nil {
		t.Fatal("create all-vault-users reminder accepted selected_user_ids")
	}
}

func TestReminderAudience_CreateSortsDeduplicatedSelectedUsersInResponse(t *testing.T) {
	// Given
	ctx := setupReminderAudienceTest(t)
	firstMemberID := ctx.createVaultMember(t, "reminder-audience-sort-first@example.com")
	secondMemberID := ctx.createVaultMember(t, "reminder-audience-sort-second@example.com")
	expectedUserIDs := []string{firstMemberID, secondMemberID}
	sort.Strings(expectedUserIDs)

	// When
	reminder, err := ctx.service.Create(ctx.contactID, ctx.vaultID, createReminderAudienceRequest(t, "selected_users", []string{secondMemberID, firstMemberID, secondMemberID}))
	if err != nil {
		t.Fatalf("create reminder: %v", err)
	}

	// Then
	response := decodeReminderAudienceResponse(t, reminder)
	if len(response.SelectedUserIDs) != len(expectedUserIDs) {
		t.Fatalf("selected_user_ids = %#v, want %#v", response.SelectedUserIDs, expectedUserIDs)
	}
	for index := range expectedUserIDs {
		if response.SelectedUserIDs[index] != expectedUserIDs[index] {
			t.Fatalf("selected_user_ids = %#v, want %#v", response.SelectedUserIDs, expectedUserIDs)
		}
	}
}

func TestReminderAudience_ListReturnsPersistedSelectedUsers(t *testing.T) {
	// Given
	ctx := setupReminderAudienceTest(t)
	memberID := ctx.createVaultMember(t, "reminder-audience-list@example.com")
	created, err := ctx.service.Create(ctx.contactID, ctx.vaultID, createReminderAudienceRequest(t, "selected_users", []string{memberID}))
	if err != nil {
		t.Fatalf("create reminder: %v", err)
	}

	// When
	reminders, err := ctx.service.List(ctx.contactID, ctx.vaultID)
	if err != nil {
		t.Fatalf("list reminders: %v", err)
	}

	// Then
	if len(reminders) != 1 || reminders[0].ID != created.ID {
		t.Fatalf("listed reminders = %#v, want reminder %d", reminders, created.ID)
	}
	response := decodeReminderAudienceResponse(t, reminders[0])
	if response.Audience != "selected_users" || len(response.SelectedUserIDs) != 1 || response.SelectedUserIDs[0] != memberID {
		t.Fatalf("listed reminder audience = %#v, want selected user %q", response, memberID)
	}
}

func scheduleChannelIDs(schedules []models.ContactReminderScheduled) []uint {
	channelIDs := make([]uint, len(schedules))
	for index := range schedules {
		channelIDs[index] = schedules[index].UserNotificationChannelID
	}
	return channelIDs
}
