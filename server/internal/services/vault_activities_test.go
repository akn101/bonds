package services

import (
	"testing"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/testutil"
)

func setupVaultActivityTest(t *testing.T) (*VaultActivityService, string) {
	t.Helper()
	db := testutil.SetupTestDB(t)
	cfg := testutil.TestJWTConfig()
	authSvc := NewAuthService(db, cfg)
	vaultSvc := NewVaultService(db)

	resp, err := authSvc.Register(dto.RegisterRequest{
		FirstName: "Test", LastName: "User",
		Email: "vault-lifeevent-test@example.com", Password: "password123",
	}, "en")
	if err != nil {
		t.Fatalf("Register failed: %v", err)
	}
	vault, err := vaultSvc.CreateVault(resp.User.AccountID, resp.User.ID, dto.CreateVaultRequest{Name: "V"}, "en")
	if err != nil {
		t.Fatalf("CreateVault failed: %v", err)
	}
	return NewVaultActivityService(db), vault.ID
}

func TestVaultActivityCategoryCRUD(t *testing.T) {
	svc, vaultID := setupVaultActivityTest(t)

	cats, err := svc.ListCategories(vaultID)
	if err != nil {
		t.Fatalf("ListCategories failed: %v", err)
	}
	seedCount := len(cats)

	pos := 10
	created, err := svc.CreateCategory(vaultID, dto.CreateActivityCategoryRequest{Label: "Travel", Position: &pos})
	if err != nil {
		t.Fatalf("CreateCategory failed: %v", err)
	}
	if created.Label != "Travel" {
		t.Errorf("Expected label 'Travel', got '%s'", created.Label)
	}

	pos2 := 20
	updated, err := svc.UpdateCategory(created.ID, vaultID, dto.UpdateActivityCategoryRequest{Label: "Adventures", Position: &pos2})
	if err != nil {
		t.Fatalf("UpdateCategory failed: %v", err)
	}
	if updated.Label != "Adventures" {
		t.Errorf("Expected label 'Adventures', got '%s'", updated.Label)
	}

	if err := svc.DeleteCategory(created.ID, vaultID); err != nil {
		t.Fatalf("DeleteCategory failed: %v", err)
	}

	cats, _ = svc.ListCategories(vaultID)
	if len(cats) != seedCount {
		t.Errorf("Expected %d categories after delete, got %d", seedCount, len(cats))
	}
}

func TestVaultActivityTypeCRUD(t *testing.T) {
	svc, vaultID := setupVaultActivityTest(t)

	cat, err := svc.CreateCategory(vaultID, dto.CreateActivityCategoryRequest{Label: "Cat1"})
	if err != nil {
		t.Fatalf("CreateCategory failed: %v", err)
	}

	lt, err := svc.CreateType(cat.ID, vaultID, dto.CreateActivityTypeRequest{Label: "Type1"})
	if err != nil {
		t.Fatalf("CreateType failed: %v", err)
	}
	if lt.Label != "Type1" {
		t.Errorf("Expected label 'Type1', got '%s'", lt.Label)
	}

	updated, err := svc.UpdateType(lt.ID, cat.ID, vaultID, dto.UpdateActivityTypeRequest{Label: "Type1 Updated"})
	if err != nil {
		t.Fatalf("UpdateType failed: %v", err)
	}
	if updated.Label != "Type1 Updated" {
		t.Errorf("Expected label 'Type1 Updated', got '%s'", updated.Label)
	}

	if err := svc.DeleteType(lt.ID, cat.ID, vaultID); err != nil {
		t.Fatalf("DeleteType failed: %v", err)
	}
}

func TestVaultActivityTypeDelete_allowsSeededDefault(t *testing.T) {
	svc, vaultID := setupVaultActivityTest(t)

	cats, err := svc.ListCategories(vaultID)
	if err != nil {
		t.Fatalf("ListCategories failed: %v", err)
	}
	if len(cats) == 0 || len(cats[0].Types) == 0 {
		t.Fatal("expected seeded activity category and type")
	}
	targetCategory := cats[0]
	targetType := targetCategory.Types[0]

	if err := svc.DeleteType(targetType.ID, targetCategory.ID, vaultID); err != nil {
		t.Fatalf("DeleteType on seeded default failed: %v", err)
	}

	reloadedCategories, err := svc.ListCategories(vaultID)
	if err != nil {
		t.Fatalf("ListCategories after delete failed: %v", err)
	}
	for _, category := range reloadedCategories {
		if category.ID != targetCategory.ID {
			continue
		}
		for _, activityType := range category.Types {
			if activityType.ID == targetType.ID {
				t.Fatalf("expected seeded type %d to be deleted", targetType.ID)
			}
		}
	}
}

func TestVaultActivityCategoryDelete_allowsSeededDefault(t *testing.T) {
	svc, vaultID := setupVaultActivityTest(t)

	cats, err := svc.ListCategories(vaultID)
	if err != nil {
		t.Fatalf("ListCategories failed: %v", err)
	}
	if len(cats) == 0 {
		t.Fatal("expected seeded activity categories")
	}
	targetCategory := cats[0]

	if err := svc.DeleteCategory(targetCategory.ID, vaultID); err != nil {
		t.Fatalf("DeleteCategory on seeded default failed: %v", err)
	}

	reloadedCategories, err := svc.ListCategories(vaultID)
	if err != nil {
		t.Fatalf("ListCategories after category delete failed: %v", err)
	}
	for _, category := range reloadedCategories {
		if category.ID == targetCategory.ID {
			t.Fatalf("expected seeded category %d to be deleted", targetCategory.ID)
		}
	}
}
