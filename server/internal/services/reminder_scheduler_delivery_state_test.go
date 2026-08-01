package services

import (
	"errors"
	"testing"
	"time"

	"github.com/naiba/bonds/internal/models"
)

type recordingNotificationSender struct {
	calls   []notificationSenderCall
	sendErr error
}

type notificationSenderCall struct {
	destination string
	subject     string
	message     string
}

func (s *recordingNotificationSender) Send(destination, subject, message string) error {
	s.calls = append(s.calls, notificationSenderCall{destination: destination, subject: subject, message: message})
	return s.sendErr
}

func loadPreloadedReminderSchedule(t *testing.T, ctx *reminderSchedulerTestContext, scheduleID uint) models.ContactReminderScheduled {
	t.Helper()

	var schedule models.ContactReminderScheduled
	if err := ctx.db.
		Preload("ContactReminder.Contact").
		Preload("UserNotificationChannel.User").
		First(&schedule, scheduleID).Error; err != nil {
		t.Fatalf("load preloaded schedule: %v", err)
	}
	return schedule
}

func TestReminderScheduler_processOne_discardsLegacySchedule_whenChannelIsDeactivatedAfterPreload(t *testing.T) {
	// Given
	ctx := setupReminderSchedulerTest(t)
	channel := ctx.createEmailChannel(t)
	reminder := ctx.createReminder(t, "recurring_week", freqPtr(1))
	schedule := ctx.createScheduled(t, reminder.ID, channel.ID, time.Now().Add(-time.Hour), nil)
	staleSchedule := loadPreloadedReminderSchedule(t, ctx, schedule.ID)
	if err := ctx.db.Model(channel).Update("active", false).Error; err != nil {
		t.Fatalf("deactivate channel: %v", err)
	}

	// When
	ctx.svc.processOne(&staleSchedule)

	// Then
	assertIneligibleDeliveryState(t, ctx, reminder.ID, schedule.ID)
}

func TestReminderScheduler_processOne_discardsLegacySchedule_whenOwnerLeavesContactVaultAfterPreload(t *testing.T) {
	// Given
	ctx := setupReminderSchedulerTest(t)
	channel := ctx.createEmailChannel(t)
	reminder := ctx.createReminder(t, "recurring_week", freqPtr(1))
	schedule := ctx.createScheduled(t, reminder.ID, channel.ID, time.Now().Add(-time.Hour), nil)
	staleSchedule := loadPreloadedReminderSchedule(t, ctx, schedule.ID)
	if err := ctx.db.Where("vault_id = ? AND user_id = ?", ctx.vaultID, ctx.userID).
		Delete(&models.UserVault{}).Error; err != nil {
		t.Fatalf("remove vault membership: %v", err)
	}

	// When
	ctx.svc.processOne(&staleSchedule)

	// Then
	assertIneligibleDeliveryState(t, ctx, reminder.ID, schedule.ID)
}

func TestReminderScheduler_processOne_discardsLegacySchedule_whenSelectedRecipientIsRemovedAfterPreload(t *testing.T) {
	// Given
	ctx := setupReminderSchedulerTest(t)
	channel := ctx.createEmailChannel(t)
	reminder := ctx.createReminder(t, "recurring_week", freqPtr(1))
	if err := ctx.db.Model(reminder).Update("audience", models.ReminderAudienceSelectedUsers).Error; err != nil {
		t.Fatalf("set selected-users audience: %v", err)
	}
	recipient := models.ContactReminderSelectedUser{ContactReminderID: reminder.ID, UserID: ctx.userID}
	if err := ctx.db.Create(&recipient).Error; err != nil {
		t.Fatalf("create selected recipient: %v", err)
	}
	schedule := ctx.createScheduled(t, reminder.ID, channel.ID, time.Now().Add(-time.Hour), nil)
	staleSchedule := loadPreloadedReminderSchedule(t, ctx, schedule.ID)
	if err := ctx.db.Delete(&recipient).Error; err != nil {
		t.Fatalf("delete selected recipient: %v", err)
	}

	// When
	ctx.svc.processOne(&staleSchedule)

	// Then
	assertIneligibleDeliveryState(t, ctx, reminder.ID, schedule.ID)
}

