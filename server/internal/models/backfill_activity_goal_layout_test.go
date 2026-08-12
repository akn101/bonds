package models

import "testing"

func TestBackfillActivityGoalLayoutSplitsEveryTemplateIdempotently(t *testing.T) {
	db := setupGiftContactModuleBackfillDB(t)
	if err := db.AutoMigrate(&User{}); err != nil {
		t.Fatalf("migrate user: %v", err)
	}
	account := Account{ID: "account-activity-layout"}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("create account: %v", err)
	}
	user := User{AccountID: account.ID, Email: "activity-layout@example.com", Locale: "en", IsAccountAdministrator: true}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	activityName, activityType := "Activities", "activities"
	goalsName, goalsType := "Goals", "goals"
	activityModule := Module{AccountID: account.ID, Name: &activityName, Type: &activityType, CanBeDeleted: false}
	goalsModule := Module{AccountID: account.ID, Name: &goalsName, Type: &goalsType, CanBeDeleted: false}
	if err := db.Create(&activityModule).Error; err != nil {
		t.Fatalf("create activity module: %v", err)
	}
	if err := db.Create(&goalsModule).Error; err != nil {
		t.Fatalf("create goals module: %v", err)
	}

	for index, name := range []string{"Default template", "Custom template"} {
		tmpl := Template{AccountID: account.ID, Name: &name, CanBeDeleted: index != 0}
		if err := db.Create(&tmpl).Error; err != nil {
			t.Fatalf("create template: %v", err)
		}
		position := 6
		oldKey := "seed.template_pages.life_and_goals"
		pageName := "Life & goals"
		page := TemplatePage{TemplateID: tmpl.ID, Name: &pageName, NameTranslationKey: &oldKey, Slug: "life-goals", Position: &position}
		if err := db.Create(&page).Error; err != nil {
			t.Fatalf("create combined page: %v", err)
		}
		bindBackfillModule(t, db, page.ID, activityModule.ID, 1)
		bindBackfillModule(t, db, page.ID, goalsModule.ID, 2)
		informationPosition := 7
		informationName := "Information"
		if err := db.Create(&TemplatePage{TemplateID: tmpl.ID, Name: &informationName, Slug: "information", Position: &informationPosition}).Error; err != nil {
			t.Fatalf("create information page: %v", err)
		}
	}
	activitiesOnlyName := "Activities-only template"
	activitiesOnlyTemplate := Template{AccountID: account.ID, Name: &activitiesOnlyName, CanBeDeleted: true}
	if err := db.Create(&activitiesOnlyTemplate).Error; err != nil {
		t.Fatalf("create activities-only template: %v", err)
	}
	activitiesOnlyPageName := "Life & goals"
	activitiesOnlyKey := "seed.template_pages.life_and_goals"
	activitiesOnlyPosition := 1
	activitiesOnlyPage := TemplatePage{
		TemplateID:         activitiesOnlyTemplate.ID,
		Name:               &activitiesOnlyPageName,
		NameTranslationKey: &activitiesOnlyKey,
		Slug:               "life-goals",
		Position:           &activitiesOnlyPosition,
	}
	if err := db.Create(&activitiesOnlyPage).Error; err != nil {
		t.Fatalf("create activities-only page: %v", err)
	}
	bindBackfillModule(t, db, activitiesOnlyPage.ID, activityModule.ID, 1)
	goalsOnlyName := "Goals-only template"
	goalsOnlyTemplate := Template{AccountID: account.ID, Name: &goalsOnlyName, CanBeDeleted: true}
	if err := db.Create(&goalsOnlyTemplate).Error; err != nil {
		t.Fatalf("create goals-only template: %v", err)
	}
	goalsOnlyPageName := "Life & goals"
	goalsOnlyKey := "seed.template_pages.life_and_goals"
	goalsOnlyPosition := 1
	goalsOnlyPage := TemplatePage{
		TemplateID:         goalsOnlyTemplate.ID,
		Name:               &goalsOnlyPageName,
		NameTranslationKey: &goalsOnlyKey,
		Slug:               "life-goals",
		Position:           &goalsOnlyPosition,
	}
	if err := db.Create(&goalsOnlyPage).Error; err != nil {
		t.Fatalf("create goals-only page: %v", err)
	}
	bindBackfillModule(t, db, goalsOnlyPage.ID, goalsModule.ID, 1)
	customName := "Memories and plans"
	customTemplate := Template{AccountID: account.ID, Name: &customName, CanBeDeleted: true}
	if err := db.Create(&customTemplate).Error; err != nil {
		t.Fatalf("create custom template: %v", err)
	}
	customPosition := 1
	customPage := TemplatePage{TemplateID: customTemplate.ID, Name: &customName, Slug: "memories-and-plans", Position: &customPosition}
	if err := db.Create(&customPage).Error; err != nil {
		t.Fatalf("create custom page: %v", err)
	}
	bindBackfillModule(t, db, customPage.ID, activityModule.ID, 1)
	bindBackfillModule(t, db, customPage.ID, goalsModule.ID, 2)

	if err := BackfillActivityGoalLayout(db); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	if err := BackfillActivityGoalLayout(db); err != nil {
		t.Fatalf("idempotent rerun: %v", err)
	}

	var templates []Template
	if err := db.Where("account_id = ?", account.ID).Find(&templates).Error; err != nil {
		t.Fatalf("list templates: %v", err)
	}
	for _, tmpl := range templates {
		if tmpl.ID == goalsOnlyTemplate.ID {
			var pages []TemplatePage
			if err := db.Where("template_id = ?", tmpl.ID).Find(&pages).Error; err != nil {
				t.Fatalf("list goals-only pages: %v", err)
			}
			if len(pages) != 1 || pages[0].Slug != goalsPageSlug || pages[0].NameTranslationKey == nil || *pages[0].NameTranslationKey != goalsPageTranslationKey {
				t.Fatalf("goals-only template pages = %+v", pages)
			}
			continue
		}
		if tmpl.ID == customTemplate.ID {
			var pages []TemplatePage
			if err := db.Where("template_id = ?", tmpl.ID).Order("position ASC").Find(&pages).Error; err != nil {
				t.Fatalf("list custom pages: %v", err)
			}
			if len(pages) != 2 || pages[0].Slug != "memories-and-plans" || pages[0].Name == nil || *pages[0].Name != customName {
				t.Fatalf("custom activity page was overwritten: %+v", pages)
			}
			if pages[1].Slug != goalsPageSlug {
				t.Fatalf("custom goals page = %+v", pages[1])
			}
			continue
		}
		if tmpl.ID == activitiesOnlyTemplate.ID {
			var pages []TemplatePage
			if err := db.Where("template_id = ?", tmpl.ID).Find(&pages).Error; err != nil {
				t.Fatalf("list activities-only pages: %v", err)
			}
			if len(pages) != 1 || pages[0].Slug != activitiesPageSlug {
				t.Fatalf("activities-only template pages = %+v", pages)
			}
			var goalBindingCount int64
			if err := db.Model(&ModuleTemplatePage{}).
				Joins("JOIN template_pages ON template_pages.id = module_template_page.template_page_id").
				Where("template_pages.template_id = ? AND module_template_page.module_id = ?", tmpl.ID, goalsModule.ID).
				Count(&goalBindingCount).Error; err != nil {
				t.Fatal(err)
			}
			if goalBindingCount != 0 {
				t.Fatalf("activities-only template gained %d goals bindings", goalBindingCount)
			}
			continue
		}
		var pages []TemplatePage
		if err := db.Where("template_id = ?", tmpl.ID).Order("position ASC").Find(&pages).Error; err != nil {
			t.Fatalf("list pages: %v", err)
		}
		if len(pages) != 3 {
			t.Fatalf("template %d: pages = %d, want 3", tmpl.ID, len(pages))
		}
		if pages[0].Slug != "activities" || pages[0].NameTranslationKey == nil || *pages[0].NameTranslationKey != activitiesPageTranslationKey {
			t.Fatalf("template %d: activities page = %+v", tmpl.ID, pages[0])
		}
		if pages[1].Slug != "goals" || pages[1].NameTranslationKey == nil || *pages[1].NameTranslationKey != goalsPageTranslationKey {
			t.Fatalf("template %d: goals page = %+v", tmpl.ID, pages[1])
		}
		if pages[2].Position == nil || *pages[2].Position != 8 {
			t.Fatalf("template %d: information position = %v, want 8", tmpl.ID, pages[2].Position)
		}
		var activityBindings, goalBindings []ModuleTemplatePage
		if err := db.Where("template_page_id = ?", pages[0].ID).Find(&activityBindings).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Where("template_page_id = ?", pages[1].ID).Find(&goalBindings).Error; err != nil {
			t.Fatal(err)
		}
		if len(activityBindings) != 1 || activityBindings[0].ModuleID != activityModule.ID {
			t.Fatalf("template %d: activity bindings = %+v", tmpl.ID, activityBindings)
		}
		if len(goalBindings) != 1 || goalBindings[0].ModuleID != goalsModule.ID {
			t.Fatalf("template %d: goals bindings = %+v", tmpl.ID, goalBindings)
		}
	}
}
