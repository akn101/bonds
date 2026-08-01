package database

import (
	"fmt"
	"testing"

	"github.com/naiba/bonds/internal/models"
)

func TestAutoMigrateRemovesLegacyCrossVaultContactGroupAndPostPivots(t *testing.T) {
	db := openMigrationTestDB(t)

	for _, statement := range []string{
		`CREATE TABLE accounts (id text PRIMARY KEY)`,
		`CREATE TABLE vaults (id text PRIMARY KEY, account_id text NOT NULL, type text NOT NULL, name text NOT NULL)`,
		`CREATE TABLE contacts (id text PRIMARY KEY, vault_id text NOT NULL)`,
		`CREATE TABLE groups (id integer PRIMARY KEY, vault_id text NOT NULL, name text NOT NULL)`,
		`CREATE TABLE journals (id integer PRIMARY KEY, vault_id text NOT NULL, name text NOT NULL)`,
		`CREATE TABLE posts (id integer PRIMARY KEY, journal_id integer NOT NULL, written_at datetime NOT NULL)`,
		`CREATE TABLE contact_group (id integer PRIMARY KEY AUTOINCREMENT, group_id integer NOT NULL, contact_id text NOT NULL, created_at datetime, updated_at datetime)`,
		`CREATE TABLE contact_post (id integer PRIMARY KEY AUTOINCREMENT, post_id integer NOT NULL, contact_id text NOT NULL, created_at datetime, updated_at datetime)`,
		`INSERT INTO accounts (id) VALUES ('account-1')`,
		`INSERT INTO vaults (id, account_id, type, name) VALUES ('vault-1', 'account-1', 'private', 'Vault 1'), ('vault-2', 'account-1', 'private', 'Vault 2')`,
		`INSERT INTO contacts (id, vault_id) VALUES ('contact-1', 'vault-1'), ('contact-2', 'vault-2')`,
		`INSERT INTO groups (id, vault_id, name) VALUES (1, 'vault-1', 'Group 1'), (2, 'vault-2', 'Group 2')`,
		`INSERT INTO journals (id, vault_id, name) VALUES (1, 'vault-1', 'Journal 1'), (2, 'vault-2', 'Journal 2')`,
		`INSERT INTO posts (id, journal_id, written_at) VALUES (1, 1, CURRENT_TIMESTAMP), (2, 2, CURRENT_TIMESTAMP)`,
		`INSERT INTO contact_group (group_id, contact_id) VALUES (1, 'contact-1'), (1, 'contact-1'), (2, 'contact-2'), (2, 'contact-1'), (1, 'contact-2')`,
		`INSERT INTO contact_post (post_id, contact_id) VALUES (1, 'contact-1'), (1, 'contact-1'), (2, 'contact-2'), (2, 'contact-1'), (1, 'contact-2')`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("prepare legacy pivot rows: %v", err)
		}
	}

	if err := AutoMigrate(db); err != nil {
		t.Fatalf("AutoMigrate failed: %v", err)
	}

	for _, pivot := range []struct {
		tableName      string
		firstKeyColumn string
	}{
		{tableName: "contact_group", firstKeyColumn: "group_id"},
		{tableName: "contact_post", firstKeyColumn: "post_id"},
	} {
		var total int64
		if err := db.Table(pivot.tableName).Count(&total).Error; err != nil {
			t.Fatalf("count %s rows: %v", pivot.tableName, err)
		}
		if total != 2 {
			t.Fatalf("%s rows = %d, want 2", pivot.tableName, total)
		}

		for _, expected := range []struct {
			firstKeyValue int
			contactID     string
			count         int64
		}{
			{firstKeyValue: 1, contactID: "contact-1", count: 1},
			{firstKeyValue: 2, contactID: "contact-2", count: 1},
			{firstKeyValue: 2, contactID: "contact-1", count: 0},
			{firstKeyValue: 1, contactID: "contact-2", count: 0},
		} {
			var count int64
			if err := db.Table(pivot.tableName).
				Where(fmt.Sprintf("%s = ? AND contact_id = ?", pivot.firstKeyColumn), expected.firstKeyValue, expected.contactID).
				Count(&count).Error; err != nil {
				t.Fatalf("count %s pair: %v", pivot.tableName, err)
			}
			if count != expected.count {
				t.Fatalf("%s (%d, %s) rows = %d, want %d", pivot.tableName, expected.firstKeyValue, expected.contactID, count, expected.count)
			}
		}
	}

	if err := db.Create(&models.ContactGroup{GroupID: 1, ContactID: "contact-1"}).Error; err == nil {
		t.Fatal("expected duplicate contact_group row to fail")
	}
	if err := db.Create(&models.ContactPost{PostID: 1, ContactID: "contact-1"}).Error; err == nil {
		t.Fatal("expected duplicate contact_post row to fail")
	}

	if err := AutoMigrate(db); err != nil {
		t.Fatalf("second AutoMigrate failed: %v", err)
	}
	for _, tableName := range []string{"contact_group", "contact_post"} {
		var total int64
		if err := db.Table(tableName).Count(&total).Error; err != nil {
			t.Fatalf("count %s rows after second migration: %v", tableName, err)
		}
		if total != 2 {
			t.Fatalf("%s rows after second migration = %d, want 2", tableName, total)
		}
	}
}
