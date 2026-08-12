package database

import (
	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

func migrateLegacyPivots(db *gorm.DB) error {
	if err := migrateLegacyActivityParticipantPivots(db); err != nil {
		return err
	}
	if err := migrateLegacyContactGroupPivots(db); err != nil {
		return err
	}
	return migrateLegacyContactPostPivots(db)
}

func migrateLegacyContactGroupPivots(db *gorm.DB) error {
	return migrateLegacyDuplicatePivotRows(db, duplicatePivotMigration{
		model:            &models.ContactGroup{},
		tableName:        "contact_group",
		firstKeyColumn:   "group_id",
		secondKeyColumn:  "contact_id",
		crossVaultTables: []string{"contacts", "groups"},
		crossVaultCleanupSQL: `DELETE FROM contact_group
			WHERE EXISTS (
				SELECT 1
				FROM groups
				WHERE groups.id = contact_group.group_id
				AND EXISTS (
					SELECT 1
					FROM contacts
					WHERE contacts.id = contact_group.contact_id
					AND groups.vault_id <> contacts.vault_id
				)
			)`,
	})
}

func migrateLegacyContactPostPivots(db *gorm.DB) error {
	return migrateLegacyDuplicatePivotRows(db, duplicatePivotMigration{
		model:            &models.ContactPost{},
		tableName:        "contact_post",
		firstKeyColumn:   "post_id",
		secondKeyColumn:  "contact_id",
		crossVaultTables: []string{"contacts", "posts", "journals"},
		crossVaultCleanupSQL: `DELETE FROM contact_post
			WHERE EXISTS (
				SELECT 1
				FROM posts
				WHERE posts.id = contact_post.post_id
				AND EXISTS (
					SELECT 1
					FROM journals
					WHERE journals.id = posts.journal_id
					AND EXISTS (
						SELECT 1
						FROM contacts
						WHERE contacts.id = contact_post.contact_id
						AND journals.vault_id <> contacts.vault_id
					)
				)
			)`,
	})
}

type duplicatePivotMigration struct {
	model                interface{}
	tableName            string
	firstKeyColumn       string
	secondKeyColumn      string
	crossVaultTables     []string
	crossVaultCleanupSQL string
}

func migrateLegacyDuplicatePivotRows(db *gorm.DB, migration duplicatePivotMigration) error {
	if !db.Migrator().HasTable(migration.model) {
		return nil
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if hasTables(tx, migration.crossVaultTables...) {
			// Remove legacy tenant-crossing pivots before unique-index migration can preserve them.
			if err := tx.Exec(migration.crossVaultCleanupSQL).Error; err != nil {
				return err
			}
		}
		return tx.Exec(`DELETE FROM ` + migration.tableName + `
			WHERE id NOT IN (
				SELECT MIN(id)
				FROM ` + migration.tableName + `
				GROUP BY ` + migration.firstKeyColumn + `, ` + migration.secondKeyColumn + `
			)`).Error
	})
}

func hasTables(db *gorm.DB, tableNames ...string) bool {
	for _, tableName := range tableNames {
		if !db.Migrator().HasTable(tableName) {
			return false
		}
	}
	return true
}
