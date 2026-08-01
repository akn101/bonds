package services

import (
	"testing"

	"github.com/naiba/bonds/internal/models"
)

func TestNotificationService_ScheduleAllContactReminders_schedulesOnlyCurrentAudienceAndDoesNotDuplicate(t *testing.T) {
	// Given
	ctx := setupReminderAudienceTest(t)
	memberID := ctx.createVaultMember(t, "notification-audience-member@example.com")
	emptyAudienceReminder, err := ctx.service.Create(ctx.contactID, ctx.vaultID, createReminderAudienceRequest(t, models.ReminderAudienceSelectedUsers, []string{}))
	if err != nil {
		t.Fatalf("create empty selected audience reminder: %v", err)
	}
	unselectedAudienceReminder, err := ctx.service.Create(ctx.contactID, ctx.vaultID, createReminderAudienceRequest(t, models.ReminderAudienceSelectedUsers, []string{memberID}))
	if err != nil {
		t.Fatalf("create other-member selected audience reminder: %v", err)
	}
	selectedAudienceReminder, err := ctx.service.Create(ctx.contactID, ctx.vaultID, createReminderAudienceRequest(t, models.ReminderAudienceSelectedUsers, []string{ctx.ownerID}))
	if err != nil {
		t.Fatalf("create owner selected audience reminder: %v", err)
	}
	allVaultUsersReminder, err := ctx.service.Create(ctx.contactID, ctx.vaultID, createReminderAudienceRequest(t, models.ReminderAudienceAllVaultUsers, nil))
	if err != nil {
		t.Fatalf("create all-vault-users reminder: %v", err)
	}
	channel := ctx.createActiveChannel(t, ctx.ownerID)
	notificationService := NewNotificationService(ctx.db)

	// When
	if err := notificationService.ScheduleAllContactReminders(channel.ID, ctx.ownerID); err != nil {
		t.Fatalf("schedule reminders for active channel: %v", err)
	}
	if err := notificationService.ScheduleAllContactReminders(channel.ID, ctx.ownerID); err != nil {
		t.Fatalf("schedule reminders a second time: %v", err)
	}

	// Then
	var schedules []models.ContactReminderScheduled
	if err := ctx.db.Where("user_notification_channel_id = ? AND triggered_at IS NULL", channel.ID).
		Order("contact_reminder_id ASC").Find(&schedules).Error; err != nil {
		t.Fatalf("load pending schedules: %v", err)
	}
	if len(schedules) != 2 {
		t.Fatalf("pending schedules = %d, want 2 for current all-vault-users and selected audiences", len(schedules))
	}
	scheduledReminderIDs := []uint{schedules[0].ContactReminderID, schedules[1].ContactReminderID}
	if scheduledReminderIDs[0] != selectedAudienceReminder.ID || scheduledReminderIDs[1] != allVaultUsersReminder.ID {
		t.Fatalf("scheduled reminder IDs = %#v, want [%d %d]", scheduledReminderIDs, selectedAudienceReminder.ID, allVaultUsersReminder.ID)
	}
	for _, reminderID := range []uint{emptyAudienceReminder.ID, unselectedAudienceReminder.ID} {
		var count int64
		if err := ctx.db.Model(&models.ContactReminderScheduled{}).
			Where("user_notification_channel_id = ? AND contact_reminder_id = ?", channel.ID, reminderID).
			Count(&count).Error; err != nil {
			t.Fatalf("count excluded reminder %d schedules: %v", reminderID, err)
		}
		if count != 0 {
			t.Fatalf("reminder %d schedules = %d, want 0", reminderID, count)
		}
	}
}
