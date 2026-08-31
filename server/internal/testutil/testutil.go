package testutil

import (
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/naiba/bonds/internal/config"
	"github.com/naiba/bonds/internal/database"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// PostgresDSNEnv, when set, runs the suite against PostgreSQL instead of
// SQLite so dialect-specific behaviour is exercised on both databases the
// project supports. Each test gets its own schema, dropped on cleanup, so
// tests stay independent and can run in parallel.
const PostgresDSNEnv = "BONDS_TEST_POSTGRES_DSN"

var pgSchemaSeq atomic.Uint64

func SetupTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	if dsn := os.Getenv(PostgresDSNEnv); dsn != "" {
		return setupPostgresTestDB(t, dsn)
	}
	return setupSQLiteTestDB(t, true)
}

// setupPostgresTestDB gives each test an isolated schema on one server, which
// is far quicker than creating a database per test and leaves nothing behind.
func setupPostgresTestDB(t *testing.T, dsn string) *gorm.DB {
	t.Helper()
	schema := fmt.Sprintf("bonds_test_%d_%d", os.Getpid(), pgSchemaSeq.Add(1))
	admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("Failed to connect to PostgreSQL test database: %v", err)
	}
	if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatalf("Failed to create test schema %s: %v", schema, err)
	}
	db, err := gorm.Open(postgres.Open(withSearchPath(dsn, schema)), &gorm.Config{
		Logger:                                   logger.Default.LogMode(logger.Silent),
		DisableForeignKeyConstraintWhenMigrating: true,
	})
	if err != nil {
		t.Fatalf("Failed to connect to test schema %s: %v", schema, err)
	}
	t.Cleanup(func() {
		admin.Exec("DROP SCHEMA IF EXISTS " + schema + " CASCADE")
		if sqlDB, err := db.DB(); err == nil {
			sqlDB.Close()
		}
		if sqlDB, err := admin.DB(); err == nil {
			sqlDB.Close()
		}
	})
	if err := database.AutoMigrate(db); err != nil {
		t.Fatalf("Failed to migrate PostgreSQL test database: %v", err)
	}
	return db
}

// SetupTestDBWithFKConstraints creates a test DB with foreign-key constraints
// actually present in the schema and enforced. Use this for tests that need to
// catch FK violations (e.g. cascade-delete regressions). The default
// SetupTestDB strips FK constraints during migration, so `PRAGMA foreign_keys
// = ON` does nothing there — only this helper provides production-like FK
// behavior under SQLite.
func SetupTestDBWithFKConstraints(t *testing.T) *gorm.DB {
	t.Helper()
	db := setupSQLiteTestDB(t, false)
	if err := db.Exec("PRAGMA foreign_keys = ON").Error; err != nil {
		t.Fatalf("Failed to enable foreign keys: %v", err)
	}
	return db
}

// withSearchPath pins a DSN to one schema. libpq accepts two DSN spellings and
// they take parameters differently: a URL takes a query parameter, a
// keyword/value string takes another space-separated pair.
func withSearchPath(dsn, schema string) string {
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		sep := "?"
		if strings.Contains(dsn, "?") {
			sep = "&"
		}
		return dsn + sep + "search_path=" + schema
	}
	return dsn + " search_path=" + schema
}

func setupSQLiteTestDB(t *testing.T, disableFKConstraintMigration bool) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger:                                   logger.Default.LogMode(logger.Silent),
		DisableForeignKeyConstraintWhenMigrating: disableFKConstraintMigration,
	})
	if err != nil {
		t.Fatalf("Failed to connect to test database: %v", err)
	}
	// SQLite :memory: creates a separate database per connection.
	// Limit to 1 open connection so all queries hit the same in-memory DB.
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("Failed to get underlying sql.DB: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	if err := database.AutoMigrate(db); err != nil {
		t.Fatalf("Failed to migrate test database: %v", err)
	}
	return db
}

func TestJWTConfig() *config.JWTConfig {
	return &config.JWTConfig{
		Secret:     "test-secret-key",
		ExpiryHrs:  24,
		RefreshHrs: 168,
	}
}
