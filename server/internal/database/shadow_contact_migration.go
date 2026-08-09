package database

import (
	"fmt"
	"strings"

	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

// migrateLegacyShadowContacts removes the former UserVault-to-Contact bridge.
// It preserves the two pieces of user-owned data that used that bridge:
// moods become vault/user rows, and dashboard life events get a user subject
// snapshot. Mood rows that belonged to an ordinary contact are retained as
// anonymous vault history.
func migrateLegacyShadowContacts(db *gorm.DB) error {
	if !db.Migrator().HasTable("user_vault") || !hasColumn(db, "user_vault", "contact_id") {
		return nil
	}

	if err := addShadowReplacementColumns(db); err != nil {
		return err
	}

	type legacyUserContact struct {
		UserVaultID uint
		VaultID     string
		UserID      string
		ContactID   string
		FirstName   string
		LastName    string
		Email       string
	}
	var mappings []legacyUserContact
	if err := db.Table("user_vault").
		Select(`user_vault.id AS user_vault_id, user_vault.vault_id, user_vault.user_id,
			user_vault.contact_id, COALESCE(users.first_name, '') AS first_name,
			COALESCE(users.last_name, '') AS last_name, COALESCE(users.email, '') AS email`).
		Joins("LEFT JOIN users ON users.id = user_vault.user_id").
		Where("user_vault.contact_id IS NOT NULL AND user_vault.contact_id <> ?", "").
		Order("user_vault.id ASC").
		Scan(&mappings).Error; err != nil {
		return fmt.Errorf("migrate shadow contacts: load mappings: %w", err)
	}

	runMigration := func(tx *gorm.DB) error {
		shadowIDs := make([]string, 0, len(mappings))
		for _, mapping := range mappings {
			shadowIDs = append(shadowIDs, mapping.ContactID)
			if err := migrateShadowLifeEvents(tx, mapping); err != nil {
				return err
			}
			if tx.Migrator().HasTable("mood_tracking_events") && hasColumn(tx, "mood_tracking_events", "contact_id") {
				if err := tx.Table("mood_tracking_events").
					Where("contact_id = ?", mapping.ContactID).
					Updates(map[string]interface{}{"vault_id": mapping.VaultID, "user_id": mapping.UserID}).Error; err != nil {
					return fmt.Errorf("migrate shadow contacts: map mood rows: %w", err)
				}
			}
		}

		if err := backfillLegacyMoodVaultIDs(tx); err != nil {
			return err
		}
		shadowIDs = uniqueShadowContactIDs(shadowIDs)
		if len(shadowIDs) > 0 {
			if err := deleteLegacyShadowContactData(tx, shadowIDs); err != nil {
				return err
			}
		}

		// mood_tracking_events.contact_id has a foreign key to contacts in the
		// legacy schema. Drop both bridge columns before deleting the shadow
		// contacts, while keeping the entire operation in one transaction so a
		// failed delete restores both the data and the bridge mappings.
		if err := dropLegacyShadowColumns(tx); err != nil {
			return err
		}
		if len(shadowIDs) > 0 {
			if err := deleteLegacyShadowContacts(tx, shadowIDs); err != nil {
				return err
			}
		}
		return nil
	}

	if db.Dialector.Name() == "sqlite" {
		return db.Connection(func(conn *gorm.DB) error {
			if err := conn.Exec("PRAGMA legacy_alter_table = ON").Error; err != nil {
				return fmt.Errorf("migrate shadow contacts: enable legacy alter table: %w", err)
			}
			defer conn.Exec("PRAGMA legacy_alter_table = OFF")
			return conn.Transaction(runMigration)
		})
	}
	return db.Transaction(runMigration)
}

func addShadowReplacementColumns(db *gorm.DB) error {
	columns := []struct {
		model interface{}
		name  string
	}{
		{&models.LifeEvent{}, "SubjectUserID"},
		{&models.LifeEvent{}, "SubjectUserName"},
		{&models.MoodTrackingEvent{}, "VaultID"},
		{&models.MoodTrackingEvent{}, "UserID"},
	}
	for _, column := range columns {
		if !db.Migrator().HasTable(column.model) || db.Migrator().HasColumn(column.model, column.name) {
			continue
		}
		if err := db.Migrator().AddColumn(column.model, column.name); err != nil {
			return fmt.Errorf("migrate shadow contacts: add %s: %w", column.name, err)
		}
	}
	return nil
}

func migrateShadowLifeEvents(tx *gorm.DB, mapping struct {
	UserVaultID uint
	VaultID     string
	UserID      string
	ContactID   string
	FirstName   string
	LastName    string
	Email       string
}) error {
	if !tx.Migrator().HasTable("life_events") || !tx.Migrator().HasTable("life_event_participants") {
		return nil
	}
	var eventIDs []uint
	if err := tx.Table("life_event_participants").Where("contact_id = ?", mapping.ContactID).Pluck("life_event_id", &eventIDs).Error; err != nil {
		return fmt.Errorf("migrate shadow contacts: load life events: %w", err)
	}
	if len(eventIDs) == 0 {
		return nil
	}
	name := strings.TrimSpace(strings.Join([]string{mapping.FirstName, mapping.LastName}, " "))
	if name == "" {
		name = mapping.Email
	}
	if err := tx.Table("life_events").
		Where("id IN ? AND vault_id = ? AND subject_user_id IS NULL", eventIDs, mapping.VaultID).
		Updates(map[string]interface{}{"subject_user_id": mapping.UserID, "subject_user_name": name}).Error; err != nil {
		return fmt.Errorf("migrate shadow contacts: map life event subjects: %w", err)
	}
	return nil
}

func backfillLegacyMoodVaultIDs(tx *gorm.DB) error {
	if !tx.Migrator().HasTable("mood_tracking_events") || !tx.Migrator().HasTable("mood_tracking_parameters") {
		return nil
	}
	if err := tx.Exec(`
		UPDATE mood_tracking_events
		SET vault_id = (
			SELECT mood_tracking_parameters.vault_id
			FROM mood_tracking_parameters
			WHERE mood_tracking_parameters.id = mood_tracking_events.mood_tracking_parameter_id
		)
		WHERE vault_id IS NULL OR vault_id = ''
	`).Error; err != nil {
		return fmt.Errorf("migrate shadow contacts: backfill mood vaults: %w", err)
	}
	return nil
}

func deleteLegacyShadowContactData(tx *gorm.DB, contactIDs []string) error {
	if err := deleteDependentRows(tx, "contact_reminder_scheduled", "contact_reminder_id", "contact_reminders", "id", "contact_id", contactIDs); err != nil {
		return err
	}
	if err := deleteDependentRows(tx, "contact_reminder_selected_users", "contact_reminder_id", "contact_reminders", "id", "contact_id", contactIDs); err != nil {
		return err
	}
	if err := deleteDependentRows(tx, "streaks", "goal_id", "goals", "id", "contact_id", contactIDs); err != nil {
		return err
	}

	if err := updateColumnIfPresent(tx, "contacts", "first_met_through_contact_id", contactIDs, nil); err != nil {
		return err
	}
	if err := updateColumnIfPresent(tx, "life_events", "paid_by_contact_id", contactIDs, nil); err != nil {
		return err
	}
	if err := updateColumnIfPresent(tx, "dav_sync_logs", "contact_id", contactIDs, nil); err != nil {
		return err
	}
	if tx.Migrator().HasTable("files") && hasColumn(tx, "files", "ufileable_id") {
		if err := tx.Table("files").Where("ufileable_id IN ?", contactIDs).Update("ufileable_id", nil).Error; err != nil {
			return fmt.Errorf("migrate shadow contacts: detach files: %w", err)
		}
	}

	directTables := []string{
		"contact_vault_user", "contact_feed_items", "task_contacts", "contact_subscription_states",
		"contact_information", "contact_important_dates", "contact_reminders", "calls", "contact_address", "gifts", "pets",
		"goals", "quick_facts", "notes", "contact_post", "contact_life_metric", "contact_group",
		"contact_label", "contact_companies", "life_event_participants",
	}
	for _, table := range directTables {
		if err := deleteRowsIfColumn(tx, table, "contact_id", contactIDs); err != nil {
			return err
		}
	}
	if tx.Migrator().HasTable("relationships") {
		if err := tx.Table("relationships").Where("contact_id IN ? OR related_contact_id IN ?", contactIDs, contactIDs).Delete(nil).Error; err != nil {
			return fmt.Errorf("migrate shadow contacts: delete relationships: %w", err)
		}
	}
	for _, table := range []string{"contact_loan", "contact_gift"} {
		if !tx.Migrator().HasTable(table) {
			continue
		}
		if err := tx.Table(table).Where("loaner_id IN ? OR loanee_id IN ?", contactIDs, contactIDs).Delete(nil).Error; err != nil {
			return fmt.Errorf("migrate shadow contacts: delete %s rows: %w", table, err)
		}
	}
	return nil
}

func deleteLegacyShadowContacts(tx *gorm.DB, contactIDs []string) error {
	if !tx.Migrator().HasTable("contacts") {
		return nil
	}
	if err := tx.Exec("DELETE FROM contacts WHERE id IN ?", contactIDs).Error; err != nil {
		return fmt.Errorf("migrate shadow contacts: delete contacts: %w", err)
	}
	return nil
}

func deleteDependentRows(tx *gorm.DB, childTable, childFK, parentTable, parentPK, parentContactFK string, contactIDs []string) error {
	if !tx.Migrator().HasTable(childTable) || !tx.Migrator().HasTable(parentTable) || !hasColumn(tx, parentTable, parentContactFK) {
		return nil
	}
	query := fmt.Sprintf("%s IN (SELECT %s FROM %s WHERE %s IN ?)", quoteIdentifier(childFK), quoteIdentifier(parentPK), quoteIdentifier(parentTable), quoteIdentifier(parentContactFK))
	if err := tx.Table(childTable).Where(query, contactIDs).Delete(nil).Error; err != nil {
		return fmt.Errorf("migrate shadow contacts: delete %s rows: %w", childTable, err)
	}
	return nil
}

func deleteRowsIfColumn(tx *gorm.DB, table, column string, values []string) error {
	if !tx.Migrator().HasTable(table) || !hasColumn(tx, table, column) {
		return nil
	}
	if err := tx.Table(table).Where(quoteIdentifier(column)+" IN ?", values).Delete(nil).Error; err != nil {
		return fmt.Errorf("migrate shadow contacts: delete %s rows: %w", table, err)
	}
	return nil
}

func updateColumnIfPresent(tx *gorm.DB, table, column string, values []string, value interface{}) error {
	if !tx.Migrator().HasTable(table) || !hasColumn(tx, table, column) {
		return nil
	}
	if err := tx.Table(table).Where(quoteIdentifier(column)+" IN ?", values).Update(column, value).Error; err != nil {
		return fmt.Errorf("migrate shadow contacts: update %s.%s: %w", table, column, err)
	}
	return nil
}

func dropLegacyShadowColumns(db *gorm.DB) error {
	if db.Dialector.Name() == "postgres" {
		if db.Migrator().HasTable("mood_tracking_events") {
			if err := db.Exec("ALTER TABLE mood_tracking_events DROP COLUMN IF EXISTS contact_id").Error; err != nil {
				return fmt.Errorf("migrate shadow contacts: drop mood contact_id: %w", err)
			}
		}
		if err := db.Exec("ALTER TABLE user_vault DROP COLUMN IF EXISTS contact_id").Error; err != nil {
			return fmt.Errorf("migrate shadow contacts: drop user_vault contact_id: %w", err)
		}
		return nil
	}
	if db.Migrator().HasTable("mood_tracking_events") && hasColumn(db, "mood_tracking_events", "contact_id") {
		if err := rebuildSQLiteTableWithoutLegacyColumn(db, "mood_tracking_events", &models.MoodTrackingEvent{}); err != nil {
			return fmt.Errorf("migrate shadow contacts: drop mood contact_id: %w", err)
		}
	}
	if hasColumn(db, "user_vault", "contact_id") {
		if err := db.Exec("DROP INDEX IF EXISTS idx_user_vault_contact_id").Error; err != nil {
			return fmt.Errorf("migrate shadow contacts: drop user_vault contact_id index: %w", err)
		}
		if err := db.Exec("ALTER TABLE user_vault DROP COLUMN contact_id").Error; err != nil {
			return fmt.Errorf("migrate shadow contacts: drop user_vault contact_id: %w", err)
		}
	}
	return nil
}

func rebuildSQLiteTableWithoutLegacyColumn(db *gorm.DB, tableName string, model interface{}) error {
	return db.Transaction(func(tx *gorm.DB) error {
		oldTableName := tableName + "_shadow_legacy"
		if err := tx.Exec(fmt.Sprintf("ALTER TABLE %s RENAME TO %s", quoteIdentifier(tableName), quoteIdentifier(oldTableName))).Error; err != nil {
			return err
		}
		var oldIndexNames []string
		if err := tx.Raw(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_autoindex_%'`, oldTableName).Scan(&oldIndexNames).Error; err != nil {
			return err
		}
		for _, indexName := range oldIndexNames {
			if err := tx.Exec(fmt.Sprintf("DROP INDEX IF EXISTS %s", quoteIdentifier(indexName))).Error; err != nil {
				return err
			}
		}
		if err := tx.Migrator().CreateTable(model); err != nil {
			return err
		}
		columns, err := sharedColumns(tx, oldTableName, tableName)
		if err != nil {
			return err
		}
		columnList := strings.Join(quoteIdentifiers(columns), ", ")
		if err := tx.Exec(fmt.Sprintf("INSERT INTO %s (%s) SELECT %s FROM %s", quoteIdentifier(tableName), columnList, columnList, quoteIdentifier(oldTableName))).Error; err != nil {
			return err
		}
		return tx.Exec(fmt.Sprintf("DROP TABLE %s", quoteIdentifier(oldTableName))).Error
	})
}

func uniqueShadowContactIDs(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
