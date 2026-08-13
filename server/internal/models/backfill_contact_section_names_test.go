package models

import "testing"

func TestBackfillContactSectionNamesUpdatesDefaultsAndPreservesCustomNames(t *testing.T) {
	db := setupGiftContactModuleBackfillDB(t)
	account := Account{ID: "account-contact-section-names"}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("create account: %v", err)
	}
	if err := db.AutoMigrate(&User{}); err != nil {
		t.Fatalf("migrate user: %v", err)
	}
	user := User{AccountID: account.ID, Email: "sections@example.com", Locale: "en"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	templateName := "Default template"
	tmpl := Template{AccountID: account.ID, Name: &templateName}
	if err := db.Create(&tmpl).Error; err != nil {
		t.Fatalf("create template: %v", err)
	}

	contactKey := "seed.template_pages.contact_information"
	informationKey := "seed.template_pages.information"
	rows := []TemplatePage{
		{TemplateID: tmpl.ID, Name: strPtr("Contact information"), NameTranslationKey: &contactKey, Slug: "contact"},
		{TemplateID: tmpl.ID, Name: strPtr("资料"), NameTranslationKey: &informationKey, Slug: "information"},
		{TemplateID: tmpl.ID, Name: strPtr("My profile"), NameTranslationKey: &contactKey, Slug: "custom-profile"},
		{TemplateID: tmpl.ID, Name: strPtr("Contact information"), Slug: "unkeyed"},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatalf("create pages: %v", err)
	}

	if err := BackfillContactSectionNames(db); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	if err := BackfillContactSectionNames(db); err != nil {
		t.Fatalf("backfill second run: %v", err)
	}

	var pages []TemplatePage
	if err := db.Where("template_id = ?", tmpl.ID).Order("id ASC").Find(&pages).Error; err != nil {
		t.Fatalf("list pages: %v", err)
	}
	wantNames := []string{
		"Profile and contact",
		"Notes and records",
		"My profile",
		"Contact information",
	}
	for index, want := range wantNames {
		if pages[index].Name == nil || *pages[index].Name != want {
			t.Errorf("page %d name=%v, want %q", index, pages[index].Name, want)
		}
	}
}
