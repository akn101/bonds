package services

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/testutil"
	"gorm.io/gorm"
)

type postDeletionTestContext struct {
	db             *gorm.DB
	vaultID        string
	postService    *PostService
	journalService *JournalService
}

type postDeletionFixture struct {
	ctx                           postDeletionTestContext
	targetJournal, controlJournal models.Journal
	targetPost, controlPost       models.Post
	targetMetric, controlMetric   models.JournalMetric
	targetFile, controlFile       models.File
	targetSlice, externalSlice    models.SliceOfLife
	sharedTag                     models.Tag
	uploadDir                     string
}

func setupPostDeletionTest(t *testing.T) postDeletionTestContext {
	t.Helper()
	db := testutil.SetupTestDBWithFKConstraints(t)
	registration, err := NewAuthService(db, testutil.TestJWTConfig()).Register(dto.RegisterRequest{
		FirstName: "Post", LastName: "Deletion", Email: "post-deletion@example.com", Password: "password123",
	}, "en")
	if err != nil {
		t.Fatalf("register user: %v", err)
	}
	vault, err := NewVaultService(db).CreateVault(registration.User.AccountID, registration.User.ID, dto.CreateVaultRequest{Name: "Post deletion vault"}, "en")
	if err != nil {
		t.Fatalf("create vault: %v", err)
	}
	return postDeletionTestContext{db: db, vaultID: vault.ID, postService: NewPostService(db), journalService: NewJournalService(db)}
}

func setupPostDeletionFixture(t *testing.T, separateJournals bool) postDeletionFixture {
	t.Helper()
	ctx := setupPostDeletionTest(t)
	targetJournalResponse, err := ctx.journalService.Create(ctx.vaultID, dto.CreateJournalRequest{Name: "Target journal"})
	if err != nil {
		t.Fatalf("create target journal: %v", err)
	}
	targetJournal := models.Journal{ID: targetJournalResponse.ID, VaultID: targetJournalResponse.VaultID}
	controlJournal := targetJournal
	if separateJournals {
		controlJournalResponse, err := ctx.journalService.Create(ctx.vaultID, dto.CreateJournalRequest{Name: "Control journal"})
		if err != nil {
			t.Fatalf("create control journal: %v", err)
		}
		controlJournal = models.Journal{ID: controlJournalResponse.ID, VaultID: controlJournalResponse.VaultID}
	}
	posts := []models.Post{
		{JournalID: targetJournal.ID, Title: strPtrOrNil("Target post"), WrittenAt: time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC)},
		{JournalID: controlJournal.ID, Title: strPtrOrNil("Control post"), WrittenAt: time.Date(2025, time.January, 2, 0, 0, 0, 0, time.UTC)},
	}
	if err := ctx.db.Create(&posts).Error; err != nil {
		t.Fatalf("create posts: %v", err)
	}
	if err := ctx.db.Create(&[]models.PostSection{
		{PostID: posts[0].ID, Position: 1, Label: "Target", Content: strPtrOrNil("delete me")},
		{PostID: posts[1].ID, Position: 1, Label: "Control", Content: strPtrOrNil("keep me")},
	}).Error; err != nil {
		t.Fatalf("create post sections: %v", err)
	}
	contact := models.Contact{VaultID: ctx.vaultID, FirstName: strPtrOrNil("Contact")}
	if err := ctx.db.Create(&contact).Error; err != nil {
		t.Fatalf("create contact: %v", err)
	}
	metrics := []models.JournalMetric{{JournalID: targetJournal.ID, Label: "Target metric"}, {JournalID: controlJournal.ID, Label: "Control metric"}}
	if err := ctx.db.Create(&metrics).Error; err != nil {
		t.Fatalf("create journal metrics: %v", err)
	}
	sharedTag := models.Tag{VaultID: ctx.vaultID, Name: "shared", Slug: "shared"}
	if err := ctx.db.Create(&sharedTag).Error; err != nil {
		t.Fatalf("create shared tag: %v", err)
	}
	if err := ctx.db.Create(&[]models.ContactPost{{PostID: posts[0].ID, ContactID: contact.ID}, {PostID: posts[1].ID, ContactID: contact.ID}}).Error; err != nil {
		t.Fatalf("create contact post rows: %v", err)
	}
	if err := ctx.db.Create(&[]models.PostMetric{{PostID: posts[0].ID, JournalMetricID: metrics[0].ID, Value: 1}, {PostID: posts[1].ID, JournalMetricID: metrics[1].ID, Value: 2}}).Error; err != nil {
		t.Fatalf("create post metrics: %v", err)
	}
	if err := ctx.db.Create(&[]models.PostTag{{PostID: posts[0].ID, TagID: sharedTag.ID}, {PostID: posts[1].ID, TagID: sharedTag.ID}}).Error; err != nil {
		t.Fatalf("create post tags: %v", err)
	}
	postFileType := "Post"
	files := []models.File{
		{VaultID: ctx.vaultID, FileableID: &posts[0].ID, FileableType: &postFileType, UUID: "target-post-file", MimeType: "image/jpeg", Name: "target.jpg", Type: "photo", Size: 1},
		{VaultID: ctx.vaultID, FileableID: &posts[1].ID, FileableType: &postFileType, UUID: "control-post-file", MimeType: "image/jpeg", Name: "control.jpg", Type: "photo", Size: 1},
	}
	if err := ctx.db.Create(&files).Error; err != nil {
		t.Fatalf("create post files: %v", err)
	}
	slices := []models.SliceOfLife{
		{JournalID: targetJournal.ID, Name: "Target slice"},
		{JournalID: controlJournal.ID, FileCoverImageID: &files[0].ID, Name: "External cover"},
	}
	if err := ctx.db.Create(&slices).Error; err != nil {
		t.Fatalf("create slices: %v", err)
	}
	uploadDir := t.TempDir()
	for _, file := range files {
		if err := os.WriteFile(filepath.Join(uploadDir, file.UUID), []byte(file.UUID), 0o644); err != nil {
			t.Fatalf("write %s: %v", file.UUID, err)
		}
	}
	ctx.postService.SetUploadDir(uploadDir)
	ctx.journalService.SetUploadDir(uploadDir)
	return postDeletionFixture{
		ctx: ctx, targetJournal: models.Journal{ID: targetJournal.ID}, controlJournal: controlJournal,
		targetPost: posts[0], controlPost: posts[1], targetMetric: metrics[0], controlMetric: metrics[1],
		targetFile: files[0], controlFile: files[1], targetSlice: slices[0], externalSlice: slices[1],
		sharedTag: sharedTag, uploadDir: uploadDir,
	}
}

