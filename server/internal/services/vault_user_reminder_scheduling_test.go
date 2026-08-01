package services

import (
	"testing"
	"time"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
)

type vaultUserReminderSchedulingContext struct {
	service   *VaultUsersService
	userID    string
	userEmail string
	vaultID   string
	ownerID   string
	contactID string
	channelID uint
	location  *time.Location
}

func setupVaultUserReminderSchedulingTest(t *testing.T) vaultUserReminderSchedulingContext {
	t.Helper()
	service, authService, vaultID, ownerID, accountID := setupVaultUsersTest(t)
	contact, err := NewContactService(service.db).CreateContact(vaultID, ownerID, dto.CreateContactRequest{FirstName: "Reminder contact"})
	if err != nil {
		t.Fatalf("create contact: %v", err)
	}
	if err := service.db.Model(&models.UserNotificationChannel{}).Where("user_id = ?", ownerID).Update("active", false).Error; err != nil {
		t.Fatalf("deactivate owner channels: %v", err)
	}
	userEmail := "vault-user-reminder-member@example.com"
	registerSameAccountUser(t, authService, accountID, userEmail)
	var user models.User
	if err := service.db.Where("email = ?", userEmail).First(&user).Error; err != nil {
		t.Fatalf("load added user: %v", err)
	}
	if err := service.db.Model(&models.UserNotificationChannel{}).Where("user_id = ?", user.ID).Update("active", false).Error; err != nil {
		t.Fatalf("deactivate added user channels: %v", err)
	}
	location, err := time.LoadLocation("Asia/Tokyo")
	if err != nil {
		t.Fatalf("load Asia/Tokyo: %v", err)
	}
	timezone := location.String()
	if err := service.db.Model(&models.User{}).Where("id = ?", user.ID).Update("timezone", timezone).Error; err != nil {
		t.Fatalf("set added user timezone: %v", err)
	}
	preferredTime := "07:30"
	channel := models.UserNotificationChannel{
		UserID:        &user.ID,
		Type:          "shoutrrr",
		Content:       "ntfy://vault-user-reminder",
		PreferredTime: &preferredTime,
		Active:        true,
	}
	if err := service.db.Create(&channel).Error; err != nil {
		t.Fatalf("create active channel: %v", err)
	}
	return vaultUserReminderSchedulingContext{
		service:   service,
		userID:    user.ID,
		userEmail: userEmail,
		vaultID:   vaultID,
		ownerID:   ownerID,
		contactID: contact.ID,
		channelID: channel.ID,
		location:  location,
	}
}

func (ctx vaultUserReminderSchedulingContext) createReminder(t *testing.T, request dto.CreateReminderRequest) *dto.ReminderResponse {
	t.Helper()
	reminder, err := NewReminderService(ctx.service.db).Create(ctx.contactID, ctx.vaultID, request)
	if err != nil {
		t.Fatalf("create reminder: %v", err)
	}
	return reminder
}

func TestVaultUsersService_Add_schedulesOnlyFutureAllVaultUsersRemindersAtChannelPreference(t *testing.T) {
	// Given
	ctx := setupVaultUserReminderSchedulingTest(t)
	nextYear := time.Now().In(ctx.location).Year() + 1
	futureDay, futureMonth := 1, int(time.January)
	futureAllReminder := ctx.createReminder(t, dto.CreateReminderRequest{
		Label: "Future all-vault-users", Day: &futureDay, Month: &futureMonth, Year: &nextYear, Type: "one_time", Audience: models.ReminderAudienceAllVaultUsers,
	})
	selectedOwnerReminder := ctx.createReminder(t, dto.CreateReminderRequest{
		Label: "Selected owner", Day: &futureDay, Month: &futureMonth, Year: &nextYear, Type: "one_time", Audience: models.ReminderAudienceSelectedUsers, SelectedUserIDs: []string{ctx.ownerID},
	})
	emptySelectedReminder := ctx.createReminder(t, dto.CreateReminderRequest{
		Label: "Empty selected", Day: &futureDay, Month: &futureMonth, Year: &nextYear, Type: "one_time", Audience: models.ReminderAudienceSelectedUsers, SelectedUserIDs: []string{},
	})
	pastDate := time.Now().In(ctx.location).AddDate(0, 0, -1)
	pastDay, pastMonth, pastYear := pastDate.Day(), int(pastDate.Month()), pastDate.Year()
	dueAllReminder := ctx.createReminder(t, dto.CreateReminderRequest{
		Label: "Already due all-vault-users", Day: &pastDay, Month: &pastMonth, Year: &pastYear, Type: "one_time", Audience: models.ReminderAudienceAllVaultUsers,
	})

	// When
	if _, err := ctx.service.Add(ctx.vaultID, dto.AddVaultUserRequest{Email: ctx.userEmail, Permission: models.PermissionEditor}); err != nil {
		t.Fatalf("add vault member: %v", err)
	}

	// Then
	var schedules []models.ContactReminderScheduled
	if err := ctx.service.db.Where("user_notification_channel_id = ? AND triggered_at IS NULL", ctx.channelID).Find(&schedules).Error; err != nil {
		t.Fatalf("load added member schedules: %v", err)
	}
	if len(schedules) != 1 || schedules[0].ContactReminderID != futureAllReminder.ID {
		t.Fatalf("scheduled reminders = %#v, want only future all-vault-users reminder %d", schedules, futureAllReminder.ID)
	}
	scheduledAt := schedules[0].ScheduledAt.In(ctx.location)
	if scheduledAt.Hour() != 7 || scheduledAt.Minute() != 30 {
		t.Fatalf("scheduled time = %s, want 07:30 in %s", scheduledAt.Format(time.RFC3339), ctx.location)
	}
	for _, reminderID := range []uint{selectedOwnerReminder.ID, emptySelectedReminder.ID, dueAllReminder.ID} {
		var count int64
		if err := ctx.service.db.Model(&models.ContactReminderScheduled{}).
			Where("user_notification_channel_id = ? AND contact_reminder_id = ?", ctx.channelID, reminderID).
			Count(&count).Error; err != nil {
			t.Fatalf("count excluded reminder %d schedules: %v", reminderID, err)
		}
		if count != 0 {
			t.Fatalf("reminder %d schedules = %d, want 0", reminderID, count)
		}
	}
}

