package models

import (
	"testing"

	"gorm.io/gorm"
)

func setupContactTemplateLayoutBackfill(t *testing.T) (*gorm.DB, Template, Template) {
	t.Helper()
	db := setupGiftContactModuleBackfillDB(t)
	if err := db.AutoMigrate(&User{}); err != nil {
		t.Fatalf("migrate user: %v", err)
	}

	account := Account{ID: "account-contact-layout"}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("create account: %v", err)
	}
	user := User{
		AccountID:              account.ID,
		Email:                  "layout@example.com",
		IsAccountAdministrator: true,
		Locale:                 "zh",
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	defaultName := "Default template"
	defaultTemplate := Template{AccountID: account.ID, Name: &defaultName}
	if err := db.Create(&defaultTemplate).Error; err != nil {
		t.Fatalf("create default template: %v", err)
	}
	customName := "Custom template"
	customTemplate := Template{AccountID: account.ID, Name: &customName}
	if err := db.Create(&customTemplate).Error; err != nil {
		t.Fatalf("create custom template: %v", err)
	}

	for _, tmpl := range []Template{defaultTemplate, customTemplate} {
		contactPosition := 1
		contactPage := TemplatePage{
			TemplateID: tmpl.ID,
			Name:       strPtr("Contact information"),
			Slug:       "contact",
			Position:   &contactPosition,
		}
		if err := db.Create(&contactPage).Error; err != nil {
			t.Fatalf("create contact page: %v", err)
		}
		informationPosition := 2
		informationPage := TemplatePage{
			TemplateID: tmpl.ID,
			Name:       strPtr("Information"),
			Slug:       "information",
			Position:   &informationPosition,
		}
		if err := db.Create(&informationPage).Error; err != nil {
			t.Fatalf("create information page: %v", err)
		}
	}

	// A user page with the preferred slug must not be repurposed by the
	// backfill; the system page receives a deterministic alternative slug.
	collisionPosition := 3
	collisionName := "My summary"
	if err := db.Create(&TemplatePage{
		TemplateID: customTemplate.ID,
		Name:       &collisionName,
		Slug:       defaultContactSummaryPageSlug,
		Position:   &collisionPosition,
	}).Error; err != nil {
		t.Fatalf("create colliding page: %v", err)
	}

	return db, defaultTemplate, customTemplate
}

func TestBackfillContactTemplateLayoutAddsVisibleSystemPagesToEveryTemplate(t *testing.T) {
	db, defaultTemplate, customTemplate := setupContactTemplateLayoutBackfill(t)

	if err := BackfillContactTemplateLayout(db); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	if err := BackfillContactTemplateLayout(db); err != nil {
		t.Fatalf("backfill second run: %v", err)
	}

	var modules []Module
	if err := db.Where("account_id = ? AND name_translation_key IN ?",
		"account-contact-layout",
		[]string{
			defaultContactSummaryModuleTranslationKey,
			defaultRelationshipNetworkModuleTranslationKey,
		},
	).Order("name_translation_key ASC").Find(&modules).Error; err != nil {
		t.Fatalf("list system modules: %v", err)
	}
	if len(modules) != 2 {
		t.Fatalf("expected two system modules, got %d", len(modules))
	}
	for _, module := range modules {
		if module.CanBeDeleted {
			t.Fatalf("system module %d should not be deletable", module.ID)
		}
		if module.Name == nil || *module.Name == "" {
			t.Fatalf("system module %d should have a localized name", module.ID)
		}
	}

	for _, tmpl := range []Template{defaultTemplate, customTemplate} {
		var pages []TemplatePage
		if err := db.Where(
			"template_id = ? AND name_translation_key IN ?",
			tmpl.ID,
			[]string{
				defaultContactSummaryPageTranslationKey,
				defaultRelationshipNetworkPageTranslationKey,
			},
		).Order("position ASC").Find(&pages).Error; err != nil {
			t.Fatalf("list system pages: %v", err)
		}
		if len(pages) != 2 {
			t.Fatalf("template %d: expected two system pages, got %d", tmpl.ID, len(pages))
		}
		if pages[0].NameTranslationKey == nil || *pages[0].NameTranslationKey != defaultContactSummaryPageTranslationKey {
			t.Fatalf("template %d: summary should be prepended, got %+v", tmpl.ID, pages[0])
		}
		if pages[0].Position == nil || *pages[0].Position != 0 {
			t.Fatalf("template %d: summary position = %v, want 0", tmpl.ID, pages[0].Position)
		}
		if pages[1].NameTranslationKey == nil || *pages[1].NameTranslationKey != defaultRelationshipNetworkPageTranslationKey {
			t.Fatalf("template %d: relationship network should be appended, got %+v", tmpl.ID, pages[1])
		}
		if !pages[0].Visible || !pages[1].Visible {
			t.Fatalf("template %d: system pages must default visible", tmpl.ID)
		}
		if pages[0].CanBeDeleted || pages[1].CanBeDeleted {
			t.Fatalf("template %d: system pages must not be deletable", tmpl.ID)
		}

		for _, page := range pages {
			var bindingCount int64
			if err := db.Model(&ModuleTemplatePage{}).
				Where("template_page_id = ?", page.ID).
				Count(&bindingCount).Error; err != nil {
				t.Fatalf("count page bindings: %v", err)
			}
			if bindingCount != 1 {
				t.Fatalf("page %d: expected one module binding, got %d", page.ID, bindingCount)
			}
		}
	}

	var customSummary TemplatePage
	if err := db.Where(
		"template_id = ? AND name_translation_key = ?",
		customTemplate.ID,
		defaultContactSummaryPageTranslationKey,
	).First(&customSummary).Error; err != nil {
		t.Fatalf("find custom template summary: %v", err)
	}
	if customSummary.Slug == defaultContactSummaryPageSlug {
		t.Fatal("system summary reused a user-owned colliding slug")
	}
}

func TestBackfillContactTemplateLayoutPreservesHiddenCustomizedPage(t *testing.T) {
	db, defaultTemplate, _ := setupContactTemplateLayoutBackfill(t)
	if err := BackfillContactTemplateLayout(db); err != nil {
		t.Fatalf("backfill: %v", err)
	}

	var networkPage TemplatePage
	if err := db.Where(
		"template_id = ? AND name_translation_key = ?",
		defaultTemplate.ID,
		defaultRelationshipNetworkPageTranslationKey,
	).First(&networkPage).Error; err != nil {
		t.Fatalf("find relationship network page: %v", err)
	}
	customName := "Connections"
	customPosition := 42
	if err := db.Model(&networkPage).Updates(map[string]interface{}{
		"name":     customName,
		"position": customPosition,
		"visible":  false,
	}).Error; err != nil {
		t.Fatalf("customize network page: %v", err)
	}

	if err := BackfillContactTemplateLayout(db); err != nil {
		t.Fatalf("backfill second run: %v", err)
	}
	if err := db.First(&networkPage, networkPage.ID).Error; err != nil {
		t.Fatalf("reload network page: %v", err)
	}
	if networkPage.Name == nil || *networkPage.Name != customName {
		t.Fatalf("custom name was overwritten: %v", networkPage.Name)
	}
	if networkPage.Position == nil || *networkPage.Position != customPosition {
		t.Fatalf("custom position was overwritten: %v", networkPage.Position)
	}
	if networkPage.Visible {
		t.Fatal("hidden page was made visible by repeated backfill")
	}
}
