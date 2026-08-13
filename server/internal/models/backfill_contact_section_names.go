package models

import (
	"github.com/naiba/bonds/internal/i18n"
	"gorm.io/gorm"
)

type contactSectionNameSpec struct {
	translationKey string
	legacyNames    map[string]string
}

var contactSectionNameSpecs = []contactSectionNameSpec{
	{
		translationKey: "seed.template_pages.contact_information",
		legacyNames: map[string]string{
			"en":    "Contact information",
			"zh":    "联系人信息",
			"es":    "Información de contacto",
			"fr":    "Coordonnées",
			"de":    "Kontaktinformationen",
			"pt-BR": "Informações de contato",
			"pt-PT": "Informações de contacto",
		},
	},
	{
		translationKey: "seed.template_pages.information",
		legacyNames: map[string]string{
			"en":    "Information",
			"zh":    "资料",
			"es":    "Información",
			"fr":    "Information",
			"de":    "Informationen",
			"pt-BR": "Informações",
			"pt-PT": "Informação",
		},
	},
}

// BackfillContactSectionNames clarifies the two previously ambiguous default
// contact-section names. Only rows whose translation key and rendered name
// still match an old shipped default are changed, so user-renamed pages remain
// untouched. Repeated runs are no-ops after the first successful update.
func BackfillContactSectionNames(db *gorm.DB) error {
	var accountIDs []string
	if err := db.Model(&Account{}).Pluck("id", &accountIDs).Error; err != nil {
		return err
	}
	for _, accountID := range accountIDs {
		locale := contactLayoutLocale(db, accountID)
		for _, spec := range contactSectionNameSpecs {
			legacyNames := make([]string, 0, len(spec.legacyNames))
			for _, name := range spec.legacyNames {
				legacyNames = append(legacyNames, name)
			}
			if err := db.Model(&TemplatePage{}).
				Where("template_id IN (SELECT id FROM templates WHERE account_id = ?)", accountID).
				Where("name_translation_key = ? AND name IN ?", spec.translationKey, legacyNames).
				Update("name", i18n.T(locale, spec.translationKey)).Error; err != nil {
				return err
			}
		}
	}
	return nil
}
