package services

import (
	"testing"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/testutil"
)

func setupContactTabsTest(t *testing.T) (*ContactTabService, string, string, string) {
	t.Helper()
	db := testutil.SetupTestDB(t)
	cfg := testutil.TestJWTConfig()
	authSvc := NewAuthService(db, cfg)
	vaultSvc := NewVaultService(db)

	resp, err := authSvc.Register(dto.RegisterRequest{
		FirstName: "Test",
		LastName:  "User",
		Email:     "tabs-test@example.com",
		Password:  "password123",
	}, "en")
	if err != nil {
		t.Fatalf("Register failed: %v", err)
	}

	vault, err := vaultSvc.CreateVault(resp.User.AccountID, resp.User.ID, dto.CreateVaultRequest{Name: "Test Vault"}, "en")
	if err != nil {
		t.Fatalf("CreateVault failed: %v", err)
	}

	contactSvc := NewContactService(db)
	contact, err := contactSvc.CreateContact(vault.ID, resp.User.ID, dto.CreateContactRequest{FirstName: "John"})
	if err != nil {
		t.Fatalf("CreateContact failed: %v", err)
	}

	return NewContactTabService(db), contact.ID, vault.ID, resp.User.AccountID
}

func TestGetTabs_WithTemplate(t *testing.T) {
	svc, contactID, vaultID, accountID := setupContactTabsTest(t)

	var tmpl models.Template
	svc.db.Where("account_id = ? AND can_be_deleted = ?", accountID, false).First(&tmpl)

	svc.db.Model(&models.Contact{}).Where("id = ?", contactID).Update("template_id", tmpl.ID)

	tabs, err := svc.GetTabs(contactID, vaultID)
	if err != nil {
		t.Fatalf("GetTabs failed: %v", err)
	}

	if tabs.TemplateID != tmpl.ID {
		t.Errorf("Expected template ID %d, got %d", tmpl.ID, tabs.TemplateID)
	}
	if tabs.TemplateName != "Default template" {
		t.Errorf("Expected template name 'Default template', got '%s'", tabs.TemplateName)
	}
	if len(tabs.Pages) != 8 {
		t.Fatalf("Expected 8 pages, got %d", len(tabs.Pages))
	}

	summaryPage := tabs.Pages[0]
	if summaryPage.Slug != "summary" || len(summaryPage.Modules) != 1 || summaryPage.Modules[0].Type != "contact_summary" {
		t.Fatalf("unexpected summary page: %+v", summaryPage)
	}

	contactPage := tabs.Pages[1]
	if contactPage.Slug != "contact" {
		t.Errorf("Expected first page slug 'contact', got '%s'", contactPage.Slug)
	}
	// 11 modules: avatar, contact_names, family_summary, important_dates, gender_pronoun,
	// labels, quick_facts, company, religions, addresses, contact_information
	if len(contactPage.Modules) != 11 {
		t.Errorf("Expected 11 modules on contact page, got %d", len(contactPage.Modules))
	}

	feedPage := tabs.Pages[2]
	if feedPage.Slug != "feed" {
		t.Errorf("Expected second page slug 'feed', got '%s'", feedPage.Slug)
	}
	if len(feedPage.Modules) != 1 {
		t.Errorf("Expected 1 module on feed page, got %d", len(feedPage.Modules))
	}

	socialPage := tabs.Pages[3]
	if socialPage.Slug != "social" {
		t.Errorf("Expected third page slug 'social', got '%s'", socialPage.Slug)
	}
	if len(socialPage.Modules) != 3 {
		t.Errorf("Expected 3 modules on social page, got %d", len(socialPage.Modules))
	}

	networkPage := tabs.Pages[4]
	if networkPage.Slug != "relationship-network" || len(networkPage.Modules) != 1 || networkPage.Modules[0].Type != "relationship_network" {
		t.Fatalf("unexpected relationship network page: %+v", networkPage)
	}

	activitiesPage := tabs.Pages[5]
	if activitiesPage.Slug != "activities" {
		t.Errorf("Expected activities page slug 'activities', got '%s'", activitiesPage.Slug)
	}
	if len(activitiesPage.Modules) != 1 || activitiesPage.Modules[0].Type != "activities" {
		t.Errorf("unexpected activities page modules: %+v", activitiesPage.Modules)
	}

	goalsPage := tabs.Pages[6]
	if goalsPage.Slug != "goals" {
		t.Errorf("Expected goals page slug 'goals', got '%s'", goalsPage.Slug)
	}
	if len(goalsPage.Modules) != 1 || goalsPage.Modules[0].Type != "goals" {
		t.Errorf("unexpected goals page modules: %+v", goalsPage.Modules)
	}

	infoPage := tabs.Pages[7]
	if infoPage.Slug != "information" {
		t.Errorf("Expected fifth page slug 'information', got '%s'", infoPage.Slug)
	}
	expectedInformationTypes := []string{"documents", "photos", "notes", "reminders", "loans", "gifts", "tasks", "calls", "posts"}
	if len(infoPage.Modules) != len(expectedInformationTypes) {
		t.Fatalf("Expected %d modules on information page, got %d", len(expectedInformationTypes), len(infoPage.Modules))
	}
	for i, mod := range infoPage.Modules {
		if mod.Type != expectedInformationTypes[i] {
			t.Errorf("Information module %d: expected type '%s', got '%s'", i, expectedInformationTypes[i], mod.Type)
		}
		if mod.Position != i+1 {
			t.Errorf("Information module %d: expected position %d, got %d", i, i+1, mod.Position)
		}
	}
}

