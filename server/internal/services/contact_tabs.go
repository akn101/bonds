package services

import (
	"errors"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/i18n"
	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

type ContactTabService struct {
	db *gorm.DB
}

func NewContactTabService(db *gorm.DB) *ContactTabService {
	return &ContactTabService{db: db}
}

func (s *ContactTabService) GetTabs(contactID, vaultID, locale string) (*dto.ContactTabsResponse, error) {
	var contact models.Contact
	if err := s.db.Select("id", "vault_id", "template_id").Where("id = ? AND vault_id = ?", contactID, vaultID).First(&contact).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrContactNotFound
		}
		return nil, err
	}

	var vault models.Vault
	if err := s.db.Select("default_template_id").First(&vault, "id = ?", vaultID).Error; err != nil {
		return nil, err
	}
	templateID := vault.DefaultTemplateID
	if contact.TemplateID != nil {
		templateID = contact.TemplateID
	}
	if templateID == nil {
		return nil, ErrContactLayoutNotFound
	}

	var template models.VaultContactTemplate
	if err := s.db.Where("id = ? AND vault_id = ?", *templateID, vaultID).First(&template).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) && contact.TemplateID != nil && vault.DefaultTemplateID != nil {
			if fallbackErr := s.db.Where("id = ? AND vault_id = ?", *vault.DefaultTemplateID, vaultID).First(&template).Error; fallbackErr != nil {
				if errors.Is(fallbackErr, gorm.ErrRecordNotFound) {
					return nil, ErrContactLayoutNotFound
				}
				return nil, fallbackErr
			}
		} else if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrContactLayoutNotFound
		} else {
			return nil, err
		}
	}

	var pages []models.VaultContactTemplatePage
	if err := s.db.Where("template_id = ? AND visible = ?", template.ID, true).Order("position ASC, id ASC").Find(&pages).Error; err != nil {
		return nil, err
	}
	templateName := template.Name
	if template.NameTranslationKey != nil && *template.NameTranslationKey != "" {
		templateName = i18n.T(locale, *template.NameTranslationKey)
	}
	moduleNames := make(map[string]string, len(models.ContactModuleDefinitions))
	for _, definition := range models.ContactModuleDefinitions {
		moduleNames[definition.Key] = i18n.T(locale, definition.TranslationKey)
	}

	result := &dto.ContactTabsResponse{
		TemplateID:   template.ID,
		TemplateName: templateName,
		Pages:        make([]dto.ContactTabPage, len(pages)),
	}
	for pageIndex, page := range pages {
		var placements []models.VaultContactTemplateModule
		if err := s.db.Where("template_page_id = ?", page.ID).Order("position ASC, id ASC").Find(&placements).Error; err != nil {
			return nil, err
		}
		modules := make([]dto.ContactTabModule, len(placements))
		for moduleIndex, placement := range placements {
			modules[moduleIndex] = dto.ContactTabModule{
				ID:       placement.ID,
				Name:     moduleNames[placement.ModuleKey],
				Type:     placement.ModuleKey,
				Position: placement.Position,
			}
		}
		pageName := page.Name
		if page.NameTranslationKey != nil && *page.NameTranslationKey != "" {
			pageName = i18n.T(locale, *page.NameTranslationKey)
		}
		result.Pages[pageIndex] = dto.ContactTabPage{
			ID:       page.ID,
			Name:     pageName,
			Slug:     page.Slug,
			Position: page.Position,
			Type:     page.Type,
			Modules:  modules,
		}
	}
	return result, nil
}
