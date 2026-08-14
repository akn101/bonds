package services

import (
	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/utils"
	"gorm.io/gorm"
)

type contactNameFormatter struct {
	userNameOrder string
}

func newContactNameFormatter(db *gorm.DB, userID string) (*contactNameFormatter, error) {
	if userID == "" {
		return nil, ErrUserNotFound
	}
	userNameOrder, err := GetUserNameOrder(db, userID)
	if err != nil {
		return nil, err
	}
	return &contactNameFormatter{
		userNameOrder: userNameOrder,
	}, nil
}

func (f *contactNameFormatter) format(contact *models.Contact, fallback string) (string, error) {
	if contact == nil {
		return fallback, nil
	}
	return utils.FormatContactName(f.userNameOrder, contact, fallback), nil
}
