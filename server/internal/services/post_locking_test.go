package services

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type mutationLockTrace struct {
	events      []string
	orderedByID map[string]bool
}

func recordMutationLocks(t *testing.T, db *gorm.DB) *mutationLockTrace {
	t.Helper()
	trace := &mutationLockTrace{orderedByID: make(map[string]bool)}
	const queryCallback = "post_journal_mutation_lock_trace_query"
	const deleteCallback = "post_journal_mutation_lock_trace_delete"
	if err := db.Callback().Query().Before("gorm:query").Register(queryCallback, func(tx *gorm.DB) {
		lockingClause, exists := tx.Statement.Clauses["FOR"]
		if !exists {
			return
		}
		locking, ok := lockingClause.Expression.(clause.Locking)
		if !ok || locking.Strength != clause.LockingStrengthUpdate {
			return
		}
		trace.events = append(trace.events, "lock:"+tx.Statement.Table)
		orderClause, exists := tx.Statement.Clauses["ORDER BY"]
		if exists && strings.Contains(strings.ToLower(fmt.Sprint(orderClause.Expression)), "id") {
			trace.orderedByID[tx.Statement.Table] = true
		}
	}); err != nil {
		t.Fatalf("register lock trace query callback: %v", err)
	}
	if err := db.Callback().Delete().After("gorm:delete").Register(deleteCallback, func(tx *gorm.DB) {
		trace.events = append(trace.events, "delete:"+tx.Statement.Table)
	}); err != nil {
		t.Fatalf("register lock trace delete callback: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Callback().Query().Remove(queryCallback); err != nil {
			t.Errorf("remove lock trace query callback: %v", err)
		}
		if err := db.Callback().Delete().Remove(deleteCallback); err != nil {
			t.Errorf("remove lock trace delete callback: %v", err)
		}
	})
	return trace
}

func (trace *mutationLockTrace) requireLockOrder(t *testing.T, want []string) {
	t.Helper()
	got := make([]string, 0, len(want))
	for _, event := range trace.events {
		if strings.HasPrefix(event, "lock:") {
			got = append(got, strings.TrimPrefix(event, "lock:"))
		}
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("update lock order = %v, want %v; events = %v", got, want, trace.events)
	}
	for _, table := range []string{"contacts", "posts"} {
		if strings.Contains(fmt.Sprint(want), table) && !trace.orderedByID[table] {
			t.Fatalf("%s update lock did not request id ASC order; events = %v", table, trace.events)
		}
	}
}

func (trace *mutationLockTrace) requireEventBefore(t *testing.T, before, after string) {
	t.Helper()
	beforeIndex := -1
	afterIndex := -1
	for index, event := range trace.events {
		if event == before && beforeIndex == -1 {
			beforeIndex = index
		}
		if event == after && afterIndex == -1 {
			afterIndex = index
		}
	}
	if beforeIndex == -1 || afterIndex == -1 || beforeIndex > afterIndex {
		t.Fatalf("expected %q before %q; events = %v", before, after, trace.events)
	}
}