func assertPostDependentCount(t *testing.T, db *gorm.DB, postID uint, expected int64) {
	t.Helper()
	for _, dependent := range []struct {
		name  string
		model interface{}
	}{
		{name: "post section", model: &models.PostSection{}}, {name: "contact post", model: &models.ContactPost{}},
		{name: "post tag", model: &models.PostTag{}}, {name: "post metric", model: &models.PostMetric{}},
	} {
		var count int64
		if err := db.Model(dependent.model).Where("post_id = ?", postID).Count(&count).Error; err != nil {
			t.Fatalf("count %s: %v", dependent.name, err)
		}
		if count != expected {
			t.Errorf("%s count = %d, want %d", dependent.name, count, expected)
		}
	}
}

func assertRecords(t *testing.T, db *gorm.DB, expected int64, records []struct {
	name  string
	model interface{}
	id    uint
}) {
	t.Helper()
	for _, record := range records {
		var count int64
		if err := db.Model(record.model).Where("id = ?", record.id).Count(&count).Error; err != nil {
			t.Fatalf("count %s: %v", record.name, err)
		}
		if count != expected {
			t.Errorf("%s count = %d, want %d", record.name, count, expected)
		}
	}
}

func TestPostServiceDeleteCleansAllDependentsWithForeignKeyConstraints(t *testing.T) {
	fixture := setupPostDeletionFixture(t, false)

	if err := fixture.ctx.postService.Delete(fixture.targetPost.ID, fixture.targetJournal.ID, fixture.ctx.vaultID); err != nil {
		t.Fatalf("delete post: %v", err)
	}

	assertRecords(t, fixture.ctx.db, 0, []struct {
		name  string
		model interface{}
		id    uint
	}{{name: "target post", model: &models.Post{}, id: fixture.targetPost.ID}, {name: "target file", model: &models.File{}, id: fixture.targetFile.ID}})
	assertPostDependentCount(t, fixture.ctx.db, fixture.targetPost.ID, 0)
	if _, err := os.Stat(filepath.Join(fixture.uploadDir, fixture.targetFile.UUID)); !os.IsNotExist(err) {
		t.Errorf("target post file should be removed from disk, got %v", err)
	}
	if err := fixture.ctx.db.First(&fixture.externalSlice, fixture.externalSlice.ID).Error; err != nil {
		t.Fatalf("external slice should remain: %v", err)
	}
	if fixture.externalSlice.FileCoverImageID != nil {
		t.Errorf("external slice file cover should be NULL, got %d", *fixture.externalSlice.FileCoverImageID)
	}
	assertRecords(t, fixture.ctx.db, 1, []struct {
		name  string
		model interface{}
		id    uint
	}{
		{name: "control post", model: &models.Post{}, id: fixture.controlPost.ID}, {name: "shared tag", model: &models.Tag{}, id: fixture.sharedTag.ID},
		{name: "target journal metric", model: &models.JournalMetric{}, id: fixture.targetMetric.ID}, {name: "control file", model: &models.File{}, id: fixture.controlFile.ID},
	})
	assertPostDependentCount(t, fixture.ctx.db, fixture.controlPost.ID, 1)
	if _, err := os.Stat(filepath.Join(fixture.uploadDir, fixture.controlFile.UUID)); err != nil {
		t.Errorf("control post file should remain on disk: %v", err)
	}
}

