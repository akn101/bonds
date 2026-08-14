package services

import (
	"errors"
	"regexp"
	"strings"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/i18n"
	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

var (
	ErrContactLayoutNotFound   = errors.New("contact layout not found")
	ErrContactLayoutConflict   = errors.New("contact layout was updated by another user")
	ErrContactLayoutInvalid    = errors.New("invalid contact layout")
	ErrContactLayoutInUse      = errors.New("contact layout is in use")
	ErrContactLayoutIsDefault  = errors.New("default contact layout cannot be deleted")
	ErrContactLayoutNameExists = errors.New("contact layout name already exists")
)

var contactLayoutSlugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

type ContactLayoutService struct {
	db *gorm.DB
}

func NewContactLayoutService(db *gorm.DB) *ContactLayoutService {
	return &ContactLayoutService{db: db}
}

func (s *ContactLayoutService) ModuleDefinitions(locale string) []dto.ContactLayoutModuleDefinition {
	result := make([]dto.ContactLayoutModuleDefinition, len(models.ContactModuleDefinitions))
	for index, definition := range models.ContactModuleDefinitions {
		result[index] = dto.ContactLayoutModuleDefinition{
			Key:  definition.Key,
			Name: i18n.T(locale, definition.TranslationKey),
		}
	}
	return result
}

func (s *ContactLayoutService) List(vaultID, locale string) ([]dto.ContactLayoutTemplateSummary, error) {
	var vault models.Vault
	if err := s.db.Select("id", "default_template_id").First(&vault, "id = ?", vaultID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrVaultNotFound
		}
		return nil, err
	}
	var templates []models.VaultContactTemplate
	if err := s.db.Where("vault_id = ?", vaultID).Order("can_be_deleted ASC, name ASC, id ASC").Find(&templates).Error; err != nil {
		return nil, err
	}
	result := make([]dto.ContactLayoutTemplateSummary, len(templates))
	for index := range templates {
		summary, err := s.templateSummary(&templates[index], vault.DefaultTemplateID, locale)
		if err != nil {
			return nil, err
		}
		result[index] = summary
	}
	return result, nil
}

func (s *ContactLayoutService) Get(vaultID string, templateID uint, locale string) (*dto.ContactLayoutResponse, error) {
	var template models.VaultContactTemplate
	if err := s.db.Where("id = ? AND vault_id = ?", templateID, vaultID).First(&template).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrContactLayoutNotFound
		}
		return nil, err
	}
	return s.toLayoutResponse(&template, locale)
}

func (s *ContactLayoutService) Create(vaultID, locale string, req dto.CreateContactLayoutTemplateRequest) (*dto.ContactLayoutResponse, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, ErrContactLayoutInvalid
	}
	if err := s.ensureNameAvailable(vaultID, name, 0); err != nil {
		return nil, err
	}

	var source models.VaultContactTemplate
	if req.SourceTemplateID != nil {
		if err := s.db.Where("id = ? AND vault_id = ?", *req.SourceTemplateID, vaultID).First(&source).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, ErrContactLayoutNotFound
			}
			return nil, err
		}
	} else {
		var vault models.Vault
		if err := s.db.Select("default_template_id").First(&vault, "id = ?", vaultID).Error; err != nil {
			return nil, err
		}
		if vault.DefaultTemplateID == nil {
			return nil, ErrContactLayoutNotFound
		}
		if err := s.db.Where("id = ? AND vault_id = ?", *vault.DefaultTemplateID, vaultID).First(&source).Error; err != nil {
			return nil, err
		}
	}

	template := models.VaultContactTemplate{VaultID: vaultID, Name: name, Revision: 1, CanBeDeleted: true}
	if err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&template).Error; err != nil {
			return err
		}
		return cloneContactLayoutPages(tx, source.ID, template.ID)
	}); err != nil {
		return nil, err
	}
	return s.toLayoutResponse(&template, locale)
}

