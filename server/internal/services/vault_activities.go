package services

import (
	"errors"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

type VaultActivityService struct {
	db *gorm.DB
}

func NewVaultActivityService(db *gorm.DB) *VaultActivityService {
	return &VaultActivityService{db: db}
}

func (s *VaultActivityService) ListCategories(vaultID string) ([]dto.ActivityCategoryResponse, error) {
	var cats []models.ActivityCategory
	if err := s.db.Where("vault_id = ?", vaultID).Preload("ActivityTypes").Order("position ASC").Find(&cats).Error; err != nil {
		return nil, err
	}
	result := make([]dto.ActivityCategoryResponse, len(cats))
	for i, c := range cats {
		result[i] = toActivityCategoryResponse(&c)
	}
	return result, nil
}

func (s *VaultActivityService) CreateCategory(vaultID string, req dto.CreateActivityCategoryRequest) (*dto.ActivityCategoryResponse, error) {
	label := req.Label
	cat := models.ActivityCategory{
		VaultID:      vaultID,
		Label:        &label,
		Position:     req.Position,
		CanBeDeleted: true,
	}
	if err := s.db.Create(&cat).Error; err != nil {
		return nil, err
	}
	resp := toActivityCategoryResponse(&cat)
	return &resp, nil
}

func (s *VaultActivityService) UpdateCategory(id uint, vaultID string, req dto.UpdateActivityCategoryRequest) (*dto.ActivityCategoryResponse, error) {
	var cat models.ActivityCategory
	if err := s.db.Where("id = ? AND vault_id = ?", id, vaultID).First(&cat).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLifeCategoryNotFound
		}
		return nil, err
	}
	label := req.Label
	cat.Label = &label
	cat.Position = req.Position
	if err := s.db.Save(&cat).Error; err != nil {
		return nil, err
	}
	if err := s.db.Preload("ActivityTypes").First(&cat, "id = ?", cat.ID).Error; err != nil {
		return nil, err
	}
	resp := toActivityCategoryResponse(&cat)
	return &resp, nil
}

func (s *VaultActivityService) UpdateCategoryPosition(id uint, vaultID string, position int) (*dto.ActivityCategoryResponse, error) {
	var cat models.ActivityCategory
	if err := s.db.Where("id = ? AND vault_id = ?", id, vaultID).First(&cat).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLifeCategoryNotFound
		}
		return nil, err
	}
	cat.Position = &position
	if err := s.db.Save(&cat).Error; err != nil {
		return nil, err
	}
	resp := toActivityCategoryResponse(&cat)
	return &resp, nil
}

func (s *VaultActivityService) DeleteCategory(id uint, vaultID string) error {
	var cat models.ActivityCategory
	if err := s.db.Where("id = ? AND vault_id = ?", id, vaultID).First(&cat).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrLifeCategoryNotFound
		}
		return err
	}
	if !cat.CanBeDeleted {
		return ErrCannotDeleteDefault
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("activity_category_id = ?", id).Delete(&models.ActivityType{}).Error; err != nil {
			return err
		}
		return tx.Delete(&cat).Error
	})
}

func (s *VaultActivityService) CreateType(categoryID uint, vaultID string, req dto.CreateActivityTypeRequest) (*dto.ActivityTypeResponse, error) {
	var cat models.ActivityCategory
	if err := s.db.Where("id = ? AND vault_id = ?", categoryID, vaultID).First(&cat).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLifeCategoryNotFound
		}
		return nil, err
	}
	label := req.Label
	lt := models.ActivityType{
		ActivityCategoryID:  categoryID,
		Label:               &label,
		Position:            req.Position,
		CanBeDeleted:        true,
		Icon:                req.Icon,
		Color:               req.Color,
		CountsAsInteraction: req.CountsAsInteraction,
	}
	if err := s.db.Create(&lt).Error; err != nil {
		return nil, err
	}
	resp := toActivityTypeResponse(&lt)
	return &resp, nil
}

func (s *VaultActivityService) UpdateType(typeID, categoryID uint, vaultID string, req dto.UpdateActivityTypeRequest) (*dto.ActivityTypeResponse, error) {
	var cat models.ActivityCategory
	if err := s.db.Where("id = ? AND vault_id = ?", categoryID, vaultID).First(&cat).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLifeCategoryNotFound
		}
		return nil, err
	}
	var lt models.ActivityType
	if err := s.db.Where("id = ? AND activity_category_id = ?", typeID, categoryID).First(&lt).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLifeTypeNotFound
		}
		return nil, err
	}
	label := req.Label
	lt.Label = &label
	lt.Position = req.Position
	lt.Icon = req.Icon
	lt.Color = req.Color
	lt.CountsAsInteraction = req.CountsAsInteraction
	if err := s.db.Save(&lt).Error; err != nil {
		return nil, err
	}
	resp := toActivityTypeResponse(&lt)
	return &resp, nil
}

func (s *VaultActivityService) UpdateTypePosition(typeID, categoryID uint, vaultID string, position int) (*dto.ActivityTypeResponse, error) {
	var cat models.ActivityCategory
	if err := s.db.Where("id = ? AND vault_id = ?", categoryID, vaultID).First(&cat).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLifeCategoryNotFound
		}
		return nil, err
	}
	var lt models.ActivityType
	if err := s.db.Where("id = ? AND activity_category_id = ?", typeID, categoryID).First(&lt).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLifeTypeNotFound
		}
		return nil, err
	}
	lt.Position = &position
	if err := s.db.Save(&lt).Error; err != nil {
		return nil, err
	}
	resp := toActivityTypeResponse(&lt)
	return &resp, nil
}

func (s *VaultActivityService) DeleteType(typeID, categoryID uint, vaultID string) error {
	var cat models.ActivityCategory
	if err := s.db.Where("id = ? AND vault_id = ?", categoryID, vaultID).First(&cat).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrLifeCategoryNotFound
		}
		return err
	}
	var lt models.ActivityType
	if err := s.db.Where("id = ? AND activity_category_id = ?", typeID, categoryID).First(&lt).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrLifeTypeNotFound
		}
		return err
	}
	if !lt.CanBeDeleted {
		return ErrCannotDeleteDefault
	}
	return s.db.Delete(&lt).Error
}

func toActivityCategoryResponse(c *models.ActivityCategory) dto.ActivityCategoryResponse {
	types := make([]dto.ActivityTypeResponse, len(c.ActivityTypes))
	for i, t := range c.ActivityTypes {
		types[i] = toActivityTypeResponse(&t)
	}
	return dto.ActivityCategoryResponse{
		ID:           c.ID,
		Label:        ptrToStr(c.Label),
		CanBeDeleted: c.CanBeDeleted,
		Position:     c.Position,
		Types:        types,
		CreatedAt:    c.CreatedAt,
		UpdatedAt:    c.UpdatedAt,
	}
}

func toActivityTypeResponse(t *models.ActivityType) dto.ActivityTypeResponse {
	return dto.ActivityTypeResponse{
		ID:                  t.ID,
		CategoryID:          t.ActivityCategoryID,
		Label:               ptrToStr(t.Label),
		CanBeDeleted:        t.CanBeDeleted,
		Position:            t.Position,
		SystemKind:          ptrToStr(t.SystemKind),
		Icon:                ptrToStr(t.Icon),
		Color:               ptrToStr(t.Color),
		CountsAsInteraction: t.CountsAsInteraction,
		CreatedAt:           t.CreatedAt,
		UpdatedAt:           t.UpdatedAt,
	}
}
