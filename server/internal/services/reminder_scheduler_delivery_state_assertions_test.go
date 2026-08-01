package services

import (
	"testing"

	"github.com/naiba/bonds/internal/models"
)

func assertIneligibleDeliveryState(t *testing.T, ctx *reminderSchedulerTestContext, reminderID, scheduleID uint) {
	t.Helper()
	if len(ctx.mailer.calls) != 0 {
		t.Fatalf("expected no email delivery, got %d sends", len(ctx.mailer.calls))
	}

	var scheduleCount int64
	if err := ctx.db.Model(&models.ContactReminderScheduled{}).Where("id = ?", scheduleID).Count(&scheduleCount).Error; err != nil {
		t.Fatalf("count discarded schedule: %v", err)
	}
	if scheduleCount != 0 {
		t.Fatalf("expected ineligible schedule to be deleted, got %d rows", scheduleCount)
	}

	var notificationCount int64
	if err := ctx.db.Model(&models.UserNotificationSent{}).Count(&notificationCount).Error; err != nil {
		t.Fatalf("count notification logs: %v", err)
	}
	if notificationCount != 0 {
		t.Fatalf("expected no notification log, got %d", notificationCount)
	}

	var reminder models.ContactReminder
	if err := ctx.db.First(&reminder, reminderID).Error; err != nil {
		t.Fatalf("reload reminder: %v", err)
	}
	if reminder.NumberTimesTriggered != 0 || reminder.LastTriggeredAt != nil {
		t.Fatalf("expected reminder to remain untriggered, got count=%d triggered_at=%v", reminder.NumberTimesTriggered, reminder.LastTriggeredAt)
	}

	var pendingCount int64
	if err := ctx.db.Model(&models.ContactReminderScheduled{}).Where("contact_reminder_id = ? AND triggered_at IS NULL", reminderID).Count(&pendingCount).Error; err != nil {
		t.Fatalf("count pending schedules: %v", err)
	}
	if pendingCount != 0 {
		t.Fatalf("expected no recurring replacement schedule, got %d", pendingCount)
	}
}