func (s *ContactLayoutService) Rename(vaultID string, templateID uint, req dto.UpdateContactLayoutTemplateRequest, locale string) (*dto.ContactLayoutResponse, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, ErrContactLayoutInvalid
	}
	if err := s.ensureNameAvailable(vaultID, name, templateID); err != nil {
		return nil, err
	}
	result := s.db.Model(&models.VaultContactTemplate{}).
		Where("id = ? AND vault_id = ?", templateID, vaultID).
		Updates(map[string]interface{}{"name": name, "name_translation_key": nil})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, ErrContactLayoutNotFound
	}
	return s.Get(vaultID, templateID, locale)
}

func (s *ContactLayoutService) Save(vaultID string, templateID uint, req dto.SaveContactLayoutRequest, locale string) (*dto.ContactLayoutResponse, error) {
	if err := validateContactLayout(req.Pages); err != nil {
		return nil, err
	}
	if err := s.db.Transaction(func(tx *gorm.DB) error {
		updated := tx.Model(&models.VaultContactTemplate{}).
			Where("id = ? AND vault_id = ? AND revision = ?", templateID, vaultID, req.ExpectedRevision).
			Update("revision", gorm.Expr("revision + 1"))
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected == 0 {
			var count int64
			if err := tx.Model(&models.VaultContactTemplate{}).Where("id = ? AND vault_id = ?", templateID, vaultID).Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				return ErrContactLayoutNotFound
			}
			return ErrContactLayoutConflict
		}

		var existingPages []models.VaultContactTemplatePage
		if err := tx.Where("template_id = ?", templateID).Find(&existingPages).Error; err != nil {
			return err
		}
		existingPagesByID := make(map[uint]models.VaultContactTemplatePage, len(existingPages))
		pageIDs := make([]uint, 0, len(existingPages))
		for _, existingPage := range existingPages {
			existingPagesByID[existingPage.ID] = existingPage
			pageIDs = append(pageIDs, existingPage.ID)
		}
		if len(pageIDs) > 0 {
			if err := tx.Where("template_page_id IN ?", pageIDs).Delete(&models.VaultContactTemplateModule{}).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("template_id = ?", templateID).Delete(&models.VaultContactTemplatePage{}).Error; err != nil {
			return err
		}

		usedPageIDs := make(map[uint]struct{}, len(req.Pages))
		for pageIndex, inputPage := range req.Pages {
			var nameTranslationKey *string
			pageName := strings.TrimSpace(inputPage.Name)
			if inputPage.ID != nil {
				existingPage, exists := existingPagesByID[*inputPage.ID]
				if !exists {
					return ErrContactLayoutInvalid
				}
				if _, duplicate := usedPageIDs[*inputPage.ID]; duplicate {
					return ErrContactLayoutInvalid
				}
				usedPageIDs[*inputPage.ID] = struct{}{}
				if existingPage.NameTranslationKey != nil &&
					strings.TrimSpace(inputPage.Name) == i18n.T(locale, *existingPage.NameTranslationKey) {
					nameTranslationKey = existingPage.NameTranslationKey
					pageName = existingPage.Name
				}
			}
			page := models.VaultContactTemplatePage{
				TemplateID:         templateID,
				Name:               pageName,
				NameTranslationKey: nameTranslationKey,
				Slug:               strings.TrimSpace(inputPage.Slug),
				Position:           pageIndex,
				Type:               strings.TrimSpace(inputPage.Type),
				Visible:            inputPage.Visible,
			}
			if err := tx.Create(&page).Error; err != nil {
				return err
			}
			for moduleIndex, inputModule := range inputPage.Modules {
				module := models.VaultContactTemplateModule{
					TemplateID:     templateID,
					TemplatePageID: page.ID,
					ModuleKey:      strings.TrimSpace(inputModule.Key),
					Position:       moduleIndex,
				}
				if err := tx.Create(&module).Error; err != nil {
					return err
				}
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return s.Get(vaultID, templateID, locale)
}

func (s *ContactLayoutService) SetDefault(vaultID string, templateID uint) error {
	var count int64
	if err := s.db.Model(&models.VaultContactTemplate{}).Where("id = ? AND vault_id = ?", templateID, vaultID).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return ErrContactLayoutNotFound
	}
	return s.db.Model(&models.Vault{}).Where("id = ?", vaultID).Update("default_template_id", templateID).Error
}

func (s *ContactLayoutService) Delete(vaultID string, templateID uint) error {
	var vault models.Vault
	if err := s.db.Select("default_template_id").First(&vault, "id = ?", vaultID).Error; err != nil {
		return err
	}
	if vault.DefaultTemplateID != nil && *vault.DefaultTemplateID == templateID {
		return ErrContactLayoutIsDefault
	}
	var contactCount int64
	if err := s.db.Model(&models.Contact{}).Where("vault_id = ? AND template_id = ?", vaultID, templateID).Count(&contactCount).Error; err != nil {
		return err
	}
	if contactCount > 0 {
		return ErrContactLayoutInUse
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		var template models.VaultContactTemplate
		if err := tx.Where("id = ? AND vault_id = ?", templateID, vaultID).First(&template).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrContactLayoutNotFound
			}
			return err
		}
		if !template.CanBeDeleted {
			return ErrContactLayoutIsDefault
		}
		var pageIDs []uint
		if err := tx.Model(&models.VaultContactTemplatePage{}).Where("template_id = ?", templateID).Pluck("id", &pageIDs).Error; err != nil {
			return err
		}
		if len(pageIDs) > 0 {
			if err := tx.Where("template_page_id IN ?", pageIDs).Delete(&models.VaultContactTemplateModule{}).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("template_id = ?", templateID).Delete(&models.VaultContactTemplatePage{}).Error; err != nil {
			return err
		}
		return tx.Delete(&template).Error
	})
}

func validateContactLayout(pages []dto.SaveContactLayoutPageRequest) error {
	if len(pages) == 0 || len(pages) > 20 {
		return ErrContactLayoutInvalid
	}
	slugs := make(map[string]struct{}, len(pages))
	moduleKeys := make(map[string]struct{})
	visiblePages := 0
	for _, page := range pages {
		name := strings.TrimSpace(page.Name)
		slug := strings.TrimSpace(page.Slug)
		if name == "" || len(name) > 100 || !contactLayoutSlugPattern.MatchString(slug) {
			return ErrContactLayoutInvalid
		}
		if _, exists := slugs[slug]; exists {
			return ErrContactLayoutInvalid
		}
		slugs[slug] = struct{}{}
		if page.Visible {
			visiblePages++
		}
		for _, module := range page.Modules {
			key := strings.TrimSpace(module.Key)
			if !models.IsContactModuleKey(key) {
				return ErrContactLayoutInvalid
			}
			if _, exists := moduleKeys[key]; exists {
				return ErrContactLayoutInvalid
			}
			moduleKeys[key] = struct{}{}
		}
	}
	if visiblePages == 0 {
		return ErrContactLayoutInvalid
	}
	return nil
}

func cloneContactLayoutPages(tx *gorm.DB, sourceTemplateID, targetTemplateID uint) error {
	var pages []models.VaultContactTemplatePage
	if err := tx.Where("template_id = ?", sourceTemplateID).Order("position ASC, id ASC").Find(&pages).Error; err != nil {
		return err
	}
	for _, sourcePage := range pages {
		page := sourcePage
		page.ID = 0
		page.TemplateID = targetTemplateID
		page.CreatedAt = timeZero
		page.UpdatedAt = timeZero
		if err := tx.Create(&page).Error; err != nil {
			return err
		}
		var modules []models.VaultContactTemplateModule
		if err := tx.Where("template_page_id = ?", sourcePage.ID).Order("position ASC, id ASC").Find(&modules).Error; err != nil {
			return err
		}
		for _, sourceModule := range modules {
			module := sourceModule
			module.ID = 0
			module.TemplateID = targetTemplateID
			module.TemplatePageID = page.ID
			module.CreatedAt = timeZero
			module.UpdatedAt = timeZero
			if err := tx.Create(&module).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

var timeZero = models.VaultContactTemplate{}.CreatedAt

func (s *ContactLayoutService) ensureNameAvailable(vaultID, name string, exceptID uint) error {
	query := s.db.Model(&models.VaultContactTemplate{}).
		Where("vault_id = ? AND normalized_name = ?", vaultID, strings.ToLower(strings.TrimSpace(name)))
	if exceptID != 0 {
		query = query.Where("id <> ?", exceptID)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return ErrContactLayoutNameExists
	}
	return nil
}

func (s *ContactLayoutService) templateSummary(template *models.VaultContactTemplate, defaultTemplateID *uint, locale string) (dto.ContactLayoutTemplateSummary, error) {
	var contactCount int64
	if err := s.db.Model(&models.Contact{}).Where("vault_id = ? AND template_id = ?", template.VaultID, template.ID).Count(&contactCount).Error; err != nil {
		return dto.ContactLayoutTemplateSummary{}, err
	}
	name := template.Name
	if template.NameTranslationKey != nil && *template.NameTranslationKey != "" {
		name = i18n.T(locale, *template.NameTranslationKey)
	}
	return dto.ContactLayoutTemplateSummary{
		ID:           template.ID,
		VaultID:      template.VaultID,
		Name:         name,
		Revision:     template.Revision,
		CanBeDeleted: template.CanBeDeleted,
		IsDefault:    defaultTemplateID != nil && *defaultTemplateID == template.ID,
		ContactCount: contactCount,
	}, nil
}

func (s *ContactLayoutService) toLayoutResponse(template *models.VaultContactTemplate, locale string) (*dto.ContactLayoutResponse, error) {
	var vault models.Vault
	if err := s.db.Select("default_template_id").First(&vault, "id = ?", template.VaultID).Error; err != nil {
		return nil, err
	}
	summary, err := s.templateSummary(template, vault.DefaultTemplateID, locale)
	if err != nil {
		return nil, err
	}
	var pages []models.VaultContactTemplatePage
	if err := s.db.Where("template_id = ?", template.ID).Order("position ASC, id ASC").Find(&pages).Error; err != nil {
		return nil, err
	}
	moduleNames := make(map[string]string, len(models.ContactModuleDefinitions))
	for _, definition := range models.ContactModuleDefinitions {
		moduleNames[definition.Key] = i18n.T(locale, definition.TranslationKey)
	}
	responsePages := make([]dto.ContactLayoutPage, len(pages))
	for pageIndex, page := range pages {
		pageName := page.Name
		if page.NameTranslationKey != nil && *page.NameTranslationKey != "" {
			pageName = i18n.T(locale, *page.NameTranslationKey)
		}
		var modules []models.VaultContactTemplateModule
		if err := s.db.Where("template_page_id = ?", page.ID).Order("position ASC, id ASC").Find(&modules).Error; err != nil {
			return nil, err
		}
		responseModules := make([]dto.ContactLayoutModule, len(modules))
		for moduleIndex, module := range modules {
			responseModules[moduleIndex] = dto.ContactLayoutModule{
				ID:       module.ID,
				Key:      module.ModuleKey,
				Name:     moduleNames[module.ModuleKey],
				Position: module.Position,
			}
		}
		responsePages[pageIndex] = dto.ContactLayoutPage{
			ID:       page.ID,
			Name:     pageName,
			Slug:     page.Slug,
			Position: page.Position,
			Type:     page.Type,
			Visible:  page.Visible,
			Modules:  responseModules,
		}
	}
	return &dto.ContactLayoutResponse{ContactLayoutTemplateSummary: summary, Pages: responsePages}, nil
}
