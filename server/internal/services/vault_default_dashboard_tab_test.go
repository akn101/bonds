package services

import (
	"testing"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/testutil"
)

func TestUpdateDefaultDashboardTab(t *testing.T) {
	db := testutil.SetupTestDB(t)
	cfg := testutil.TestJWTConfig()
	authSvc := NewAuthService(db, cfg)
	vaultSvc := NewVaultService(db)

	resp, err := authSvc.Register(dto.RegisterRequest{
		FirstName: "Test", LastName: "User",
		Email: "dt-test@example.com", Password: "password123",
	}, "en")
	if err != nil {
		t.Fatalf("Register failed: %v", err)
	}
	vault, err := vaultSvc.CreateVault(resp.User.AccountID, resp.User.ID, dto.CreateVaultRequest{Name: "Test Vault"}, "en")
	if err != nil {
		t.Fatalf("CreateVault failed: %v", err)
	}

	if err := vaultSvc.UpdateDefaultDashboardTab(vault.ID, "activities"); err != nil {
		t.Fatalf("UpdateDefaultDashboardTab failed: %v", err)
	}

	got, err := vaultSvc.GetVault(vault.ID, resp.User.ID)
	if err != nil {
		t.Fatalf("GetVault failed: %v", err)
	}
	if got == nil {
		t.Fatal("GetVault returned nil")
	}
	if got.DefaultDashboardTab != "activities" {
		t.Fatalf("DefaultDashboardTab = %q, want activities", got.DefaultDashboardTab)
	}
}

func TestUpdateDefaultDashboardTabNotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)
	vaultSvc := NewVaultService(db)

	err := vaultSvc.UpdateDefaultDashboardTab("nonexistent-id", "feed")
	if err != ErrVaultNotFound {
		t.Errorf("Expected ErrVaultNotFound, got %v", err)
	}
}
