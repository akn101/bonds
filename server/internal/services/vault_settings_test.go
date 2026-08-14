package services

import (
	"testing"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/testutil"
)

func setupVaultSettingsTest(t *testing.T) (*VaultSettingsService, string) {
	t.Helper()
	db := testutil.SetupTestDB(t)
	authSvc := NewAuthService(db, testutil.TestJWTConfig())
	vaultSvc := NewVaultService(db)

	registered, err := authSvc.Register(dto.RegisterRequest{
		FirstName: "Test",
		LastName:  "User",
		Email:     "vault-settings-test@example.com",
		Password:  "password123",
	}, "en")
	if err != nil {
		t.Fatalf("Register failed: %v", err)
	}
	vault, err := vaultSvc.CreateVault(registered.User.AccountID, registered.User.ID, dto.CreateVaultRequest{
		Name: "Test Vault", Description: "desc",
	}, "en")
	if err != nil {
		t.Fatalf("CreateVault failed: %v", err)
	}
	return NewVaultSettingsService(db), vault.ID
}

func TestVaultSettingsGetContainsOnlyVaultConfiguration(t *testing.T) {
	svc, vaultID := setupVaultSettingsTest(t)
	settings, err := svc.Get(vaultID)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if settings.Name != "Test Vault" || !settings.ShowGroupTab {
		t.Fatalf("unexpected vault settings: %+v", settings)
	}
	if settings.DefaultTemplateID == nil {
		t.Fatal("vault must have a default contact layout")
	}
}

func TestVaultSettingsUpdate(t *testing.T) {
	svc, vaultID := setupVaultSettingsTest(t)
	settings, err := svc.Update(vaultID, dto.UpdateVaultSettingsRequest{Name: "Updated", Description: "new desc"})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if settings.Name != "Updated" || settings.Description != "new desc" {
		t.Fatalf("unexpected updated settings: %+v", settings)
	}
}

func TestVaultSettingsUpdateVisibility(t *testing.T) {
	svc, vaultID := setupVaultSettingsTest(t)
	hidden := false
	settings, err := svc.UpdateVisibility(vaultID, dto.UpdateTabVisibilityRequest{ShowGroupTab: &hidden})
	if err != nil {
		t.Fatalf("UpdateVisibility failed: %v", err)
	}
	if settings.ShowGroupTab || !settings.ShowTasksTab {
		t.Fatalf("unexpected visibility settings: %+v", settings)
	}
}

func TestVaultSettingsNotFound(t *testing.T) {
	svc, _ := setupVaultSettingsTest(t)
	if _, err := svc.Get("nonexistent"); err != ErrVaultNotFound {
		t.Fatalf("expected ErrVaultNotFound, got %v", err)
	}
}
