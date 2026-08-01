package services

import (
	"errors"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

var ErrJournalNotFound = errors.New("journal not found")

type JournalService struct {
	db        *gorm.DB
	uploadDir string
}

func NewJournalService(db *gorm.DB) *JournalService {
	return &JournalService{db: db}
}

func (s *JournalService) SetUploadDir(uploadDir string) {
	s.uploadDir = uploadDir
}

func (s *JournalService) List(vaultID string) ([]dto.JournalResponse, error) {
	var journals []models.Journal
	if err := s.db.Where("vault_id = ?", vaultID).Order("created_at DESC").Find(&journals).Error; err != nil {
		return nil, err
	}
	result := make([]dto.JournalResponse, len(journals))
	for i, j := range journals {
		var count int64
		s.db.Model(&models.Post{}).Where("journal_id = ?", j.ID).Count(&count)
		result[i] = toJournalResponse(&j, int(count))
	}
	return result, nil
}

func (s *JournalService) Create(vaultID string, req dto.CreateJournalRequest) (*dto.JournalResponse, error) {
	journal := models.Journal{
		VaultID:     vaultID,
		Name:        req.Name,
		Description: strPtrOrNil(req.Description),
	}
	if err := s.db.Create(&journal).Error; err != nil {
		return nil, err
	}
	resp := toJournalResponse(&journal, 0)
	return &resp, nil
}

func (s *JournalService) Get(id uint, vaultID string) (*dto.JournalResponse, error) {
	var journal models.Journal
	if err := s.db.Where("id = ? AND vault_id = ?", id, vaultID).First(&journal).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrJournalNotFound
		}
		return nil, err
	}
	var count int64
	s.db.Model(&models.Post{}).Where("journal_id = ?", journal.ID).Count(&count)
	resp := toJournalResponse(&journal, int(count))
	return &resp, nil
}

func (s *JournalService) Update(id uint, vaultID string, req dto.UpdateJournalRequest) (*dto.JournalResponse, error) {
	var journal models.Journal
	if err := s.db.Where("id = ? AND vault_id = ?", id, vaultID).First(&journal).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrJournalNotFound
		}
		return nil, err
	}
	journal.Name = req.Name
	journal.Description = strPtrOrNil(req.Description)
	if err := s.db.Save(&journal).Error; err != nil {
		return nil, err
	}
	var count int64
	s.db.Model(&models.Post{}).Where("journal_id = ?", journal.ID).Count(&count)
	resp := toJournalResponse(&journal, int(count))
	return &resp, nil
}

func (s *JournalService) Delete(id uint, vaultID string) error {
	if err := validateJournalBelongsToVault(s.db, id, vaultID); err != nil {
		return err
	}
	var files []models.File
	if err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := lockPostJournal(tx, id, vaultID); err != nil {
			return err
		}
		posts, err := lockJournalPosts(tx, id)
		if err != nil {
			return err
		}
		postIDs := make([]uint, len(posts))
		for index := range posts {
			postIDs[index] = posts[index].ID
		}
		postFiles, err := deletePostDependents(tx, vaultID, postIDs)
		if err != nil {
			return err
		}
		files = postFiles
		if err := tx.Where("journal_id = ?", id).Delete(&models.Post{}).Error; err != nil {
			return err
		}
		if err := tx.Where("journal_id = ?", id).Delete(&models.JournalMetric{}).Error; err != nil {
			return err
		}
		if err := tx.Where("journal_id = ?", id).Delete(&models.SliceOfLife{}).Error; err != nil {
			return err
		}
		return tx.Delete(&models.Journal{}, id).Error
	}); err != nil {
		return err
	}
	removeCommittedPostFiles(s.uploadDir, files)
	return nil
}

func toJournalResponse(j *models.Journal, postCount int) dto.JournalResponse {
	return dto.JournalResponse{
		ID:          j.ID,
		VaultID:     j.VaultID,
		Name:        j.Name,
		Description: ptrToStr(j.Description),
		PostCount:   postCount,
		CreatedAt:   j.CreatedAt,
		UpdatedAt:   j.UpdatedAt,
	}
}
