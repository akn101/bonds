package services

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
)

func TestReminderAudience_UpdateReplacesRecipientsAndPendingSchedulesPreservingTriggeredHistory(t *testing.T) {
	// Given
	ctx := setupReminderAudienceTest(t)
	memberID := ctx.createVaultMember(t, "reminder-audience-update@example.com")
	firstOwnerChannel := ctx.createActiveChannel(t, ctx.ownerID)
	secondOwnerChannel := ctx.createActiveChannel(t, ctx.ownerID)
	memberChannel := ctx.createActiveChannel(t, memberID)
	created, err := ctx.service.Create(ctx.contactID, ctx.vaultID, createReminderAudienceRequest(t, "selected_users", []string{ctx.ownerID}))
	if err != nil {
		t.Fatalf("create reminder: %v", err)
	}
	triggeredAt := time.Now()
	if err := ctx.db.Model(&models.ContactReminderScheduled{}).
		Where("contact_reminder_id = ? AND user_notification_channel_id = ?", created.ID, firstOwnerChannel.ID).
		Update("triggered_at", triggeredAt).Error; err != nil {
		t.Fatalf("mark schedule triggered: %v", err)
	}

	// When
	updated, err := ctx.service.Update(created.ID, ctx.contactID, ctx.vaultID, updateReminderAudienceRequest(t, "selected_users", []string{memberID}))
	if err != nil {
		t.Fatalf("update reminder: %v", err)
	}

	// Then
	response := decodeReminderAudienceResponse(t, updated)
	if len(response.SelectedUserIDs) != 1 || response.SelectedUserIDs[0] != memberID {
		t.Fatalf("selected_user_ids = %#v, want [%q]", response.SelectedUserIDs, memberID)
	}
	var triggeredSchedules []models.ContactReminderScheduled
	if err := ctx.db.Where("contact_reminder_id = ? AND triggered_at IS NOT NULL", created.ID).Find(&triggeredSchedules).Error; err != nil {
		t.Fatalf("load triggered schedules: %v", err)
	}
	if len(triggeredSchedules) != 1 || triggeredSchedules[0].UserNotificationChannelID != firstOwnerChannel.ID {
		t.Fatalf("triggered schedules = %#v, want owner channel %d", scheduleChannelIDs(triggeredSchedules), firstOwnerChannel.ID)
	}
	var pendingSchedules []models.ContactReminderScheduled
	if err := ctx.db.Where("contact_reminder_id = ? AND triggered_at IS NULL", created.ID).Find(&pendingSchedules).Error; err != nil {
		t.Fatalf("load pending schedules: %v", err)
	}
	if len(pendingSchedules) != 1 || pendingSchedules[0].UserNotificationChannelID != memberChannel.ID {
		t.Fatalf("pending schedules = %#v, want member channel %d", scheduleChannelIDs(pendingSchedules), memberChannel.ID)
	}
	if secondOwnerChannel.ID == firstOwnerChannel.ID {
		t.Fatal("owner channels must have distinct IDs")
	}
}

func TestReminderAudience_UpdatePreservesSelectedAudienceWhenAudienceFieldsAreOmitted(t *testing.T) {
	// Given
	ctx := setupReminderAudienceTest(t)
	ownerChannel := ctx.createActiveChannel(t, ctx.ownerID)
	memberID := ctx.createVaultMember(t, "reminder-audience-preserve@example.com")
	memberChannel := ctx.createActiveChannel(t, memberID)
	created, err := ctx.service.Create(ctx.contactID, ctx.vaultID, createReminderAudienceRequest(t, "selected_users", []string{ctx.ownerID}))
	if err != nil {
		t.Fatalf("create reminder: %v", err)
	}
	var request dto.UpdateReminderRequest
	if err := json.Unmarshal([]byte(`{"label":"Updated audience reminder","day":2,"month":2,"type":"one_time"}`), &request); err != nil {
		t.Fatalf("unmarshal update reminder request: %v", err)
	}

	// When
	updated, err := ctx.service.Update(created.ID, ctx.contactID, ctx.vaultID, request)
	if err != nil {
		t.Fatalf("update reminder: %v", err)
	}

	// Then
	response := decodeReminderAudienceResponse(t, updated)
	if response.Audience != models.ReminderAudienceSelectedUsers {
		t.Fatalf("audience = %q, want %q", response.Audience, models.ReminderAudienceSelectedUsers)
	}
	if len(response.SelectedUserIDs) != 1 || response.SelectedUserIDs[0] != ctx.ownerID {
		t.Fatalf("selected_user_ids = %#v, want [%q]", response.SelectedUserIDs, ctx.ownerID)
	}
	var pendingSchedules []models.ContactReminderScheduled
	if err := ctx.db.Where("contact_reminder_id = ? AND triggered_at IS NULL", created.ID).Find(&pendingSchedules).Error; err != nil {
		t.Fatalf("load pending schedules: %v", err)
	}
	if len(pendingSchedules) != 1 || pendingSchedules[0].UserNotificationChannelID != ownerChannel.ID {
		t.Fatalf("pending schedules = %#v, want owner channel %d and exclude member channel %d", scheduleChannelIDs(pendingSchedules), ownerChannel.ID, memberChannel.ID)
	}
}

func TestReminderAudience_DeleteRemovesSelectedRecipients(t *testing.T) {
	// Given
	ctx := setupReminderAudienceTest(t)
	created, err := ctx.service.Create(ctx.contactID, ctx.vaultID, createReminderAudienceRequest(t, "selected_users", []string{ctx.ownerID}))
	if err != nil {
		t.Fatalf("create reminder: %v", err)
	}

	// When
	if err := ctx.service.Delete(created.ID, ctx.contactID, ctx.vaultID); err != nil {
		t.Fatalf("delete reminder: %v", err)
	}

	// Then
	var recipientCount int64
	if err := ctx.db.Table("contact_reminder_selected_users").Where("contact_reminder_id = ?", created.ID).Count(&recipientCount).Error; err != nil {
		t.Fatalf("count selected recipients: %v", err)
	}
	if recipientCount != 0 {
		t.Fatalf("selected recipients = %d, want 0", recipientCount)
	}
}