func TestGetTabs_WithoutTemplate(t *testing.T) {
	svc, contactID, vaultID, _ := setupContactTabsTest(t)

	tabs, err := svc.GetTabs(contactID, vaultID)
	if err != nil {
		t.Fatalf("GetTabs failed: %v", err)
	}

	if tabs.TemplateName != "Default template" {
		t.Errorf("Expected fallback to 'Default template', got '%s'", tabs.TemplateName)
	}
	if len(tabs.Pages) != 8 {
		t.Fatalf("Expected 8 pages, got %d", len(tabs.Pages))
	}
}

func TestGetTabs_ContactNotFound(t *testing.T) {
	svc, _, vaultID, _ := setupContactTabsTest(t)

	_, err := svc.GetTabs("nonexistent-id", vaultID)
	if err != ErrContactNotFound {
		t.Errorf("Expected ErrContactNotFound, got %v", err)
	}
}

func TestGetTabs_ModuleOrdering(t *testing.T) {
	svc, contactID, vaultID, _ := setupContactTabsTest(t)

	tabs, err := svc.GetTabs(contactID, vaultID)
	if err != nil {
		t.Fatalf("GetTabs failed: %v", err)
	}

	contactPage := tabs.Pages[1]
	for i, mod := range contactPage.Modules {
		expectedPos := i + 1
		if mod.Position != expectedPos {
			t.Errorf("Module %d: expected position %d, got %d", i, expectedPos, mod.Position)
		}
	}

	expectedTypes := []string{"avatar", "contact_names", "family_summary", "important_dates", "gender_pronoun", "labels", "quick_facts", "company", "religions", "addresses", "contact_information"}
	for i, mod := range contactPage.Modules {
		if mod.Type != expectedTypes[i] {
			t.Errorf("Module %d: expected type '%s', got '%s'", i, expectedTypes[i], mod.Type)
		}
	}
}

func TestGetTabs_HidesInvisiblePages(t *testing.T) {
	svc, contactID, vaultID, accountID := setupContactTabsTest(t)

	var page models.TemplatePage
	if err := svc.db.Joins("JOIN templates ON templates.id = template_pages.template_id").
		Where("templates.account_id = ? AND template_pages.slug = ?", accountID, "relationship-network").
		First(&page).Error; err != nil {
		t.Fatalf("find relationship network page: %v", err)
	}
	if err := svc.db.Model(&page).Update("visible", false).Error; err != nil {
		t.Fatalf("hide page: %v", err)
	}

	tabs, err := svc.GetTabs(contactID, vaultID)
	if err != nil {
		t.Fatalf("GetTabs failed: %v", err)
	}
	if len(tabs.Pages) != 7 {
		t.Fatalf("Expected 7 visible pages, got %d", len(tabs.Pages))
	}
	for _, visiblePage := range tabs.Pages {
		if visiblePage.Slug == "relationship-network" {
			t.Fatal("hidden relationship network page was returned")
		}
	}
}
