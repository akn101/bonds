package database

import (
	"fmt"

	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/utils"
	"gorm.io/gorm"
)

type legacyFeedContact struct {
	FeedItemID uint
	VaultID    string
	NameOrder  *string
	FirstName  *string
	MiddleName *string
	LastName   *string
	Nickname   *string
	MaidenName *string
	Prefix     *string
	Suffix     *string
}

func backfillContactFeedEventContext(db *gorm.DB) error {
	if !db.Migrator().HasTable(&models.ContactFeedItem{}) {
		return nil
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var contacts []legacyFeedContact
		nameOrderSelection := "NULL AS name_order"
		if hasColumn(tx, "vaults", "name_order") {
			nameOrderSelection = "vaults.name_order"
		}
		if err := tx.Unscoped().Table("contact_feed_items").
			Select("contact_feed_items.id AS feed_item_id, contacts.vault_id, " + nameOrderSelection + ", contacts.first_name, contacts.middle_name, contacts.last_name, contacts.nickname, contacts.maiden_name, contacts.prefix, contacts.suffix").
			Joins("JOIN contacts ON contacts.id = contact_feed_items.contact_id").
			Joins("LEFT JOIN vaults ON vaults.id = contacts.vault_id").
			Where("contact_feed_items.vault_id IS NULL OR contact_feed_items.vault_id = '' OR contact_feed_items.contact_name_snapshot IS NULL OR contact_feed_items.contact_name_snapshot = ''").
			Scan(&contacts).Error; err != nil {
			return fmt.Errorf("load legacy feed contacts: %w", err)
		}
		for _, legacy := range contacts {
			updates := map[string]any{}
			var item models.ContactFeedItem
			if err := tx.Select("id", "vault_id", "contact_name_snapshot").First(&item, legacy.FeedItemID).Error; err != nil {
				return fmt.Errorf("load legacy feed item %d: %w", legacy.FeedItemID, err)
			}
			if item.VaultID == "" {
				updates["vault_id"] = legacy.VaultID
			}
			if item.ContactNameSnapshot == "" {
				contact := models.Contact{
					FirstName:  legacy.FirstName,
					MiddleName: legacy.MiddleName,
					LastName:   legacy.LastName,
					Nickname:   legacy.Nickname,
					MaidenName: legacy.MaidenName,
					Prefix:     legacy.Prefix,
					Suffix:     legacy.Suffix,
				}
				updates["contact_name_snapshot"] = utils.FormatContactNameSnapshot(legacy.NameOrder, &contact)
			}
			if len(updates) == 0 {
				continue
			}
			if err := tx.Model(&models.ContactFeedItem{}).Where("id = ?", legacy.FeedItemID).Updates(updates).Error; err != nil {
				return fmt.Errorf("backfill legacy feed item %d: %w", legacy.FeedItemID, err)
			}
		}
		return nil
	})
}
