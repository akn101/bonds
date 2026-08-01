package services

import (
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/i18n"
	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

var (
	ErrNotificationChannelNotFound = errors.New("notification channel not found")
	ErrInvalidVerificationToken    = errors.New("invalid verification token")
)

type NotificationService struct {
	db       *gorm.DB
	mailer   Mailer
	sender   NotificationSender
	settings *SystemSettingService
}

func NewNotificationService(db *gorm.DB) *NotificationService {
	return &NotificationService{db: db}
}

func (s *NotificationService) SetMailer(mailer Mailer) {
	s.mailer = mailer
}

func (s *NotificationService) SetSender(sender NotificationSender) {
	s.sender = sender
}

func (s *NotificationService) SetSystemSettings(settings *SystemSettingService) {
	s.settings = settings
}

func (s *NotificationService) List(userID string) ([]dto.NotificationChannelResponse, error) {
	var channels []models.UserNotificationChannel
	if err := s.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&channels).Error; err != nil {
		return nil, err
	}
	result := make([]dto.NotificationChannelResponse, len(channels))
	for i, ch := range channels {
		result[i] = toNotificationChannelResponse(&ch)
	}
	return result, nil
}

func (s *NotificationService) Create(userID string, req dto.CreateNotificationChannelRequest) (*dto.NotificationChannelResponse, error) {
	token := uuid.New().String()
	ch := models.UserNotificationChannel{
		UserID:            &userID,
		Type:              req.Type,
		Label:             strPtrOrNil(req.Label),
		Content:           req.Content,
		PreferredTime:     strPtrOrNil(req.PreferredTime),
		VerificationToken: &token,
	}
	if err := s.db.Create(&ch).Error; err != nil {
		return nil, err
	}

	if req.Type == "email" {
		if s.mailer != nil {
			locale := s.loadUserLocale(userID)
			subject, body := notificationVerificationContent(s.getAppURL(), ch.ID, token, locale)
			_ = s.mailer.Send(req.Content, subject, body)
		}
	} else {
		now := time.Now()
		ch.VerifiedAt = &now
		ch.Active = true
		if err := s.db.Model(&ch).Updates(map[string]interface{}{
			"verified_at": now,
			"active":      true,
		}).Error; err != nil {
			return nil, err
		}
		if err := s.ScheduleAllContactReminders(ch.ID, userID); err != nil {
			return nil, err
		}
	}

	resp := toNotificationChannelResponse(&ch)
	return &resp, nil
}

func (s *NotificationService) Update(id uint, userID string, req dto.UpdateNotificationChannelRequest) (*dto.NotificationChannelResponse, error) {
	var ch models.UserNotificationChannel
	if err := s.db.Where("id = ? AND user_id = ?", id, userID).First(&ch).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotificationChannelNotFound
		}
		return nil, err
	}

	contentChanged := ch.Content != req.Content
	preferredTimeChanged := ptrToStr(ch.PreferredTime) != req.PreferredTime

	ch.Label = strPtrOrNil(req.Label)
	ch.Content = req.Content
	ch.PreferredTime = strPtrOrNil(req.PreferredTime)

	if contentChanged && ch.Type == "email" {
		token := uuid.New().String()
		ch.VerificationToken = &token
		ch.VerifiedAt = nil
		ch.Active = false
		ch.Fails = 0
	}

	if err := s.db.Save(&ch).Error; err != nil {
		return nil, err
	}

	if contentChanged && ch.Type == "email" {
		if s.mailer != nil {
			locale := s.loadUserLocale(userID)
			subject, body := notificationVerificationContent(s.getAppURL(), ch.ID, *ch.VerificationToken, locale)
			_ = s.mailer.Send(req.Content, subject, body)
		}
	}
	if ch.Active && preferredTimeChanged {
		if err := s.db.Where("user_notification_channel_id = ? AND triggered_at IS NULL", ch.ID).
			Delete(&models.ContactReminderScheduled{}).Error; err != nil {
			return nil, err
		}
		if err := s.ScheduleAllContactReminders(ch.ID, userID); err != nil {
			return nil, err
		}
	}

	resp := toNotificationChannelResponse(&ch)
	return &resp, nil
}

