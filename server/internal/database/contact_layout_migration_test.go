package database

import (
	"fmt"
	"slices"
	"testing"

	"github.com/naiba/bonds/internal/models"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestDropLegacyContactTemplateForeignKeysWithDependentRows(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:drop-contact-layout-constraints?mode=memory&cache=shared"), &gorm.Config{
		PrepareStmt: false,
	})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.Exec("PRAGMA foreign_keys = ON").Error; err != nil {
		t.Fatalf("enable foreign keys: %v", err)
	}

	statements := []string{
		"CREATE TABLE `templates` (`id` integer PRIMARY KEY AUTOINCREMENT)",
		`CREATE TABLE "vaults" ("id" text PRIMARY KEY, "default_template_id" integer, CONSTRAINT "fk_vaults_template" FOREIGN KEY ("default_template_id") REFERENCES "templates"("id"))`,
		`CREATE TABLE "contacts" ("id" text PRIMARY KEY, "vault_id" text NOT NULL, "template_id" integer, CONSTRAINT "fk_vaults_contacts" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id"), CONSTRAINT "fk_templates_contacts" FOREIGN KEY ("template_id") REFERENCES "templates"("id"))`,
		`CREATE TABLE "notes" ("id" integer PRIMARY KEY AUTOINCREMENT, "contact_id" text NOT NULL, CONSTRAINT "fk_contacts_notes" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id"))`,
		`CREATE TABLE "labels" ("id" integer PRIMARY KEY AUTOINCREMENT, "vault_id" text NOT NULL, CONSTRAINT "fk_vaults_labels" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id"))`,
		`INSERT INTO templates (id) VALUES (1)`,
		`INSERT INTO vaults (id, default_template_id) VALUES ('vault-1', 1)`,
		`INSERT INTO contacts (id, vault_id, template_id) VALUES ('contact-1', 'vault-1', 1)`,
		`INSERT INTO notes (contact_id) VALUES ('contact-1')`,
		`INSERT INTO labels (vault_id) VALUES ('vault-1')`,
	}
	for _, statement := range statements {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("prepare legacy contact layout schema: %v", err)
		}
	}
	if err := dropLegacyContactTemplateForeignKeys(db); err != nil {
		t.Fatalf("drop legacy contact layout foreign keys: %v", err)
	}

	if db.Migrator().HasConstraint("contacts", "fk_templates_contacts") {
		t.Fatal("contacts legacy template constraint still exists")
	}
	if db.Migrator().HasConstraint("vaults", "fk_vaults_template") {
		t.Fatal("vaults legacy template constraint still exists")
	}
	for _, constraint := range []struct {
		table string
		name  string
	}{
		{table: "contacts", name: "fk_vaults_contacts"},
		{table: "notes", name: "fk_contacts_notes"},
		{table: "labels", name: "fk_vaults_labels"},
	} {
		if !db.Migrator().HasConstraint(constraint.table, constraint.name) {
			t.Fatalf("unrelated constraint %s on %s was removed", constraint.name, constraint.table)
		}
	}
	for _, table := range []string{"templates", "vaults", "contacts", "notes", "labels"} {
		var count int64
		if err := db.Table(table).Count(&count).Error; err != nil {
			t.Fatalf("count %s rows: %v", table, err)
		}
		if count != 1 {
			t.Fatalf("%s rows = %d, want 1", table, count)
		}
	}
	if foreignKeysEnabled(t, db) != 1 {
		t.Fatal("foreign key enforcement was not restored")
	}
	var violations []struct {
		Table string
	}
	if err := db.Raw("PRAGMA foreign_key_check").Scan(&violations).Error; err != nil {
		t.Fatalf("check foreign keys: %v", err)
	}
	if len(violations) != 0 {
		t.Fatalf("migration left foreign key violations: %+v", violations)
	}

	if err := dropLegacyContactTemplateForeignKeys(db); err != nil {
		t.Fatalf("rerun legacy constraint cleanup: %v", err)
	}
}