func TestPostMutationsRequestUpdateLocksInStableOrder(t *testing.T) {
	t.Run("create", func(t *testing.T) {
		ctx := setupPostTestFull(t)
		contacts := []models.Contact{
			{VaultID: ctx.vaultID, FirstName: strPtrOrNil("Alice")},
			{VaultID: ctx.vaultID, FirstName: strPtrOrNil("Bob")},
		}
		if err := ctx.db.Create(&contacts).Error; err != nil {
			t.Fatalf("create contacts: %v", err)
		}
		trace := recordMutationLocks(t, ctx.db)

		_, err := ctx.svc.Create(ctx.journalID, ctx.vaultID, dto.CreatePostRequest{
			Title:      "Conversation",
			WrittenAt:  time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC),
			ContactIDs: []string{contacts[1].ID, contacts[0].ID},
		})
		if err != nil {
			t.Fatalf("create post: %v", err)
		}

		trace.requireLockOrder(t, []string{"contacts", "journals"})
	})

	t.Run("update", func(t *testing.T) {
		ctx := setupPostTestFull(t)
		contact := models.Contact{VaultID: ctx.vaultID, FirstName: strPtrOrNil("Alice")}
		if err := ctx.db.Create(&contact).Error; err != nil {
			t.Fatalf("create contact: %v", err)
		}
		post, err := ctx.svc.Create(ctx.journalID, ctx.vaultID, dto.CreatePostRequest{
			Title:     "Conversation",
			WrittenAt: time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC),
			Sections:  []dto.PostSectionInput{{Position: 1, Label: "Old", Content: "Old content"}},
		})
		if err != nil {
			t.Fatalf("create post: %v", err)
		}
		trace := recordMutationLocks(t, ctx.db)

		_, err = ctx.svc.Update(post.ID, ctx.journalID, ctx.vaultID, dto.UpdatePostRequest{
			Title:      "Updated conversation",
			ContactIDs: []string{contact.ID},
			Sections:   []dto.PostSectionInput{{Position: 1, Label: "New", Content: "New content"}},
		})
		if err != nil {
			t.Fatalf("update post: %v", err)
		}

		trace.requireLockOrder(t, []string{"contacts", "journals", "posts"})
		trace.requireEventBefore(t, "lock:posts", "delete:post_sections")
		trace.requireEventBefore(t, "lock:posts", "delete:contact_post")
	})

	t.Run("update with omitted contacts advances associated contacts", func(t *testing.T) {
		ctx := setupPostTestFull(t)
		contacts := []models.Contact{
			{VaultID: ctx.vaultID, FirstName: strPtrOrNil("Alice")},
			{VaultID: ctx.vaultID, FirstName: strPtrOrNil("Bob")},
		}
		if err := ctx.db.Create(&contacts).Error; err != nil {
			t.Fatalf("create contacts: %v", err)
		}
		post, err := ctx.svc.Create(ctx.journalID, ctx.vaultID, dto.CreatePostRequest{
			Title:      "Conversation",
			WrittenAt:  time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC),
			ContactIDs: []string{contacts[1].ID, contacts[0].ID},
		})
		if err != nil {
			t.Fatalf("create post: %v", err)
		}
		trace := recordMutationLocks(t, ctx.db)

		laterWrittenAt := time.Date(2025, time.February, 1, 0, 0, 0, 0, time.UTC)
		_, err = ctx.svc.Update(post.ID, ctx.journalID, ctx.vaultID, dto.UpdatePostRequest{
			Title:               "Updated conversation",
			WrittenAt:           laterWrittenAt,
			UpdateLastContacted: true,
		})
		if err != nil {
			t.Fatalf("update post: %v", err)
		}

		for _, contact := range contacts {
			var pivotCount int64
			if err := ctx.db.Model(&models.ContactPost{}).
				Where("post_id = ? AND contact_id = ?", post.ID, contact.ID).
				Count(&pivotCount).Error; err != nil {
				t.Fatalf("count contact post pivot for %q: %v", contact.ID, err)
			}
			if pivotCount != 1 {
				t.Fatalf("contact post pivot count for %q = %d, want 1", contact.ID, pivotCount)
			}
			var updatedContact models.Contact
			if err := ctx.db.First(&updatedContact, "id = ?", contact.ID).Error; err != nil {
				t.Fatalf("reload contact %q: %v", contact.ID, err)
			}
			if updatedContact.LastTalkedTo == nil || !updatedContact.LastTalkedTo.Equal(laterWrittenAt) {
				t.Fatalf("contact %q last_talked_to = %v, want %v", contact.ID, updatedContact.LastTalkedTo, laterWrittenAt)
			}
		}

		trace.requireLockOrder(t, []string{"contacts", "journals", "posts"})
	})

	t.Run("delete", func(t *testing.T) {
		ctx := setupPostTestFull(t)
		post, err := ctx.svc.Create(ctx.journalID, ctx.vaultID, dto.CreatePostRequest{
			Title:     "Conversation",
			WrittenAt: time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC),
			Sections:  []dto.PostSectionInput{{Position: 1, Label: "Entry", Content: "Content"}},
		})
		if err != nil {
			t.Fatalf("create post: %v", err)
		}
		trace := recordMutationLocks(t, ctx.db)

		if err := ctx.svc.Delete(post.ID, ctx.journalID, ctx.vaultID); err != nil {
			t.Fatalf("delete post: %v", err)
		}

		trace.requireLockOrder(t, []string{"journals", "posts"})
		trace.requireEventBefore(t, "lock:posts", "delete:post_metrics")
		trace.requireEventBefore(t, "lock:posts", "delete:post_sections")
		trace.requireEventBefore(t, "lock:posts", "delete:post_tag")
		trace.requireEventBefore(t, "lock:posts", "delete:contact_post")
		trace.requireEventBefore(t, "lock:posts", "delete:files")
	})
}

func TestJournalDeleteRequestsUpdateLocksBeforeChildCleanup(t *testing.T) {
	db, svc, vaultID := setupJournalTestWithDB(t)
	journal, err := svc.Create(vaultID, dto.CreateJournalRequest{Name: "Journal"})
	if err != nil {
		t.Fatalf("create journal: %v", err)
	}
	posts := []models.Post{
		{JournalID: journal.ID, WrittenAt: time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC)},
		{JournalID: journal.ID, WrittenAt: time.Date(2025, time.January, 2, 0, 0, 0, 0, time.UTC)},
	}
	if err := db.Create(&posts).Error; err != nil {
		t.Fatalf("create posts: %v", err)
	}
	sections := []models.PostSection{{PostID: posts[0].ID, Position: 1, Label: "Entry"}}
	if err := db.Create(&sections).Error; err != nil {
		t.Fatalf("create post sections: %v", err)
	}
	trace := recordMutationLocks(t, db)

	if err := svc.Delete(journal.ID, vaultID); err != nil {
		t.Fatalf("delete journal: %v", err)
	}

	trace.requireLockOrder(t, []string{"journals", "posts"})
	trace.requireEventBefore(t, "lock:posts", "delete:post_metrics")
	trace.requireEventBefore(t, "lock:posts", "delete:post_sections")
	trace.requireEventBefore(t, "lock:posts", "delete:post_tag")
	trace.requireEventBefore(t, "lock:posts", "delete:contact_post")
	trace.requireEventBefore(t, "lock:posts", "delete:files")
}