func (s *NotificationService) Toggle(id uint, userID string) (*dto.NotificationChannelResponse, error) {
	var ch models.UserNotificationChannel
	if err := s.db.Where("id = ? AND user_id = ?", id, userID).First(&ch).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotificationChannelNotFound
		}
		return nil, err
	}
	ch.Active = !ch.Active
	if err := s.db.Save(&ch).Error; err != nil {
		return nil, err
	}
	if ch.Active {
		_ = s.ScheduleAllContactReminders(ch.ID, userID)
	}
	resp := toNotificationChannelResponse(&ch)
	return &resp, nil
}

func (s *NotificationService) Delete(id uint, userID string) error {
	var ch models.UserNotificationChannel
	if err := s.db.Where("id = ? AND user_id = ?", id, userID).First(&ch).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNotificationChannelNotFound
		}
		return err
	}
	return s.db.Delete(&ch).Error
}

func (s *NotificationService) Verify(id uint, userID, token string) error {
	var ch models.UserNotificationChannel
	if err := s.db.Where("id = ? AND user_id = ?", id, userID).First(&ch).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNotificationChannelNotFound
		}
		return err
	}
	if ch.VerificationToken == nil || *ch.VerificationToken != token {
		return ErrInvalidVerificationToken
	}
	now := time.Now()
	ch.VerifiedAt = &now
	ch.Active = true
	if err := s.db.Save(&ch).Error; err != nil {
		return err
	}
	return s.ScheduleAllContactReminders(ch.ID, *ch.UserID)
}

func (s *NotificationService) SendTest(id uint, userID string) error {
	var ch models.UserNotificationChannel
	if err := s.db.Where("id = ? AND user_id = ?", id, userID).First(&ch).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNotificationChannelNotFound
		}
		return err
	}

	locale := s.loadUserLocale(userID)
	subject := i18n.T(locale, "notification.channel.test.subject")
	body := i18n.T(locale, "notification.channel.test.body")
	var sendErr error

	switch ch.Type {
	case "email":
		if s.mailer != nil {
			sendErr = s.mailer.Send(ch.Content, subject, body)
		}
	case "shoutrrr", "telegram", "ntfy", "gotify", "webhook":
		if s.sender != nil {
			sendErr = s.sender.Send(ch.Content, subject, body)
		}
	}

	now := time.Now()
	sent := models.UserNotificationSent{
		UserNotificationChannelID: ch.ID,
		SentAt:                    now,
		SubjectLine:               subject,
		Payload:                   &body,
	}
	if sendErr != nil {
		errMsg := sendErr.Error()
		sent.Error = &errMsg
	}
	if err := s.db.Create(&sent).Error; err != nil {
		return err
	}
	return sendErr
}

func (s *NotificationService) ListLogs(id uint, userID string) ([]dto.NotificationLogResponse, error) {
	var ch models.UserNotificationChannel
	if err := s.db.Where("id = ? AND user_id = ?", id, userID).First(&ch).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotificationChannelNotFound
		}
		return nil, err
	}
	var logs []models.UserNotificationSent
	if err := s.db.Where("user_notification_channel_id = ?", id).Order("sent_at DESC").Find(&logs).Error; err != nil {
		return nil, err
	}
	result := make([]dto.NotificationLogResponse, len(logs))
	for i, l := range logs {
		result[i] = dto.NotificationLogResponse{
			ID:          l.ID,
			SentAt:      l.SentAt,
			SubjectLine: l.SubjectLine,
			Payload:     ptrToStr(l.Payload),
			Error:       ptrToStr(l.Error),
			CreatedAt:   l.CreatedAt,
		}
	}
	return result, nil
}

func (s *NotificationService) ScheduleAllContactReminders(channelID uint, userID string) error {
	return scheduleAllContactReminders(s.db, channelID, userID)
}
