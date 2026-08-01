package services

import (
	"encoding/json"
	"testing"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/testutil"
	"gorm.io/gorm"
)

type reminderAudienceTestContext struct {
	db        *gorm.DB
	service   *ReminderService
	contactID string
	vaultID   string
	ownerID   string
	accountID string
}

type reminderAudienceResponse struct {
	Audience        string   `json:"audience"`
	SelectedUserIDs []string `json:"selected_user_ids"`
}

func setupReminderAudienceTest(t *testing.T) reminderAudienceTestContext {
	t.Helper()
	db := testutil.SetupTestDB(t)
	authService := NewAuthService(db, testutil.TestJWTConfig())
	vaultService := NewVaultService(db)
	registration, err := authService.Register(dto.RegisterRequest{
		FirstName: "Reminder",
		LastName:  "Owner",
		Email:     "reminder-audience-owner@example.com",
		Password:  "password123",
	}, "en")
	if err != nil {
		t.Fatalf("register owner: %v", err)
	}
	vault, err := vaultService.CreateVault(registration.User.AccountID, registration.User.ID, dto.CreateVaultRequest{Name: "Reminder Audience"}, "en")
	if err != nil {
		t.Fatalf("create vault: %v", err)
	}
	contact, err := NewContactService(db).CreateContact(vault.ID, registration.User.ID, dto.CreateContactRequest{FirstName: "Contact"})
	if err != nil {
		t.Fatalf("create contact: %v", err)
	}
	if err := db.Model(&models.UserNotificationChannel{}).Where("user_id = ?", registration.User.ID).Update("active", false).Error; err != nil {
		t.Fatalf("deactivate seeded owner channels: %v", err)
	}
	return reminderAudienceTestContext{
		db:        db,
		service:   NewReminderService(db),
		contactID: contact.ID,
		vaultID:   vault.ID,
		ownerID:   registration.User.ID,
		accountID: registration.User.AccountID,
	}
}

func (ctx reminderAudienceTestContext) createVaultMember(t *testing.T, email string) string {
	t.Helper()
	user := models.User{AccountID: ctx.accountID, Email: email}
	if err := ctx.db.Create(&user).Error; err != nil {
		t.Fatalf("create vault member: %v", err)
	}
	if err := ctx.db.Create(&models.UserVault{
		VaultID:    ctx.vaultID,
		UserID:     user.ID,
		ContactID:  "member-shadow-contact",
		Permission: models.PermissionEditor,
	}).Error; err != nil {
		t.Fatalf("link vault member: %v", err)
	}
	return user.ID
}

func (ctx reminderAudienceTestContext) createActiveChannel(t *testing.T, userID string) models.UserNotificationChannel {
	t.Helper()
	channel := models.UserNotificationChannel{
		UserID:  &userID,
		Type:    "shoutrrr",
		Content: "ntfy://reminder-audience",
		Active:  true,
	}
	if err := ctx.db.Create(&channel).Error; err != nil {
		t.Fatalf("create active channel: %v", err)
	}
	return channel
}

func createReminderAudienceRequest(t *testing.T, audience string, selectedUserIDs []string) dto.CreateReminderRequest {
	t.Helper()
	payload, err := json.Marshal(struct {
		Label           string   `json:"label"`
		Day             int      `json:"day"`
		Month           int      `json:"month"`
		Type            string   `json:"type"`
		Audience        string   `json:"audience"`
		SelectedUserIDs []string `json:"selected_user_ids"`
	}{
		Label:           "Audience reminder",
		Day:             1,
		Month:           1,
		Type:            "one_time",
		Audience:        audience,
		SelectedUserIDs: selectedUserIDs,
	})
	if err != nil {
		t.Fatalf("marshal reminder request: %v", err)
	}
	var request dto.CreateReminderRequest
	if err := json.Unmarshal(payload, &request); err != nil {
		t.Fatalf("unmarshal reminder request: %v", err)
	}
	return request
}

func updateReminderAudienceRequest(t *testing.T, audience string, selectedUserIDs []string) dto.UpdateReminderRequest {
	t.Helper()
	payload, err := json.Marshal(struct {
		Label           string   `json:"label"`
		Day             int      `json:"day"`
		Month           int      `json:"month"`
		Type            string   `json:"type"`
		Audience        string   `json:"audience"`
		SelectedUserIDs []string `json:"selected_user_ids"`
	}{
		Label:           "Updated audience reminder",
		Day:             2,
		Month:           2,
		Type:            "one_time",
		Audience:        audience,
		SelectedUserIDs: selectedUserIDs,
	})
	if err != nil {
		t.Fatalf("marshal update reminder request: %v", err)
	}
	var request dto.UpdateReminderRequest
	if err := json.Unmarshal(payload, &request); err != nil {
		t.Fatalf("unmarshal update reminder request: %v", err)
	}
	return request
}

func decodeReminderAudienceResponse(t *testing.T, response interface{}) reminderAudienceResponse {
	t.Helper()
	payload, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("marshal reminder response: %v", err)
	}
	var audienceResponse reminderAudienceResponse
	if err := json.Unmarshal(payload, &audienceResponse); err != nil {
		t.Fatalf("unmarshal reminder response: %v", err)
	}
	return audienceResponse
}