func TestReminderScheduler_processOne_discardsLegacySchedule_whenChannelHasNoOwner(t *testing.T) {
	// Given
	ctx := setupReminderSchedulerTest(t)
	channel := models.UserNotificationChannel{Type: "email", Content: "orphaned@example.com"}
	if err := ctx.db.Create(&channel).Error; err != nil {
		t.Fatalf("create ownerless channel: %v", err)
	}
	if err := ctx.db.Model(&channel).Update("active", true).Error; err != nil {
		t.Fatalf("activate ownerless channel: %v", err)
	}
	reminder := ctx.createReminder(t, "recurring_week", freqPtr(1))
	schedule := ctx.createScheduled(t, reminder.ID, channel.ID, time.Now().Add(-time.Hour), nil)

	// When
	ctx.svc.processOne(schedule)

	// Then
	assertIneligibleDeliveryState(t, ctx, reminder.ID, schedule.ID)
}

func TestReminderScheduler_keepsRecurringSchedulePending_whenDeliveryFails(t *testing.T) {
	// Given
	ctx := setupReminderSchedulerTest(t)
	ctx.mailer.sendErr = errors.New("SMTP connection refused")
	channel := ctx.createEmailChannel(t)
	reminder := ctx.createReminder(t, "recurring_week", freqPtr(1))
	schedule := ctx.createScheduled(t, reminder.ID, channel.ID, time.Now().Add(-time.Hour), nil)

	// When
	ctx.svc.ProcessDueReminders()

	// Then
	if len(ctx.mailer.calls) != 1 {
		t.Fatalf("expected one delivery attempt, got %d", len(ctx.mailer.calls))
	}

	var reloadedSchedule models.ContactReminderScheduled
	if err := ctx.db.First(&reloadedSchedule, schedule.ID).Error; err != nil {
		t.Fatalf("reload original schedule: %v", err)
	}
	if reloadedSchedule.TriggeredAt != nil {
		t.Fatal("expected failed schedule to remain pending")
	}

	var scheduleCount int64
	if err := ctx.db.Model(&models.ContactReminderScheduled{}).
		Where("contact_reminder_id = ?", reminder.ID).
		Count(&scheduleCount).Error; err != nil {
		t.Fatalf("count schedules: %v", err)
	}
	if scheduleCount != 1 {
		t.Fatalf("expected no next recurring schedule after failure, got %d schedules", scheduleCount)
	}

	var reloadedChannel models.UserNotificationChannel
	if err := ctx.db.First(&reloadedChannel, channel.ID).Error; err != nil {
		t.Fatalf("reload channel: %v", err)
	}
	if reloadedChannel.Fails != 1 {
		t.Fatalf("expected failure count 1, got %d", reloadedChannel.Fails)
	}

	var reloadedReminder models.ContactReminder
	if err := ctx.db.First(&reloadedReminder, reminder.ID).Error; err != nil {
		t.Fatalf("reload reminder: %v", err)
	}
	if reloadedReminder.NumberTimesTriggered != 0 {
		t.Fatalf("expected failed delivery not to advance reminder, got %d", reloadedReminder.NumberTimesTriggered)
	}
}

func TestReminderScheduler_advancesRecurringScheduleExactlyOnce_whenRetrySucceeds(t *testing.T) {
	// Given
	ctx := setupReminderSchedulerTest(t)
	ctx.mailer.sendErr = errors.New("temporary SMTP failure")
	channel := ctx.createEmailChannel(t)
	reminder := ctx.createReminder(t, "recurring_week", freqPtr(1))
	schedule := ctx.createScheduled(t, reminder.ID, channel.ID, time.Now().Add(-time.Hour), nil)
	ctx.svc.ProcessDueReminders()
	ctx.mailer.sendErr = nil

	// When
	ctx.svc.ProcessDueReminders()

	// Then
	if len(ctx.mailer.calls) != 2 {
		t.Fatalf("expected failed attempt and successful retry, got %d sends", len(ctx.mailer.calls))
	}

	var originalSchedule models.ContactReminderScheduled
	if err := ctx.db.First(&originalSchedule, schedule.ID).Error; err != nil {
		t.Fatalf("reload original schedule: %v", err)
	}
	if originalSchedule.TriggeredAt == nil {
		t.Fatal("expected successful retry to mark original schedule triggered")
	}

	var pendingCount int64
	if err := ctx.db.Model(&models.ContactReminderScheduled{}).
		Where("contact_reminder_id = ? AND triggered_at IS NULL", reminder.ID).
		Count(&pendingCount).Error; err != nil {
		t.Fatalf("count pending schedules: %v", err)
	}
	if pendingCount != 1 {
		t.Fatalf("expected exactly one next recurring schedule, got %d", pendingCount)
	}

	var reloadedChannel models.UserNotificationChannel
	if err := ctx.db.First(&reloadedChannel, channel.ID).Error; err != nil {
		t.Fatalf("reload channel: %v", err)
	}
	if reloadedChannel.Fails != 0 {
		t.Fatalf("expected success to reset failures, got %d", reloadedChannel.Fails)
	}
}