func TestVaultUsersService_Add_doesNotDuplicateExistingPendingSchedule(t *testing.T) {
	// Given
	ctx := setupVaultUserReminderSchedulingTest(t)
	nextYear := time.Now().In(ctx.location).Year() + 1
	day, month := 1, int(time.January)
	reminder := ctx.createReminder(t, dto.CreateReminderRequest{
		Label: "Future all-vault-users", Day: &day, Month: &month, Year: &nextYear, Type: "one_time", Audience: models.ReminderAudienceAllVaultUsers,
	})
	if err := ctx.service.db.Create(&models.ContactReminderScheduled{
		UserNotificationChannelID: ctx.channelID,
		ContactReminderID:         reminder.ID,
		ScheduledAt:               time.Now().AddDate(1, 0, 0),
	}).Error; err != nil {
		t.Fatalf("create existing pending schedule: %v", err)
	}

	// When
	if _, err := ctx.service.Add(ctx.vaultID, dto.AddVaultUserRequest{Email: ctx.userEmail, Permission: models.PermissionEditor}); err != nil {
		t.Fatalf("add vault member: %v", err)
	}

	// Then
	var count int64
	if err := ctx.service.db.Model(&models.ContactReminderScheduled{}).
		Where("user_notification_channel_id = ? AND contact_reminder_id = ? AND triggered_at IS NULL", ctx.channelID, reminder.ID).
		Count(&count).Error; err != nil {
		t.Fatalf("count pending schedules: %v", err)
	}
	if count != 1 {
		t.Fatalf("pending schedules = %d, want 1", count)
	}
}

func TestVaultUsersService_Add_rollsBackMembershipWhenReminderSchedulingFails(t *testing.T) {
	// Given
	ctx := setupVaultUserReminderSchedulingTest(t)
	nextYear := time.Now().In(ctx.location).Year() + 1
	day, month := 1, int(time.January)
	ctx.createReminder(t, dto.CreateReminderRequest{
		Label: "Future all-vault-users", Day: &day, Month: &month, Year: &nextYear, Type: "one_time", Audience: models.ReminderAudienceAllVaultUsers,
	})
	if err := ctx.service.db.Exec(`CREATE TRIGGER fail_new_member_reminder_schedule BEFORE INSERT ON contact_reminder_scheduled BEGIN SELECT RAISE(ABORT, 'forced reminder scheduling failure'); END`).Error; err != nil {
		t.Fatalf("create schedule failure trigger: %v", err)
	}

	// When
	_, err := ctx.service.Add(ctx.vaultID, dto.AddVaultUserRequest{Email: ctx.userEmail, Permission: models.PermissionEditor})

	// Then
	if err == nil {
		t.Fatal("add vault member succeeded despite reminder schedule failure")
	}
	var membershipCount int64
	if err := ctx.service.db.Model(&models.UserVault{}).
		Where("vault_id = ? AND user_id = ?", ctx.vaultID, ctx.userID).
		Count(&membershipCount).Error; err != nil {
		t.Fatalf("count memberships: %v", err)
	}
	if membershipCount != 0 {
		t.Fatalf("memberships = %d, want rollback to 0 after scheduling error: %v", membershipCount, err)
	}
}
