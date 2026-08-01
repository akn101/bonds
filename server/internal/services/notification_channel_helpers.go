package services

import (
	"strconv"
	"strings"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/i18n"
	"github.com/naiba/bonds/internal/models"
)

func (s *NotificationService) getAppURL() string {
	if s.settings != nil {
		return s.settings.GetWithDefault("app.url", "http://localhost:8080")
	}
	return "http://localhost:8080"
}

func (s *NotificationService) loadUserLocale(userID string) string {
	var user models.User
	if err := s.db.Select("locale").Where("id = ?", userID).First(&user).Error; err != nil || user.Locale == "" {
		return "en"
	}
	return user.Locale
}

func notificationVerificationContent(appURL string, channelID uint, token, locale string) (string, string) {
	link := appURL + "/settings/notifications/" + strconv.FormatUint(uint64(channelID), 10) + "/verify/" + token
	return i18n.T(locale, "notification.channel.verify.subject"), i18n.Tt(locale, "notification.channel.verify.body", map[string]string{"link": link})
}

func parsePreferredNotificationTime(preferredTime *string) (int, int) {
	if preferredTime == nil {
		return 9, 0
	}
	raw := strings.TrimSpace(*preferredTime)
	if len(raw) != 5 || raw[2] != ':' {
		return 9, 0
	}
	hour, hourErr := strconv.Atoi(raw[:2])
	minute, minuteErr := strconv.Atoi(raw[3:])
	if hourErr != nil || minuteErr != nil || hour < 0 || hour > 23 || minute < 0 || minute > 59 {
		return 9, 0
	}
	return hour, minute
}

func toNotificationChannelResponse(channel *models.UserNotificationChannel) dto.NotificationChannelResponse {
	return dto.NotificationChannelResponse{
		ID:            channel.ID,
		Type:          channel.Type,
		Label:         ptrToStr(channel.Label),
		Content:       channel.Content,
		PreferredTime: ptrToStr(channel.PreferredTime),
		Active:        channel.Active,
		VerifiedAt:    channel.VerifiedAt,
		CreatedAt:     channel.CreatedAt,
		UpdatedAt:     channel.UpdatedAt,
	}
}
