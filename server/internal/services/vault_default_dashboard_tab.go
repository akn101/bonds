package services

import (
	"errors"

	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

// UpdateDefaultDashboardTab updates the default dashboard tab for a vault.
func (s *VaultService) UpdateDefaultDashboardTab(vaultID string, tab string) error {
	var vault models.Vault
	if err := s.db.First(&vault, "id = ?", vaultID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrVaultNotFound
		}
		return err
	}
	return s.db.Model(&vault).Update("default_dashboard_tab", tab).Error
}