func TestJournalServiceDeleteCleansPostsAndJournalDependentsWithForeignKeyConstraints(t *testing.T) {
	fixture := setupPostDeletionFixture(t, true)

	if err := fixture.ctx.journalService.Delete(fixture.targetJournal.ID, fixture.ctx.vaultID); err != nil {
		t.Fatalf("delete journal: %v", err)
	}

	assertRecords(t, fixture.ctx.db, 0, []struct {
		name  string
		model interface{}
		id    uint
	}{
		{name: "target journal", model: &models.Journal{}, id: fixture.targetJournal.ID}, {name: "target post", model: &models.Post{}, id: fixture.targetPost.ID},
		{name: "target journal metric", model: &models.JournalMetric{}, id: fixture.targetMetric.ID}, {name: "target slice", model: &models.SliceOfLife{}, id: fixture.targetSlice.ID},
		{name: "target file", model: &models.File{}, id: fixture.targetFile.ID},
	})
	assertPostDependentCount(t, fixture.ctx.db, fixture.targetPost.ID, 0)
	if _, err := os.Stat(filepath.Join(fixture.uploadDir, fixture.targetFile.UUID)); !os.IsNotExist(err) {
		t.Errorf("target post file should be removed from disk, got %v", err)
	}
	if err := fixture.ctx.db.First(&fixture.externalSlice, fixture.externalSlice.ID).Error; err != nil {
		t.Fatalf("external slice should remain: %v", err)
	}
	if fixture.externalSlice.FileCoverImageID != nil {
		t.Errorf("external slice file cover should be NULL, got %d", *fixture.externalSlice.FileCoverImageID)
	}
	assertRecords(t, fixture.ctx.db, 1, []struct {
		name  string
		model interface{}
		id    uint
	}{
		{name: "control journal", model: &models.Journal{}, id: fixture.controlJournal.ID}, {name: "control post", model: &models.Post{}, id: fixture.controlPost.ID},
		{name: "control journal metric", model: &models.JournalMetric{}, id: fixture.controlMetric.ID}, {name: "shared tag", model: &models.Tag{}, id: fixture.sharedTag.ID},
		{name: "control file", model: &models.File{}, id: fixture.controlFile.ID},
	})
	assertPostDependentCount(t, fixture.ctx.db, fixture.controlPost.ID, 1)
	if _, err := os.Stat(filepath.Join(fixture.uploadDir, fixture.controlFile.UUID)); err != nil {
		t.Errorf("control post file should remain on disk: %v", err)
	}
}
