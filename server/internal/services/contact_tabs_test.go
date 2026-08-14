package services

import (
	"errors"
	"testing"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/testutil"
	"gorm.io/gorm"
)

type contactTabsTestContext struct {
	db        *gorm.DB
	service   *ContactTabService
	contactID string
	vaultID   string
	userID    string
}

func setupContactTabsTest(t *testing.T) *contactTabsTestContext {
	t.Helper()
	db := testutil.SetupTestDB(t)
	authSvc := NewAuthService(db, testutil.TestJWTConfig())
	registered, err := authSvc.Register(dto.RegisterRequest{
		FirstName: "Test", LastName: "User", Email: "tabs-test@example.com", Password: "password123",
	}, "en")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	vault, err := NewVaultService(db).CreateVault(registered.User.AccountID, registered.User.ID, dto.CreateVaultRequest{Name: "Test Vault"}, "en")
	if err != nil {
		t.Fatalf("create vault: %v", err)
	}
	contact, err := NewContactService(db).CreateContact(vault.ID, registered.User.ID, dto.CreateContactRequest{FirstName: "John"})
	if err != nil {
		t.Fatalf("create contact: %v", err)
	}
	return &contactTabsTestContext{db: db, service: NewContactTabService(db), contactID: contact.ID, vaultID: vault.ID, userID: registered.User.ID}
}

func TestGetTabsUsesVaultDefaultLayout(t *testing.T) {
	ctx := setupContactTabsTest(t)
	tabs, err := ctx.service.GetTabs(ctx.contactID, ctx.vaultID, "en")
	if err != nil {
		t.Fatalf("GetTabs: %v", err)
	}
	if tabs.TemplateName != "Default template" || len(tabs.Pages) != 8 {
		t.Fatalf("unexpected default tabs: %+v", tabs)
	}
	expected := map[string][]string{
		"summary":              {"contact_summary"},
		"contact":              {"important_dates", "labels", "quick_facts", "extra_information", "addresses", "contact_information"},
		"feed":                 {"feed"},
		"social":               {"relationships", "pets", "groups"},
		"relationship-network": {"relationship_network"},
		"activities":           {"activities"},
		"goals":                {"goals"},
		"information":          {"documents", "photos", "notes", "reminders", "loans", "gifts", "tasks", "calls"},
	}
	seenModules := map[string]int{}
	for pageIndex, page := range tabs.Pages {
		if page.Position != pageIndex {
			t.Fatalf("page %s position = %d, want %d", page.Slug, page.Position, pageIndex)
		}
		want := expected[page.Slug]
		if len(page.Modules) != len(want) {
			t.Fatalf("page %s modules = %+v, want %v", page.Slug, page.Modules, want)
		}
		for moduleIndex, module := range page.Modules {
			if module.Type != want[moduleIndex] || module.Position != moduleIndex {
				t.Fatalf("page %s module %d = %+v, want %s at %d", page.Slug, moduleIndex, module, want[moduleIndex], moduleIndex)
			}
			seenModules[module.Type]++
		}
	}
	for module, count := range seenModules {
		if count != 1 {
			t.Fatalf("module %s appears %d times", module, count)
		}
	}
}

func TestGetTabsUsesContactSelectedVaultTemplate(t *testing.T) {
	ctx := setupContactTabsTest(t)
	layoutSvc := NewContactLayoutService(ctx.db)
	items, err := layoutSvc.List(ctx.vaultID, "en")
	if err != nil || len(items) != 1 {
		t.Fatalf("list layouts: %v, %+v", err, items)
	}
	custom, err := layoutSvc.Create(ctx.vaultID, "en", dto.CreateContactLayoutTemplateRequest{Name: "Compact", SourceTemplateID: &items[0].ID})
	if err != nil {
		t.Fatalf("create custom layout: %v", err)
	}
	if _, err := NewContactTemplateService(ctx.db).UpdateTemplate(ctx.contactID, ctx.vaultID, ctx.userID, dto.UpdateContactTemplateRequest{TemplateID: &custom.ID}); err != nil {
		t.Fatalf("select contact template: %v", err)
	}
	tabs, err := ctx.service.GetTabs(ctx.contactID, ctx.vaultID, "en")
	if err != nil {
		t.Fatalf("GetTabs: %v", err)
	}
	if tabs.TemplateID != custom.ID || tabs.TemplateName != "Compact" {
		t.Fatalf("selected template not used: %+v", tabs)
	}
}

func TestGetTabsHidesPageAndAllOfItsModules(t *testing.T) {
	ctx := setupContactTabsTest(t)
	var vault models.Vault
	if err := ctx.db.First(&vault, "id = ?", ctx.vaultID).Error; err != nil {
		t.Fatalf("load vault: %v", err)
	}
	if err := ctx.db.Model(&models.VaultContactTemplatePage{}).
		Where("template_id = ? AND slug = ?", *vault.DefaultTemplateID, "relationship-network").
		Update("visible", false).Error; err != nil {
		t.Fatalf("hide network page: %v", err)
	}
	tabs, err := ctx.service.GetTabs(ctx.contactID, ctx.vaultID, "en")
	if err != nil {
		t.Fatalf("GetTabs: %v", err)
	}
	for _, page := range tabs.Pages {
		if page.Slug == "relationship-network" {
			t.Fatal("hidden network page was returned")
		}
		for _, module := range page.Modules {
			if module.Type == "relationship_network" {
				t.Fatal("module from hidden network page was returned")
			}
		}
	}
}

func TestGetTabsReturnsDomainErrors(t *testing.T) {
	ctx := setupContactTabsTest(t)
	if _, err := ctx.service.GetTabs("missing", ctx.vaultID, "en"); !errors.Is(err, ErrContactNotFound) {
		t.Fatalf("missing contact returned %v", err)
	}
	if err := ctx.db.Model(&models.Vault{}).Where("id = ?", ctx.vaultID).Update("default_template_id", nil).Error; err != nil {
		t.Fatalf("clear default template: %v", err)
	}
	if _, err := ctx.service.GetTabs(ctx.contactID, ctx.vaultID, "en"); !errors.Is(err, ErrContactLayoutNotFound) {
		t.Fatalf("missing layout returned %v", err)
	}
}
