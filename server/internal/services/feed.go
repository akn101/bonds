package services

import (
	"math"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/pkg/response"
	"gorm.io/gorm"
)

type FeedService struct {
	db *gorm.DB
}

func NewFeedService(db *gorm.DB) *FeedService {
	return &FeedService{db: db}
}

func (s *FeedService) GetFeed(vaultID string, page, perPage int, userID string) ([]dto.FeedItemResponse, response.Meta, error) {
	// Post-migration blank event vault IDs are excluded to preserve event-time vault boundaries.
	query := s.db.Model(&models.ContactFeedItem{}).Where("vault_id = ?", vaultID)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, response.Meta{}, err
	}

	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 15
	}
	offset := (page - 1) * perPage

	var items []models.ContactFeedItem
	if err := query.Offset(offset).Limit(perPage).Order("created_at DESC").Find(&items).Error; err != nil {
		return nil, response.Meta{}, err
	}

	formatter, err := newContactNameFormatter(s.db, userID)
	if err != nil {
		return nil, response.Meta{}, err
	}
	result := make([]dto.FeedItemResponse, len(items))
	for i, item := range items {
		projected, err := s.projectFeedItem(item, formatter)
		if err != nil {
			return nil, response.Meta{}, err
		}
		result[i] = projected
	}

	meta := response.Meta{
		Page:       page,
		PerPage:    perPage,
		Total:      total,
		TotalPages: int(math.Ceil(float64(total) / float64(perPage))),
	}
	return result, meta, nil
}

func (s *FeedService) ListContactFeed(contactID, vaultID string, page, perPage int, userID string) ([]dto.FeedItemResponse, response.Meta, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 15
	}
	var contact models.Contact
	if err := s.db.Where("id = ? AND vault_id = ?", contactID, vaultID).First(&contact).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return []dto.FeedItemResponse{}, response.Meta{Page: page, PerPage: perPage}, nil
		}
		return nil, response.Meta{}, err
	}
	query := s.db.Model(&models.ContactFeedItem{}).
		Where("contact_id = ?", contactID).
		Where("(vault_id = ? OR vault_id IS NULL OR vault_id = '')", vaultID)

	var total int64
	if err := query.Model(&models.ContactFeedItem{}).Count(&total).Error; err != nil {
		return nil, response.Meta{}, err
	}

	offset := (page - 1) * perPage

	var items []models.ContactFeedItem
	if err := query.Offset(offset).Limit(perPage).Order("created_at DESC").Find(&items).Error; err != nil {
		return nil, response.Meta{}, err
	}

	formatter, err := newContactNameFormatter(s.db, userID)
	if err != nil {
		return nil, response.Meta{}, err
	}
	result := make([]dto.FeedItemResponse, len(items))
	for i, item := range items {
		projected, err := s.projectFeedItem(item, formatter)
		if err != nil {
			return nil, response.Meta{}, err
		}
		result[i] = projected
	}

	meta := response.Meta{
		Page:       page,
		PerPage:    perPage,
		Total:      total,
		TotalPages: int(math.Ceil(float64(total) / float64(perPage))),
	}
	return result, meta, nil
}
