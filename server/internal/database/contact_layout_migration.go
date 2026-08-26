package database

import (
	"fmt"
	"strings"

	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

type legacyContactTemplate struct {
	ID                 uint
	AccountID          string
	Name               *string
	NameTranslationKey *string
	CanBeDeleted       bool
}

type legacyContactTemplatePage struct {
	ID                 uint
	TemplateID         uint
	Name               *string
	NameTranslationKey *string
	Slug               string
	Position           *int
	Type               *string
	Visible            bool
}

type legacyContactModule struct {
	ID   uint
	Name *string
	Type *string
}

type legacyContactModulePlacement struct {
	TemplatePageID uint
	ModuleID       uint
	Position       *int
}

// ensureLegacyContactTemplatePageVisibleColumn prepares account-scoped
// contact layouts created before v0.22 for the backfills that run immediately
// before they are copied into vault-scoped layouts. TemplatePage is no longer
// part of AllModels, so AutoMigrate cannot add this transitional column for us.
func ensureLegacyContactTemplatePageVisibleColumn(db *gorm.DB) error {
	if !db.Migrator().HasTable("template_pages") || hasColumn(db, "template_pages", "visible") {
		return nil
	}
	if err := db.Migrator().AddColumn(&models.TemplatePage{}, "Visible"); err != nil {
		return fmt.Errorf("add visible column to legacy template_pages: %w", err)
	}
	return nil
}

func migrateVaultContactLayouts(db *gorm.DB) error {
	if !db.Migrator().HasTable("vaults") {
		return nil
	}
	if err := dropLegacyContactTemplateForeignKeys(db); err != nil {
		return err
	}

	var vaults []models.Vault
	if err := db.Select("id", "account_id", "default_template_id").Order("id ASC").Find(&vaults).Error; err != nil {
		return err
	}
	for _, vault := range vaults {
		var existing int64
		if err := db.Model(&models.VaultContactTemplate{}).Where("vault_id = ?", vault.ID).Count(&existing).Error; err != nil {
			return err
		}
		if existing > 0 {
			continue
		}
		if err := migrateVaultContactLayout(db, vault); err != nil {
			return fmt.Errorf("migrate contact layouts for vault %s: %w", vault.ID, err)
		}
	}
	if err := splitLegacyExtraInformationModules(db); err != nil {
		return err
	}
	if err := normalizeUserViewPreferences(db); err != nil {
		return err
	}
	if err := validateVaultContactLayoutReferences(db); err != nil {
		return err
	}
	if err := dropLegacyContactLayoutTables(db); err != nil {
		return err
	}
	return dropLegacyVaultPreferenceColumns(db)
}

// splitLegacyExtraInformationModules upgrades the v0.22 combined placement to
// the two independently configurable content blocks it represented. The
// transaction and removal of the retired key make the migration atomic and
// idempotent: a template revision advances exactly once when its layout changes.
func splitLegacyExtraInformationModules(db *gorm.DB) error {
	if !db.Migrator().HasTable(&models.VaultContactTemplateModule{}) {
		return nil
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var legacyPlacements []models.VaultContactTemplateModule
		if err := tx.Where("module_key = ?", "extra_information").Order("template_id ASC, id ASC").Find(&legacyPlacements).Error; err != nil {
			return err
		}
		for _, legacy := range legacyPlacements {
			if err := tx.Table("vault_contact_template_modules").
				Where("template_page_id = ? AND position > ?", legacy.TemplatePageID, legacy.Position).
				Update("position", gorm.Expr("position + 1")).Error; err != nil {
				return err
			}
			if err := tx.Delete(&legacy).Error; err != nil {
				return err
			}
			placements := []models.VaultContactTemplateModule{
				{TemplateID: legacy.TemplateID, TemplatePageID: legacy.TemplatePageID, ModuleKey: "religion", Position: legacy.Position},
				{TemplateID: legacy.TemplateID, TemplatePageID: legacy.TemplatePageID, ModuleKey: "jobs", Position: legacy.Position + 1},
			}
			if err := tx.Create(&placements).Error; err != nil {
				return err
			}
			if err := tx.Model(&models.VaultContactTemplate{}).
				Where("id = ?", legacy.TemplateID).
				Update("revision", gorm.Expr("revision + 1")).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func validateVaultContactLayoutReferences(db *gorm.DB) error {
	var invalidVaultDefaults int64
	if err := db.Table("vaults v").
		Joins("LEFT JOIN vault_contact_templates t ON t.id = v.default_template_id AND t.vault_id = v.id").
		Where("v.default_template_id IS NULL OR t.id IS NULL").
		Count(&invalidVaultDefaults).Error; err != nil {
		return err
	}
	if invalidVaultDefaults != 0 {
		return fmt.Errorf("contact layout migration left %d vaults without a valid default template", invalidVaultDefaults)
	}

	var invalidContactTemplates int64
	if err := db.Table("contacts c").
		Joins("LEFT JOIN vault_contact_templates t ON t.id = c.template_id AND t.vault_id = c.vault_id").
		Where("c.template_id IS NOT NULL AND t.id IS NULL").
		Count(&invalidContactTemplates).Error; err != nil {
		return err
	}
	if invalidContactTemplates != 0 {
		return fmt.Errorf("contact layout migration left %d contacts with a cross-vault or missing template", invalidContactTemplates)
	}
	return nil
}

func dropLegacyContactLayoutTables(db *gorm.DB) error {
	for _, table := range []string{"module_row_fields", "module_rows", "module_template_page", "template_pages", "modules", "templates"} {
		if !db.Migrator().HasTable(table) {
			continue
		}
		if err := db.Migrator().DropTable(table); err != nil {
			return fmt.Errorf("drop legacy contact layout table %s: %w", table, err)
		}
	}
	return nil
}

func dropLegacyVaultPreferenceColumns(db *gorm.DB) error {
	for _, column := range []string{"name_order", "default_dashboard_tab"} {
		if !hasColumn(db, "vaults", column) {
			continue
		}
		if err := db.Exec("ALTER TABLE " + quoteIdentifier("vaults") + " DROP COLUMN " + quoteIdentifier(column)).Error; err != nil {
			return fmt.Errorf("drop legacy vault personal preference column %s: %w", column, err)
		}
	}
	return nil
}

func dropLegacyContactTemplateForeignKeys(db *gorm.DB) error {
	if db.Dialector.Name() == "sqlite" {
		return db.Connection(func(conn *gorm.DB) (err error) {
			var foreignKeys int
			if err := conn.Raw("PRAGMA foreign_keys").Scan(&foreignKeys).Error; err != nil {
				return fmt.Errorf("inspect SQLite foreign key enforcement: %w", err)
			}
			if foreignKeys == 0 {
				return dropLegacyContactTemplateForeignKeysWithMigrator(conn)
			}

			if err := conn.Exec("PRAGMA foreign_keys = OFF").Error; err != nil {
				return fmt.Errorf("disable SQLite foreign key enforcement for contact layout migration: %w", err)
			}
			defer func() {
				if restoreErr := conn.Exec("PRAGMA foreign_keys = ON").Error; restoreErr != nil && err == nil {
					err = fmt.Errorf("restore SQLite foreign key enforcement after contact layout migration: %w", restoreErr)
				}
			}()

			return dropLegacyContactTemplateForeignKeysWithMigrator(conn)
		})
	}
	return dropLegacyContactTemplateForeignKeysWithMigrator(db)
}

func dropLegacyContactTemplateForeignKeysWithMigrator(db *gorm.DB) error {
	constraints := []struct {
		table string
		name  string
	}{
		{table: "contacts", name: "fk_templates_contacts"},
		{table: "vaults", name: "fk_vaults_template"},
	}
	for _, constraint := range constraints {
		if !db.Migrator().HasConstraint(constraint.table, constraint.name) {
			continue
		}
		if err := db.Migrator().DropConstraint(constraint.table, constraint.name); err != nil {
			return fmt.Errorf("drop legacy contact layout constraint %s: %w", constraint.name, err)
		}
	}
	return nil
}

func migrateVaultContactLayout(db *gorm.DB, vault models.Vault) error {
	if !hasLegacyContactLayoutTables(db) {
		return db.Transaction(func(tx *gorm.DB) error {
			return models.SeedVaultContactLayout(tx, vault.ID)
		})
	}

	var legacyTemplates []legacyContactTemplate
	if err := db.Table("templates").Where("account_id = ?", vault.AccountID).Order("id ASC").Scan(&legacyTemplates).Error; err != nil {
		return err
	}
	if len(legacyTemplates) == 0 {
		return db.Transaction(func(tx *gorm.DB) error {
			return models.SeedVaultContactLayout(tx, vault.ID)
		})
	}

	return db.Transaction(func(tx *gorm.DB) error {
		legacyToVaultTemplate := make(map[uint]uint, len(legacyTemplates))
		usedNames := make(map[string]int, len(legacyTemplates))
		for _, legacyTemplate := range legacyTemplates {
			name := legacyLayoutName(legacyTemplate.Name, legacyTemplate.NameTranslationKey, "Template")
			lowerName := strings.ToLower(name)
			usedNames[lowerName]++
			if usedNames[lowerName] > 1 {
				name = fmt.Sprintf("%s (%d)", name, usedNames[lowerName])
			}
			template := models.VaultContactTemplate{
				VaultID:            vault.ID,
				Name:               name,
				NameTranslationKey: legacyTemplate.NameTranslationKey,
				Revision:           1,
				CanBeDeleted:       legacyTemplate.CanBeDeleted,
			}
			if err := tx.Create(&template).Error; err != nil {
				return err
			}
			if !legacyTemplate.CanBeDeleted {
				if err := tx.Model(&template).Update("can_be_deleted", false).Error; err != nil {
					return err
				}
			}
			legacyToVaultTemplate[legacyTemplate.ID] = template.ID
			if err := migrateLegacyContactTemplatePages(tx, legacyTemplate.ID, template.ID); err != nil {
				return err
			}
		}

		defaultTemplateID := uint(0)
		if vault.DefaultTemplateID != nil {
			defaultTemplateID = legacyToVaultTemplate[*vault.DefaultTemplateID]
		}
		if defaultTemplateID == 0 {
			for _, legacyTemplate := range legacyTemplates {
				if !legacyTemplate.CanBeDeleted {
					defaultTemplateID = legacyToVaultTemplate[legacyTemplate.ID]
					break
				}
			}
		}
		if defaultTemplateID == 0 {
			defaultTemplateID = legacyToVaultTemplate[legacyTemplates[0].ID]
		}
		if err := tx.Model(&models.Vault{}).Where("id = ?", vault.ID).Update("default_template_id", defaultTemplateID).Error; err != nil {
			return err
		}

		type contactTemplateReference struct {
			ID         string
			TemplateID *uint
		}
		var contacts []contactTemplateReference
		if err := tx.Table("contacts").Select("id", "template_id").Where("vault_id = ?", vault.ID).Scan(&contacts).Error; err != nil {
			return err
		}
		for _, contact := range contacts {
			if contact.TemplateID == nil {
				continue
			}
			mappedID, ok := legacyToVaultTemplate[*contact.TemplateID]
			if !ok {
				if err := tx.Table("contacts").Where("id = ?", contact.ID).Update("template_id", nil).Error; err != nil {
					return err
				}
				continue
			}
			if err := tx.Table("contacts").Where("id = ?", contact.ID).Update("template_id", mappedID).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func hasLegacyContactLayoutTables(db *gorm.DB) bool {
	for _, table := range []string{"templates", "template_pages", "modules", "module_template_page"} {
		if !db.Migrator().HasTable(table) {
			return false
		}
	}
	return true
}

func migrateLegacyContactTemplatePages(tx *gorm.DB, legacyTemplateID, targetTemplateID uint) error {
	var pages []legacyContactTemplatePage
	if err := tx.Table("template_pages").Where("template_id = ?", legacyTemplateID).Order("position ASC, id ASC").Scan(&pages).Error; err != nil {
		return err
	}
	seenModules := make(map[string]struct{})
	for pageIndex, legacyPage := range pages {
		position := pageIndex
		if legacyPage.Position != nil {
			position = *legacyPage.Position
		}
		page := models.VaultContactTemplatePage{
			TemplateID:         targetTemplateID,
			Name:               legacyLayoutName(legacyPage.Name, legacyPage.NameTranslationKey, legacyPage.Slug),
			NameTranslationKey: legacyPage.NameTranslationKey,
			Slug:               legacyPage.Slug,
			Position:           position,
			Type:               dereferenceLegacyString(legacyPage.Type),
			Visible:            legacyPage.Visible,
		}
		if err := tx.Create(&page).Error; err != nil {
			return err
		}
		if !legacyPage.Visible {
			if err := tx.Model(&page).Update("visible", false).Error; err != nil {
				return err
			}
		}

		var placements []legacyContactModulePlacement
		if err := tx.Table("module_template_page").Where("template_page_id = ?", legacyPage.ID).Order("position ASC").Scan(&placements).Error; err != nil {
			return err
		}
		modulePosition := 0
		for _, legacyPlacement := range placements {
			var legacyModule legacyContactModule
			if err := tx.Table("modules").Where("id = ?", legacyPlacement.ModuleID).Scan(&legacyModule).Error; err != nil {
				return err
			}
			moduleKey := normalizedLegacyContactModuleKey(dereferenceLegacyString(legacyModule.Type))
			if moduleKey == "" || !models.IsContactModuleKey(moduleKey) {
				continue
			}
			if _, duplicate := seenModules[moduleKey]; duplicate {
				continue
			}
			seenModules[moduleKey] = struct{}{}
			placement := models.VaultContactTemplateModule{
				TemplateID:     targetTemplateID,
				TemplatePageID: page.ID,
				ModuleKey:      moduleKey,
				Position:       modulePosition,
			}
			if err := tx.Create(&placement).Error; err != nil {
				return err
			}
			modulePosition++
		}
	}
	return nil
}

func normalizedLegacyContactModuleKey(key string) string {
	switch key {
	case "avatar", "contact_names", "family_summary", "posts", "":
		return ""
	case "gender_pronoun":
		return ""
	case "religions":
		return "religion"
	case "company":
		return "jobs"
	default:
		return key
	}
}

func legacyLayoutName(name, translationKey *string, fallback string) string {
	if name != nil && strings.TrimSpace(*name) != "" {
		return strings.TrimSpace(*name)
	}
	if translationKey != nil && strings.TrimSpace(*translationKey) != "" {
		return strings.TrimSpace(*translationKey)
	}
	if strings.TrimSpace(fallback) != "" {
		return strings.TrimSpace(fallback)
	}
	return "Layout"
}

func dereferenceLegacyString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func normalizeUserViewPreferences(db *gorm.DB) error {
	updates := []struct {
		column   string
		fallback string
		allowed  []string
	}{
		{column: "contact_sort_order", fallback: "name", allowed: []string{"name", "first_met_at", "updated_at"}},
		{column: "dashboard_tab", fallback: "feed", allowed: []string{"feed", "activities", "life_metrics"}},
		{column: "task_view", fallback: "list", allowed: []string{"list", "kanban"}},
		{column: "task_sort", fallback: "custom", allowed: []string{"custom", "due_date"}},
		{column: "theme", fallback: "system", allowed: []string{"light", "dark", "system"}},
	}
	for _, update := range updates {
		if !hasColumn(db, "users", update.column) {
			continue
		}
		if err := db.Table("users").Where(update.column+" IS NULL OR "+update.column+" = '' OR "+update.column+" NOT IN ?", update.allowed).Update(update.column, update.fallback).Error; err != nil {
			return err
		}
	}
	if hasColumn(db, "users", "contact_list_columns") {
		if err := db.Table("users").Where("contact_list_columns IS NULL OR contact_list_columns = ''").Update("contact_list_columns", `["name","nickname","first_met_at","status","updated_at"]`).Error; err != nil {
			return err
		}
	}
	return nil
}