func TestEnsureLegacyContactTemplatePageVisibleColumn(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:legacy-template-page-visible?mode=memory&cache=shared"), &gorm.Config{PrepareStmt: false})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.Exec(`CREATE TABLE template_pages (
		id integer PRIMARY KEY AUTOINCREMENT,
		template_id integer NOT NULL,
		slug text NOT NULL
	)`).Error; err != nil {
		t.Fatalf("create pre-visible template_pages: %v", err)
	}
	if err := db.Exec("INSERT INTO template_pages (template_id, slug) VALUES (1, 'contact')").Error; err != nil {
		t.Fatalf("insert legacy page: %v", err)
	}

	if err := ensureLegacyContactTemplatePageVisibleColumn(db); err != nil {
		t.Fatalf("add legacy visible column: %v", err)
	}
	if !hasColumn(db, "template_pages", "visible") {
		t.Fatal("legacy visible column was not added")
	}
	var visible bool
	if err := db.Table("template_pages").Select("visible").Where("id = 1").Scan(&visible).Error; err != nil {
		t.Fatalf("read migrated visible value: %v", err)
	}
	if !visible {
		t.Fatal("existing legacy template page should default to visible")
	}

	if err := ensureLegacyContactTemplatePageVisibleColumn(db); err != nil {
		t.Fatalf("rerun legacy visible migration: %v", err)
	}
}

func TestMigrateVaultContactLayoutsPreservesAndIsolatesLegacyAccountLayouts(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:contact-layout-migration?mode=memory&cache=shared"), &gorm.Config{
		PrepareStmt: false,
	})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(models.AllModels()...); err != nil {
		t.Fatalf("create current non-layout schema: %v", err)
	}
	if err := db.AutoMigrate(
		&models.Template{}, &models.TemplatePage{}, &models.Module{},
		&models.ModuleRow{}, &models.ModuleRowField{}, &models.ModuleTemplatePage{},
	); err != nil {
		t.Fatalf("create legacy schema: %v", err)
	}

	account := models.Account{ID: "account-layout-migration"}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("create account: %v", err)
	}
	user := models.User{
		ID:                 "user-layout-migration",
		AccountID:          account.ID,
		Email:              "layout-migration@example.com",
		ContactSortOrder:   "last_updated",
		ContactListColumns: "",
		DashboardTab:       "unknown",
		TaskView:           "grid",
		TaskSort:           "priority",
		Theme:              "blue",
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	// GORM applies string defaults on Create; force legacy invalid values so the
	// migration's normalization is exercised.
	if err := db.Model(&models.User{}).Where("id = ?", user.ID).Updates(map[string]interface{}{
		"contact_sort_order":   "last_updated",
		"contact_list_columns": "",
		"dashboard_tab":        "unknown",
		"task_view":            "grid",
		"task_sort":            "priority",
		"theme":                "blue",
	}).Error; err != nil {
		t.Fatalf("set legacy preferences: %v", err)
	}

	vaultA := models.Vault{ID: "vault-layout-a", AccountID: account.ID, Type: "personal", Name: "A"}
	vaultB := models.Vault{ID: "vault-layout-b", AccountID: account.ID, Type: "personal", Name: "B"}
	if err := db.Create(&vaultA).Error; err != nil {
		t.Fatalf("create vault A: %v", err)
	}
	if err := db.Create(&vaultB).Error; err != nil {
		t.Fatalf("create vault B: %v", err)
	}
	if err := db.Exec("ALTER TABLE vaults ADD COLUMN name_order text").Error; err != nil {
		t.Fatalf("add legacy name_order: %v", err)
	}
	if err := db.Exec("ALTER TABLE vaults ADD COLUMN default_dashboard_tab text DEFAULT 'feed'").Error; err != nil {
		t.Fatalf("add legacy dashboard preference: %v", err)
	}

	defaultName := "Default template"
	customName := "Family detail"
	caseDuplicateName := "family detail"
	defaultTemplate := models.Template{AccountID: account.ID, Name: &defaultName}
	customTemplate := models.Template{AccountID: account.ID, Name: &customName}
	caseDuplicateTemplate := models.Template{AccountID: account.ID, Name: &caseDuplicateName}
	if err := db.Create(&defaultTemplate).Error; err != nil {
		t.Fatalf("create default template: %v", err)
	}
	if err := db.Model(&defaultTemplate).Update("can_be_deleted", false).Error; err != nil {
		t.Fatalf("protect default template: %v", err)
	}
	if err := db.Create(&customTemplate).Error; err != nil {
		t.Fatalf("create custom template: %v", err)
	}
	if err := db.Create(&caseDuplicateTemplate).Error; err != nil {
		t.Fatalf("create case-duplicate template: %v", err)
	}

	socialName := "Social"
	hiddenName := "Private notes"
	socialPosition, hiddenPosition := 3, 9
	socialType := "relationships"
	socialPage := models.TemplatePage{
		TemplateID: defaultTemplate.ID, Name: &socialName, Slug: "social",
		Position: &socialPosition, Visible: true,
	}
	hiddenPage := models.TemplatePage{
		TemplateID: customTemplate.ID, Name: &hiddenName, Slug: "private-notes",
		Position: &hiddenPosition, Type: &socialType, Visible: true,
	}
	if err := db.Create(&socialPage).Error; err != nil {
		t.Fatalf("create social page: %v", err)
	}
	if err := db.Create(&hiddenPage).Error; err != nil {
		t.Fatalf("create hidden page: %v", err)
	}
	if err := db.Model(&hiddenPage).Update("visible", false).Error; err != nil {
		t.Fatalf("hide custom page: %v", err)
	}

	relationshipsType := "relationships"
	notesType := "notes"
	relationshipsName := "Relationships"
	notesName := "Notes"
	relationshipsModule := models.Module{AccountID: account.ID, Name: &relationshipsName, Type: &relationshipsType}
	notesModule := models.Module{AccountID: account.ID, Name: &notesName, Type: &notesType}
	if err := db.Create(&relationshipsModule).Error; err != nil {
		t.Fatalf("create relationships module: %v", err)
	}
	if err := db.Create(&notesModule).Error; err != nil {
		t.Fatalf("create notes module: %v", err)
	}
	firstPosition := 0
	for _, placement := range []models.ModuleTemplatePage{
		{TemplatePageID: socialPage.ID, ModuleID: relationshipsModule.ID, Position: &firstPosition},
		{TemplatePageID: hiddenPage.ID, ModuleID: notesModule.ID, Position: &firstPosition},
	} {
		if err := db.Create(&placement).Error; err != nil {
			t.Fatalf("create module placement: %v", err)
		}
	}

	if err := db.Model(&models.Vault{}).Where("id = ?", vaultA.ID).Update("default_template_id", defaultTemplate.ID).Error; err != nil {
		t.Fatalf("set vault A default: %v", err)
	}
	if err := db.Model(&models.Vault{}).Where("id = ?", vaultB.ID).Update("default_template_id", customTemplate.ID).Error; err != nil {
		t.Fatalf("set vault B default: %v", err)
	}
	contactA := models.Contact{ID: "contact-layout-a", VaultID: vaultA.ID, FirstName: stringPointer("Alice"), TemplateID: &customTemplate.ID}
	contactB := models.Contact{ID: "contact-layout-b", VaultID: vaultB.ID, FirstName: stringPointer("Bob"), TemplateID: &defaultTemplate.ID}
	if err := db.Table("contacts").Create(map[string]interface{}{
		"id": contactA.ID, "vault_id": contactA.VaultID, "first_name": "Alice", "template_id": customTemplate.ID,
	}).Error; err != nil {
		t.Fatalf("create contact A: %v", err)
	}
	if err := db.Table("contacts").Create(map[string]interface{}{
		"id": contactB.ID, "vault_id": contactB.VaultID, "first_name": "Bob", "template_id": defaultTemplate.ID,
	}).Error; err != nil {
		t.Fatalf("create contact B: %v", err)
	}

	if err := AutoMigrate(db); err != nil {
		t.Fatalf("migrate legacy layouts: %v", err)
	}

	templatesA := loadVaultLayoutTemplates(t, db, vaultA.ID)
	templatesB := loadVaultLayoutTemplates(t, db, vaultB.ID)
	if len(templatesA) != len(templatesB) || len(templatesA) < 2 {
		t.Fatalf("expected each vault to receive all account templates, got A=%d B=%d", len(templatesA), len(templatesB))
	}
	for name, templateA := range templatesA {
		templateB, ok := templatesB[name]
		if !ok {
			t.Fatalf("vault B missing cloned template %q", name)
		}
		if templateA.ID == templateB.ID {
			t.Fatalf("template %q was shared across vaults", name)
		}
	}
	if _, ok := templatesA["family detail (2)"]; !ok {
		t.Fatalf("case-insensitive legacy duplicate was not renamed: %v", templatesA)
	}

	assertVaultDefaultTemplate(t, db, vaultA.ID, templatesA[defaultName].ID)
	assertVaultDefaultTemplate(t, db, vaultB.ID, templatesB[customName].ID)
	assertContactTemplate(t, db, contactA.ID, vaultA.ID, templatesA[customName].ID)
	assertContactTemplate(t, db, contactB.ID, vaultB.ID, templatesB[defaultName].ID)

	var migratedHiddenPage models.VaultContactTemplatePage
	if err := db.Where("template_id = ? AND slug = ?", templatesA[customName].ID, "private-notes").First(&migratedHiddenPage).Error; err != nil {
		t.Fatalf("load migrated hidden page: %v", err)
	}
	if migratedHiddenPage.Visible || migratedHiddenPage.Position != hiddenPosition {
		t.Fatalf("hidden page state was not preserved: %+v", migratedHiddenPage)
	}
	var migratedNotes models.VaultContactTemplateModule
	if err := db.Where("template_page_id = ? AND module_key = ?", migratedHiddenPage.ID, "notes").First(&migratedNotes).Error; err != nil {
		t.Fatalf("load migrated notes module: %v", err)
	}

	for _, table := range []string{"templates", "template_pages", "modules", "module_template_page", "module_rows", "module_row_fields"} {
		if db.Migrator().HasTable(table) {
			t.Fatalf("legacy layout table %s still exists", table)
		}
	}
	for _, column := range []string{"name_order", "default_dashboard_tab"} {
		if hasColumn(db, "vaults", column) {
			t.Fatalf("legacy vault preference column %s still exists", column)
		}
	}

	var normalized models.User
	if err := db.First(&normalized, "id = ?", user.ID).Error; err != nil {
		t.Fatalf("load normalized user: %v", err)
	}
	if normalized.ContactSortOrder != "name" || normalized.DashboardTab != "feed" ||
		normalized.TaskView != "list" || normalized.TaskSort != "custom" || normalized.Theme != "system" ||
		normalized.ContactListColumns == "" {
		t.Fatalf("legacy personal preferences were not normalized: %+v", normalized)
	}

	beforeA, beforeB := len(templatesA), len(templatesB)
	if err := AutoMigrate(db); err != nil {
		t.Fatalf("rerun migration: %v", err)
	}
	if got := len(loadVaultLayoutTemplates(t, db, vaultA.ID)); got != beforeA {
		t.Fatalf("idempotent rerun changed vault A template count: %d -> %d", beforeA, got)
	}
	if got := len(loadVaultLayoutTemplates(t, db, vaultB.ID)); got != beforeB {
		t.Fatalf("idempotent rerun changed vault B template count: %d -> %d", beforeB, got)
	}
}

func TestSplitLegacyExtraInformationModulesPreservesLayoutAndIsIdempotent(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:split-extra-information?mode=memory&cache=shared"), &gorm.Config{PrepareStmt: false})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(models.AllModels()...); err != nil {
		t.Fatalf("migrate schema: %v", err)
	}

	account := models.Account{ID: "account-split-extra"}
	vault := models.Vault{ID: "vault-split-extra", AccountID: account.ID, Type: "personal", Name: "Split"}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("create account: %v", err)
	}
	if err := db.Create(&vault).Error; err != nil {
		t.Fatalf("create vault: %v", err)
	}
	if err := models.SeedVaultContactLayout(db, vault.ID); err != nil {
		t.Fatalf("seed current layout: %v", err)
	}

	var template models.VaultContactTemplate
	if err := db.Where("vault_id = ?", vault.ID).First(&template).Error; err != nil {
		t.Fatalf("load template: %v", err)
	}
	if err := db.Model(&template).Update("revision", 7).Error; err != nil {
		t.Fatalf("set revision: %v", err)
	}
	var page models.VaultContactTemplatePage
	if err := db.Where("template_id = ? AND slug = ?", template.ID, "contact").First(&page).Error; err != nil {
		t.Fatalf("load contact page: %v", err)
	}
	if err := db.Model(&page).Update("visible", false).Error; err != nil {
		t.Fatalf("hide contact page: %v", err)
	}
	if err := db.Where("template_page_id = ? AND module_key IN ?", page.ID, []string{"religion", "jobs"}).
		Delete(&models.VaultContactTemplateModule{}).Error; err != nil {
		t.Fatalf("remove current split modules: %v", err)
	}
	if err := db.Table("vault_contact_template_modules").
		Where("template_page_id = ? AND position > ?", page.ID, 4).
		Update("position", gorm.Expr("position - 1")).Error; err != nil {
		t.Fatalf("restore legacy neighboring positions: %v", err)
	}
	if err := db.Table("vault_contact_template_modules").Create(map[string]interface{}{
		"template_id": template.ID, "template_page_id": page.ID, "module_key": "extra_information", "position": 3,
	}).Error; err != nil {
		t.Fatalf("insert retired placement: %v", err)
	}

	if err := splitLegacyExtraInformationModules(db); err != nil {
		t.Fatalf("split legacy placement: %v", err)
	}
	assertSplitContactModules(t, db, template.ID, page.ID, 8, false)

	if err := splitLegacyExtraInformationModules(db); err != nil {
		t.Fatalf("rerun split migration: %v", err)
	}
	assertSplitContactModules(t, db, template.ID, page.ID, 8, false)
}

func assertSplitContactModules(t *testing.T, db *gorm.DB, templateID, pageID uint, revision uint, visible bool) {
	t.Helper()
	var template models.VaultContactTemplate
	if err := db.First(&template, templateID).Error; err != nil {
		t.Fatalf("reload template: %v", err)
	}
	if template.Revision != revision {
		t.Fatalf("template revision = %d, want %d", template.Revision, revision)
	}
	var page models.VaultContactTemplatePage
	if err := db.First(&page, pageID).Error; err != nil {
		t.Fatalf("reload page: %v", err)
	}
	if page.Visible != visible {
		t.Fatalf("page visibility = %v, want %v", page.Visible, visible)
	}
	var modules []models.VaultContactTemplateModule
	if err := db.Where("template_page_id = ?", pageID).Order("position ASC, id ASC").Find(&modules).Error; err != nil {
		t.Fatalf("load modules: %v", err)
	}
	got := make([]string, len(modules))
	for index, module := range modules {
		got[index] = fmt.Sprintf("%s:%d", module.ModuleKey, module.Position)
	}
	want := []string{"important_dates:0", "labels:1", "quick_facts:2", "religion:3", "jobs:4", "addresses:5", "contact_information:6"}
	if !slices.Equal(got, want) {
		t.Fatalf("module order = %v, want %v", got, want)
	}
}

func loadVaultLayoutTemplates(t *testing.T, db *gorm.DB, vaultID string) map[string]models.VaultContactTemplate {
	t.Helper()
	var templates []models.VaultContactTemplate
	if err := db.Where("vault_id = ?", vaultID).Find(&templates).Error; err != nil {
		t.Fatalf("load templates for %s: %v", vaultID, err)
	}
	result := make(map[string]models.VaultContactTemplate, len(templates))
	for _, template := range templates {
		result[template.Name] = template
	}
	return result
}

func assertVaultDefaultTemplate(t *testing.T, db *gorm.DB, vaultID string, expected uint) {
	t.Helper()
	var vault models.Vault
	if err := db.First(&vault, "id = ?", vaultID).Error; err != nil {
		t.Fatalf("load vault %s: %v", vaultID, err)
	}
	if vault.DefaultTemplateID == nil || *vault.DefaultTemplateID != expected {
		t.Fatalf("vault %s default template = %v, want %d", vaultID, vault.DefaultTemplateID, expected)
	}
}

func assertContactTemplate(t *testing.T, db *gorm.DB, contactID, vaultID string, expected uint) {
	t.Helper()
	var contact models.Contact
	if err := db.First(&contact, "id = ?", contactID).Error; err != nil {
		t.Fatalf("load contact %s: %v", contactID, err)
	}
	if contact.VaultID != vaultID || contact.TemplateID == nil || *contact.TemplateID != expected {
		t.Fatalf("contact %s has vault/template %s/%v, want %s/%d", contactID, contact.VaultID, contact.TemplateID, vaultID, expected)
	}
}

func stringPointer(value string) *string {
	return &value
}
