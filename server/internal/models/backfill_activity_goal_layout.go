package models

import (
	"fmt"

	"github.com/naiba/bonds/internal/i18n"
	"gorm.io/gorm"
)

const (
	activitiesPageTranslationKey = "seed.template_pages.activities"
	activitiesPageSlug           = "activities"
	goalsPageTranslationKey      = "seed.template_pages.goals"
	goalsPageSlug                = "goals"
)

// BackfillActivityGoalLayout upgrades the former combined Life & goals page.
// It renames the page containing the system Activities module and moves the
// system Goals module to its own page. The module IDs and bindings are reused,
// so contacts keep their data and custom templates remain structurally intact
// apart from the requested domain split.
func BackfillActivityGoalLayout(db *gorm.DB) error {
	var accountIDs []string
	if err := db.Model(&Account{}).Pluck("id", &accountIDs).Error; err != nil {
		return err
	}
	for _, accountID := range accountIDs {
		if err := db.Transaction(func(tx *gorm.DB) error {
			locale := contactLayoutLocale(tx, accountID)
			activityModule, err := findSystemModuleByType(tx, accountID, "activities")
			if err != nil {
				return err
			}
			goalsModule, err := findSystemModuleByType(tx, accountID, "goals")
			if err != nil {
				return err
			}
			if activityModule == nil || goalsModule == nil {
				return nil
			}

			var templates []Template
			if err := tx.Where("account_id = ?", accountID).Order("id ASC").Find(&templates).Error; err != nil {
				return err
			}
			for _, tmpl := range templates {
				if err := splitTemplateActivitiesAndGoals(tx, tmpl.ID, locale, activityModule.ID, goalsModule.ID); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			return err
		}
	}
	return nil
}

func findSystemModuleByType(tx *gorm.DB, accountID, moduleType string) (*Module, error) {
	var module Module
	err := tx.Where("account_id = ? AND type = ?", accountID, moduleType).Order("can_be_deleted ASC, id ASC").First(&module).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &module, nil
}

func splitTemplateActivitiesAndGoals(tx *gorm.DB, templateID uint, locale string, activityModuleID, goalsModuleID uint) error {
	activityPage, err := pageContainingModule(tx, templateID, activityModuleID)
	if err != nil {
		return err
	}
	goalsPage, err := pageContainingModule(tx, templateID, goalsModuleID)
	if err != nil {
		return err
	}
	if activityPage == nil && goalsPage == nil {
		return nil
	}
	if activityPage == nil {
		return renameLegacyActivityGoalPage(tx, goalsPage, templateID, locale, goalsPageTranslationKey, goalsPageSlug)
	}

	if err := renameLegacyActivityGoalPage(tx, activityPage, templateID, locale, activitiesPageTranslationKey, activitiesPageSlug); err != nil {
		return err
	}

	// Preserve custom template choices: a template that did not include Goals
	// before the upgrade should not gain it merely because Activities was
	// renamed. Only split the modules when Goals was actually present.
	if goalsPage == nil {
		return nil
	}
	if goalsPage != nil && goalsPage.ID != activityPage.ID {
		return renameLegacyActivityGoalPage(tx, goalsPage, templateID, locale, goalsPageTranslationKey, goalsPageSlug)
	}

	var existingGoalsPage TemplatePage
	err = tx.Where("template_id = ? AND name_translation_key = ?", templateID, goalsPageTranslationKey).Order("id ASC").First(&existingGoalsPage).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		return err
	}
	if err == gorm.ErrRecordNotFound {
		position := 1
		if activityPage.Position != nil {
			position = *activityPage.Position + 1
			if err := tx.Model(&TemplatePage{}).
				Where("template_id = ? AND position >= ? AND id <> ?", templateID, position, activityPage.ID).
				Update("position", gorm.Expr("position + 1")).Error; err != nil {
				return err
			}
		}
		slug, err := availableContactLayoutPageSlug(tx, templateID, goalsPageSlug)
		if err != nil {
			return err
		}
		existingGoalsPage = TemplatePage{
			TemplateID:         templateID,
			Name:               strPtr(i18n.T(locale, goalsPageTranslationKey)),
			NameTranslationKey: strPtr(goalsPageTranslationKey),
			Slug:               slug,
			Position:           &position,
		}
		if err := tx.Create(&existingGoalsPage).Error; err != nil {
			return err
		}
	}

	return tx.Model(&ModuleTemplatePage{}).
		Where("template_page_id = ? AND module_id = ?", goalsPage.ID, goalsModuleID).
		Updates(map[string]interface{}{"template_page_id": existingGoalsPage.ID, "position": 1}).Error
}

func renameLegacyActivityGoalPage(tx *gorm.DB, page *TemplatePage, templateID uint, locale, translationKey, baseSlug string) error {
	if page == nil {
		return nil
	}
	legacyTranslationKey := page.NameTranslationKey != nil && *page.NameTranslationKey == "seed.template_pages.life_and_goals"
	if page.Slug != "life-goals" && !legacyTranslationKey {
		return nil
	}
	slug, err := availableContactLayoutPageSlugExcluding(tx, templateID, baseSlug, page.ID)
	if err != nil {
		return err
	}
	page.Slug = slug
	return tx.Model(page).Updates(map[string]interface{}{
		"name":                 i18n.T(locale, translationKey),
		"name_translation_key": translationKey,
		"slug":                 slug,
	}).Error
}

func pageContainingModule(tx *gorm.DB, templateID, moduleID uint) (*TemplatePage, error) {
	var page TemplatePage
	err := tx.Joins("JOIN module_template_page ON module_template_page.template_page_id = template_pages.id").
		Where("template_pages.template_id = ? AND module_template_page.module_id = ?", templateID, moduleID).
		Order("template_pages.position ASC, template_pages.id ASC").First(&page).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &page, nil
}

func availableContactLayoutPageSlugExcluding(tx *gorm.DB, templateID uint, base string, excludedPageID uint) (string, error) {
	for suffix := 0; ; suffix++ {
		slug := base
		if suffix > 0 {
			slug = fmt.Sprintf("%s-system-%d", base, suffix)
		}
		var count int64
		if err := tx.Model(&TemplatePage{}).
			Where("template_id = ? AND slug = ? AND id <> ?", templateID, slug, excludedPageID).
			Count(&count).Error; err != nil {
			return "", err
		}
		if count == 0 {
			return slug, nil
		}
	}
}
