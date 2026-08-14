package models

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

var ErrInvalidContactLayoutModule = errors.New("contact layout module must use a registered key and belong to its template")

type ContactModuleDefinition struct {
	Key            string
	TranslationKey string
}

// ContactModuleDefinitions is the stable registry understood by the web
// renderer. Database layouts reference these keys and never translated names.
var ContactModuleDefinitions = []ContactModuleDefinition{
	{Key: "contact_summary", TranslationKey: "seed.modules.contact_summary"},
	{Key: "important_dates", TranslationKey: "seed.modules.important_dates"},
	{Key: "labels", TranslationKey: "seed.modules.labels"},
	{Key: "quick_facts", TranslationKey: "seed.modules.quick_facts"},
	{Key: "extra_information", TranslationKey: "seed.template_pages.contact_information"},
	{Key: "addresses", TranslationKey: "seed.modules.addresses"},
	{Key: "contact_information", TranslationKey: "seed.modules.contact_information"},
	{Key: "feed", TranslationKey: "seed.modules.contact_feed"},
	{Key: "relationships", TranslationKey: "seed.modules.relationships"},
	{Key: "relationship_network", TranslationKey: "seed.modules.relationship_network"},
	{Key: "pets", TranslationKey: "seed.modules.pets"},
	{Key: "groups", TranslationKey: "seed.modules.groups"},
	{Key: "activities", TranslationKey: "seed.modules.activities"},
	{Key: "goals", TranslationKey: "seed.modules.goals"},
	{Key: "documents", TranslationKey: "seed.modules.documents"},
	{Key: "photos", TranslationKey: "seed.modules.photos"},
	{Key: "notes", TranslationKey: "seed.modules.notes"},
	{Key: "reminders", TranslationKey: "seed.modules.reminders"},
	{Key: "loans", TranslationKey: "seed.modules.loans"},
	{Key: "gifts", TranslationKey: "seed.modules.gifts"},
	{Key: "tasks", TranslationKey: "seed.modules.tasks"},
	{Key: "calls", TranslationKey: "seed.modules.calls"},
}

func IsContactModuleKey(key string) bool {
	for _, definition := range ContactModuleDefinitions {
		if definition.Key == key {
			return true
		}
	}
	return false
}

// VaultContactTemplate is a reusable contact view owned by exactly one vault.
// Contacts may select a template from their own vault; there are no per-user
// or per-contact layout overrides.
type VaultContactTemplate struct {
	ID                 uint      `json:"id" gorm:"primaryKey;autoIncrement"`
	VaultID            string    `json:"vault_id" gorm:"type:text;not null;index;uniqueIndex:idx_vault_contact_template_name_key"`
	Name               string    `json:"name" gorm:"not null"`
	NormalizedName     string    `json:"-" gorm:"column:normalized_name;not null;uniqueIndex:idx_vault_contact_template_name_key"`
	NameTranslationKey *string   `json:"name_translation_key" gorm:"type:text"`
	Revision           uint      `json:"revision" gorm:"not null;default:1"`
	CanBeDeleted       bool      `json:"can_be_deleted" gorm:"not null"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`

	Vault Vault                      `json:"vault,omitempty" gorm:"foreignKey:VaultID"`
	Pages []VaultContactTemplatePage `json:"pages,omitempty" gorm:"foreignKey:TemplateID"`
}

func (VaultContactTemplate) TableName() string {
	return "vault_contact_templates"
}

func (t *VaultContactTemplate) BeforeSave(_ *gorm.DB) error {
	t.Name = strings.TrimSpace(t.Name)
	t.NormalizedName = strings.ToLower(t.Name)
	return nil
}

// VaultContactTemplatePage is a navigable section in a contact view. A hidden
// page and all of its modules are excluded server-side from the effective view.
type VaultContactTemplatePage struct {
	ID                 uint      `json:"id" gorm:"primaryKey;autoIncrement"`
	TemplateID         uint      `json:"template_id" gorm:"not null;index;uniqueIndex:idx_vault_contact_page_slug"`
	Name               string    `json:"name" gorm:"not null"`
	NameTranslationKey *string   `json:"name_translation_key" gorm:"type:text"`
	Slug               string    `json:"slug" gorm:"size:96;not null;uniqueIndex:idx_vault_contact_page_slug"`
	Position           int       `json:"position" gorm:"not null"`
	Type               string    `json:"type" gorm:"size:32"`
	Visible            bool      `json:"visible" gorm:"not null"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`

	Template VaultContactTemplate         `json:"template,omitempty" gorm:"foreignKey:TemplateID"`
	Modules  []VaultContactTemplateModule `json:"modules,omitempty" gorm:"foreignKey:TemplatePageID"`
}