func TestReminderScheduler_advancesMultipleChannelsIndependently_afterMixedDeliveryResults(t *testing.T) {
	// Given
	ctx := setupReminderSchedulerTest(t)
	emailChannel := ctx.createEmailChannel(t)
	failingSender := &recordingNotificationSender{sendErr: errors.New("webhook unavailable")}
	ctx.svc = NewReminderSchedulerService(ctx.db, ctx.mailer, failingSender)
	webhookChannel := models.UserNotificationChannel{
		UserID:  &ctx.userID,
		Type:    "webhook",
		Content: "https://example.test/reminders",
	}
	if err := ctx.db.Create(&webhookChannel).Error; err != nil {
		t.Fatalf("create webhook channel: %v", err)
	}
	if err := ctx.db.Model(&webhookChannel).Update("active", true).Error; err != nil {
		t.Fatalf("activate webhook channel: %v", err)
	}
	reminder := ctx.createReminder(t, "recurring_week", freqPtr(1))
	emailSchedule := ctx.createScheduled(t, reminder.ID, emailChannel.ID, time.Now().Add(-time.Hour), nil)
	webhookSchedule := ctx.createScheduled(t, reminder.ID, webhookChannel.ID, time.Now().Add(-time.Hour), nil)

	// When
	ctx.svc.ProcessDueReminders()

	// Then
	if len(ctx.mailer.calls) != 1 {
		t.Fatalf("expected one successful email send, got %d", len(ctx.mailer.calls))
	}
	if len(failingSender.calls) != 1 {
		t.Fatalf("expected one failed webhook send, got %d", len(failingSender.calls))
	}

	var deliveredSchedule models.ContactReminderScheduled
	if err := ctx.db.First(&deliveredSchedule, emailSchedule.ID).Error; err != nil {
		t.Fatalf("reload email schedule: %v", err)
	}
	if deliveredSchedule.TriggeredAt == nil {
		t.Fatal("expected successful email schedule to be triggered")
	}

	var failedSchedule models.ContactReminderScheduled
	if err := ctx.db.First(&failedSchedule, webhookSchedule.ID).Error; err != nil {
		t.Fatalf("reload webhook schedule: %v", err)
	}
	if failedSchedule.TriggeredAt != nil {
		t.Fatal("expected failed webhook schedule to remain pending")
	}

	var emailScheduleCount int64
	if err := ctx.db.Model(&models.ContactReminderScheduled{}).
		Where("user_notification_channel_id = ?", emailChannel.ID).
		Count(&emailScheduleCount).Error; err != nil {
		t.Fatalf("count email schedules: %v", err)
	}
	if emailScheduleCount != 2 {
		t.Fatalf("expected email channel to advance once, got %d schedules", emailScheduleCount)
	}

	var webhookScheduleCount int64
	if err := ctx.db.Model(&models.ContactReminderScheduled{}).
		Where("user_notification_channel_id = ?", webhookChannel.ID).
		Count(&webhookScheduleCount).Error; err != nil {
		t.Fatalf("count webhook schedules: %v", err)
	}
	if webhookScheduleCount != 1 {
		t.Fatalf("expected failed webhook channel not to advance, got %d schedules", webhookScheduleCount)
	}
}
