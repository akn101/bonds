package services

import (
	"errors"
	"sort"

	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const maxPostUpdateAssociationLockAttempts = 3

var errPostContactAssociationsChanged = errors.New("post contact associations changed during update")

func inVaultPostContactIDs(db *gorm.DB, postID uint, vaultID string) ([]string, error) {
	var contactIDs []string
	if err := db.Model(&models.Contact{}).
		Select("contacts.id").
		Joins("JOIN contact_post ON contact_post.contact_id = contacts.id").
		Where("contact_post.post_id = ? AND contacts.vault_id = ?", postID, vaultID).
		Order("contacts.id ASC").
		Pluck("contacts.id", &contactIDs).Error; err != nil {
		return nil, err
	}
	contactIDs = dedupeContactIDs(contactIDs)
	sort.Strings(contactIDs)
	return contactIDs, nil
}

func equalPostContactIDs(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func lockPostJournal(tx *gorm.DB, journalID uint, vaultID string) error {
	var journal models.Journal
	if err := tx.Clauses(clause.Locking{Strength: clause.LockingStrengthUpdate}).
		Select("id").
		Where("id = ? AND vault_id = ?", journalID, vaultID).
		First(&journal).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrJournalNotFound
		}
		return err
	}
	return nil
}

func lockJournalPosts(tx *gorm.DB, journalID uint) ([]models.Post, error) {
	var posts []models.Post
	if err := tx.Clauses(clause.Locking{Strength: clause.LockingStrengthUpdate}).
		Where("journal_id = ?", journalID).
		Order("id ASC").
		Find(&posts).Error; err != nil {
		return nil, err
	}
	return posts, nil
}

func lockJournalPost(tx *gorm.DB, id, journalID uint) (*models.Post, error) {
	var post models.Post
	if err := tx.Clauses(clause.Locking{Strength: clause.LockingStrengthUpdate}).
		Where("id = ? AND journal_id = ?", id, journalID).
		Order("id ASC").
		First(&post).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPostNotFound
		}
		return nil, err
	}
	return &post, nil
}

func validatePostBelongsToJournal(db *gorm.DB, id, journalID uint) error {
	var post models.Post
	if err := db.Where("id = ? AND journal_id = ?", id, journalID).First(&post).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPostNotFound
		}
		return err
	}
	return nil
}