func (VaultContactTemplatePage) TableName() string {
	return "vault_contact_template_pages"
}

// VaultContactTemplateModule stores only layout state. Module identity and
// display metadata live in the code registry so upgrades never depend on a
// translated or user-editable database name.
type VaultContactTemplateModule struct {
	ID             uint      `json:"id" gorm:"primaryKey;autoIncrement"`
	TemplateID     uint      `json:"template_id" gorm:"not null;index;uniqueIndex:idx_vault_contact_template_module"`
	TemplatePageID uint      `json:"template_page_id" gorm:"not null;index;uniqueIndex:idx_vault_contact_page_module"`
	ModuleKey      string    `json:"module_key" gorm:"size:96;not null;uniqueIndex:idx_vault_contact_page_module;uniqueIndex:idx_vault_contact_template_module"`
	Position       int       `json:"position" gorm:"not null"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`

	TemplatePage VaultContactTemplatePage `json:"template_page,omitempty" gorm:"foreignKey:TemplatePageID"`
}

func (VaultContactTemplateModule) TableName() string {
	return "vault_contact_template_modules"
}

func (m *VaultContactTemplateModule) BeforeSave(tx *gorm.DB) error {
	if !IsContactModuleKey(m.ModuleKey) {
		return fmt.Errorf("%w: unknown module %q", ErrInvalidContactLayoutModule, m.ModuleKey)
	}
	if m.TemplateID == 0 || m.TemplatePageID == 0 || !tx.Migrator().HasTable(&VaultContactTemplatePage{}) {
		return nil
	}
	var count int64
	if err := tx.Model(&VaultContactTemplatePage{}).
		Where("id = ? AND template_id = ?", m.TemplatePageID, m.TemplateID).
		Count(&count).Error; err != nil {
		return err
	}
	if count != 1 {
		return fmt.Errorf("%w: page %d, template %d", ErrInvalidContactLayoutModule, m.TemplatePageID, m.TemplateID)
	}
	return nil
}

type defaultContactPageDefinition struct {
	TranslationKey string
	Slug           string
	Type           string
	ModuleKeys     []string
}

var defaultContactPageDefinitions = []defaultContactPageDefinition{
	{TranslationKey: "seed.template_pages.summary", Slug: "summary", ModuleKeys: []string{"contact_summary"}},
	{TranslationKey: "seed.template_pages.contact_information", Slug: "contact", Type: "contact", ModuleKeys: []string{"important_dates", "labels", "quick_facts", "extra_information", "addresses", "contact_information"}},
	{TranslationKey: "seed.template_pages.feed", Slug: "feed", ModuleKeys: []string{"feed"}},
	{TranslationKey: "seed.template_pages.social", Slug: "social", ModuleKeys: []string{"relationships", "pets", "groups"}},
	{TranslationKey: "seed.template_pages.relationship_network", Slug: "relationship-network", ModuleKeys: []string{"relationship_network"}},
	{TranslationKey: "seed.template_pages.activities", Slug: "activities", ModuleKeys: []string{"activities"}},
	{TranslationKey: "seed.template_pages.goals", Slug: "goals", ModuleKeys: []string{"goals"}},
	{TranslationKey: "seed.template_pages.information", Slug: "information", ModuleKeys: []string{"documents", "photos", "notes", "reminders", "loans", "gifts", "tasks", "calls"}},
}

func SeedVaultContactLayout(tx *gorm.DB, vaultID string) error {
	templateKey := "seed.templates.default_template"
	template := VaultContactTemplate{
		VaultID:            vaultID,
		Name:               "Default template",
		NameTranslationKey: &templateKey,
		Revision:           1,
		CanBeDeleted:       false,
	}
	if err := tx.Create(&template).Error; err != nil {
		return err
	}
	for pageIndex, definition := range defaultContactPageDefinitions {
		translationKey := definition.TranslationKey
		page := VaultContactTemplatePage{
			TemplateID:         template.ID,
			Name:               definition.Slug,
			NameTranslationKey: &translationKey,
			Slug:               definition.Slug,
			Position:           pageIndex,
			Type:               definition.Type,
			Visible:            true,
		}
		if err := tx.Create(&page).Error; err != nil {
			return err
		}
		for moduleIndex, moduleKey := range definition.ModuleKeys {
			placement := VaultContactTemplateModule{
				TemplateID:     template.ID,
				TemplatePageID: page.ID,
				ModuleKey:      moduleKey,
				Position:       moduleIndex,
			}
			if err := tx.Create(&placement).Error; err != nil {
				return err
			}
		}
	}

	return tx.Model(&Vault{}).Where("id = ?", vaultID).Update("default_template_id", template.ID).Error
}
