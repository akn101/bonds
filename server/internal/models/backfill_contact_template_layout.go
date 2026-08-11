package models

import (
	"fmt"

	"github.com/naiba/bonds/internal/i18n"
	"gorm.io/gorm"
)

const (
	defaultContactSummaryModuleType                = "contact_summary"
	defaultContactSummaryModuleTranslationKey      = "seed.modules.contact_summary"
	defaultContactSummaryPageTranslationKey        = "seed.template_pages.summary"
	defaultContactSummaryPageSlug                  = "summary"
	defaultRelationshipNetworkModuleType           = "relationship_network"
	defaultRelationshipNetworkModuleTranslationKey = "seed.modules.relationship_network"
	defaultRelationshipNetworkPageTranslationKey   = "seed.template_pages.relationship_network"
	defaultRelationshipNetworkPageSlug             = "relationship-network"
)

type contactLayoutPageSpec struct {
	translationKey string
	slug           string
	moduleID       uint
	prepend        bool
}

// BackfillContactTemplateLayout moves the always-visible contact summary and
// relationship graph into the template system without hiding either feature
// after an upgrade. Missing Summary pages are prepended, while missing
// Relationship network pages are appended so existing custom page ordering is
// otherwise left intact. Repeated runs preserve names, positions and visibility.
func BackfillContactTemplateLayout(db *gorm.DB) error {
	var accountIDs []string
	if err := db.Model(&Account{}).Pluck("id", &accountIDs).Error; err != nil {
		return err
	}

	for _, accountID := range accountIDs {
		if err := db.Transaction(func(tx *gorm.DB) error {
			locale := contactLayoutLocale(tx, accountID)
			summaryModule, err := ensureContactLayoutModule(
				tx,
				accountID,
				locale,
				defaultContactSummaryModuleType,
				defaultContactSummaryModuleTranslationKey,
				true,
			)
			if err != nil {
				return err
			}
			networkModule, err := ensureContactLayoutModule(
				tx,
				accountID,
				locale,
				defaultRelationshipNetworkModuleType,
				defaultRelationshipNetworkModuleTranslationKey,
				false,
			)
			if err != nil {
				return err
			}

			var templates []Template
			if err := tx.Where("account_id = ?", accountID).Order("id ASC").Find(&templates).Error; err != nil {
				return err
			}
			for _, tmpl := range templates {
				for _, spec := range []contactLayoutPageSpec{
					{
						translationKey: defaultContactSummaryPageTranslationKey,
						slug:           defaultContactSummaryPageSlug,
						moduleID:       summaryModule.ID,
						prepend:        true,
					},
					{
						translationKey: defaultRelationshipNetworkPageTranslationKey,
						slug:           defaultRelationshipNetworkPageSlug,
						moduleID:       networkModule.ID,
					},
				} {
					if err := ensureContactLayoutPage(tx, tmpl.ID, locale, spec); err != nil {
						return err
					}
				}
			}
			return nil
		}); err != nil {
			return err
		}
	}

	return nil
}

func contactLayoutLocale(tx *gorm.DB, accountID string) string {
	var locale string
	_ = tx.Model(&User{}).
		Where("account_id = ?", accountID).
		Order("is_account_administrator DESC, created_at ASC").
		Limit(1).
		Pluck("locale", &locale).Error
	if locale == "" {
		return "en"
	}
	return locale
}

func ensureContactLayoutModule(
	tx *gorm.DB,
	accountID, locale, moduleType, translationKey string,
	reserved bool,
) (*Module, error) {
	var module Module
	err := tx.Where(
		"account_id = ? AND name_translation_key = ?",
		accountID,
		translationKey,
	).Order("id ASC").First(&module).Error
	if err == nil {
		updates := map[string]interface{}{
			"type":                            moduleType,
			"reserved_to_contact_information": reserved,
			"can_be_deleted":                  false,
		}
		if err := tx.Model(&module).Updates(updates).Error; err != nil {
			return nil, err
		}
		module.Type = strPtr(moduleType)
		module.ReservedToContactInformation = reserved
		module.CanBeDeleted = false
		return &module, nil
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err
	}

	module = Module{
		AccountID:                    accountID,
		Name:                         strPtr(i18n.T(locale, translationKey)),
		NameTranslationKey:           strPtr(translationKey),
		Type:                         strPtr(moduleType),
		ReservedToContactInformation: reserved,
	}
	if err := tx.Create(&module).Error; err != nil {
		return nil, err
	}
	if err := tx.Model(&module).Update("can_be_deleted", false).Error; err != nil {
		return nil, err
	}
	module.CanBeDeleted = false
	return &module, nil
}

func ensureContactLayoutPage(tx *gorm.DB, templateID uint, locale string, spec contactLayoutPageSpec) error {
	var page TemplatePage
	err := tx.Where(
		"template_id = ? AND name_translation_key = ?",
		templateID,
		spec.translationKey,
	).Order("id ASC").First(&page).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		return err
	}

	if err == gorm.ErrRecordNotFound {
		position, err := nextContactLayoutPagePosition(tx, templateID, spec.prepend)
		if err != nil {
			return err
		}
		slug, err := availableContactLayoutPageSlug(tx, templateID, spec.slug)
		if err != nil {
			return err
		}
		page = TemplatePage{
			TemplateID:         templateID,
			Name:               strPtr(i18n.T(locale, spec.translationKey)),
			NameTranslationKey: strPtr(spec.translationKey),
			Slug:               slug,
			Position:           &position,
		}
		if err := tx.Create(&page).Error; err != nil {
			return err
		}
	}

	if page.CanBeDeleted {
		if err := tx.Model(&page).Update("can_be_deleted", false).Error; err != nil {
			return err
		}
	}

	var bindingCount int64
	if err := tx.Model(&ModuleTemplatePage{}).
		Where("template_page_id = ? AND module_id = ?", page.ID, spec.moduleID).
		Count(&bindingCount).Error; err != nil {
		return err
	}
	if bindingCount > 0 {
		return nil
	}

	position := 1
	return tx.Create(&ModuleTemplatePage{
		TemplatePageID: page.ID,
		ModuleID:       spec.moduleID,
		Position:       &position,
	}).Error
}

func nextContactLayoutPagePosition(tx *gorm.DB, templateID uint, prepend bool) (int, error) {
	var positions []int
	if err := tx.Model(&TemplatePage{}).
		Where("template_id = ? AND position IS NOT NULL", templateID).
		Order("position ASC").
		Pluck("position", &positions).Error; err != nil {
		return 0, err
	}
	if len(positions) == 0 {
		return 1, nil
	}
	if prepend {
		return positions[0] - 1, nil
	}
	return positions[len(positions)-1] + 1, nil
}

func availableContactLayoutPageSlug(tx *gorm.DB, templateID uint, base string) (string, error) {
	for suffix := 0; ; suffix++ {
		slug := base
		if suffix > 0 {
			slug = fmt.Sprintf("%s-system-%d", base, suffix)
		}
		var count int64
		if err := tx.Model(&TemplatePage{}).
			Where("template_id = ? AND slug = ?", templateID, slug).
			Count(&count).Error; err != nil {
			return "", err
		}
		if count == 0 {
			return slug, nil
		}
	}
}
