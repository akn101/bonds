package services

import (
	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

type MoodTrackingService struct {
	db *gorm.DB
}

func NewMoodTrackingService(db *gorm.DB) *MoodTrackingService {
	return &MoodTrackingService{db: db}
}

func (s *MoodTrackingService) Create(vaultID, userID string, req dto.CreateMoodTrackingEventRequest) (*dto.MoodTrackingEventResponse, error) {
	var parameterCount int64
	if err := s.db.Model(&models.MoodTrackingParameter{}).
		Where("id = ? AND vault_id = ?", req.MoodTrackingParameterID, vaultID).
		Count(&parameterCount).Error; err != nil {
		return nil, err
	}
	if parameterCount != 1 {
		return nil, ErrMoodParamNotFound
	}
	event := models.MoodTrackingEvent{
		VaultID:                 vaultID,
		UserID:                  &userID,
		MoodTrackingParameterID: req.MoodTrackingParameterID,
		RatedAt:                 req.RatedAt,
		Note:                    strPtrOrNil(req.Note),
		NumberOfHoursSlept:      req.NumberOfHoursSlept,
	}
	if err := s.db.Create(&event).Error; err != nil {
		return nil, err
	}
	resp := toMoodTrackingEventResponse(&event)
	return &resp, nil
}

func (s *MoodTrackingService) List(vaultID, userID string) ([]dto.MoodTrackingEventResponse, error) {
	var events []models.MoodTrackingEvent
	if err := s.db.Where("vault_id = ? AND user_id = ?", vaultID, userID).Order("rated_at DESC").Find(&events).Error; err != nil {
		return nil, err
	}
	result := make([]dto.MoodTrackingEventResponse, len(events))
	for i, e := range events {
		result[i] = toMoodTrackingEventResponse(&e)
	}
	return result, nil
}

func toMoodTrackingEventResponse(e *models.MoodTrackingEvent) dto.MoodTrackingEventResponse {
	return dto.MoodTrackingEventResponse{
		ID:                      e.ID,
		VaultID:                 e.VaultID,
		UserID:                  ptrToStr(e.UserID),
		MoodTrackingParameterID: e.MoodTrackingParameterID,
		RatedAt:                 e.RatedAt,
		Note:                    ptrToStr(e.Note),
		NumberOfHoursSlept:      e.NumberOfHoursSlept,
		CreatedAt:               e.CreatedAt,
		UpdatedAt:               e.UpdatedAt,
	}
}
