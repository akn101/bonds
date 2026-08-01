package services

import (
	"errors"
	"reflect"
	"testing"

	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

func TestContactMoveLifecycleDeletesSourceThenPushesTargetThenReindexes(t *testing.T) {
	// Given
	ctx := setupContactMoveLifecycle(t)

	// When
	response, err := ctx.moveService.MoveMany([]string{ctx.contact.ID}, ctx.sourceVaultID, ctx.targetVaultID, ctx.userID)

	// Then
	if err != nil {
		t.Fatalf("move contact: %v", err)
	}
	if response.MovedCount != 1 || response.Contacts[0].ID != ctx.contact.ID || response.Contacts[0].VaultID != ctx.targetVaultID {
		t.Fatalf("move response = %+v, want moved target contact", response)
	}
	remoteEvents := ctx.recordedRemoteEvents()
	if len(remoteEvents) != 2 || remoteEvents[0] != "source DELETE "+ctx.sourceState.DistantURI || remoteEvents[1] != "target PUT https://dav.example.com/target/"+ctx.contact.ID+".vcf" {
		t.Fatalf("remote events = %#v, want source DELETE before target PUT", remoteEvents)
	}
	if !reflect.DeepEqual(ctx.searchEngine.recordedEvents(), []string{"search contact", "search note"}) {
		t.Fatalf("search events = %#v, want contact then note reindex after DAV", ctx.searchEngine.recordedEvents())
	}
	if !reflect.DeepEqual(ctx.recordedLifecycleEvents(), []string{"source DELETE", "target PUT", "search contact", "search note"}) {
		t.Fatalf("lifecycle events = %#v, want source DELETE, target PUT, then contact/note reindex", ctx.recordedLifecycleEvents())
	}
	var sourceState models.ContactSubscriptionState
	if err := ctx.db.Where("id = ?", ctx.sourceState.ID).First(&sourceState).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("source subscription state lookup = %v, want record not found", err)
	}
	sourceFeed, _, err := NewFeedService(ctx.db).GetFeed(ctx.sourceVaultID, 1, 20, ctx.userID)
	if err != nil {
		t.Fatalf("load source feed: %v", err)
	}
	targetFeed, _, err := NewFeedService(ctx.db).GetFeed(ctx.targetVaultID, 1, 20, ctx.userID)
	if err != nil {
		t.Fatalf("load target feed: %v", err)
	}
	sourceContainsHistoricalNote := false
	for _, item := range sourceFeed {
		if item.Action == ActionNoteCreated {
			sourceContainsHistoricalNote = true
		}
	}
	if !sourceContainsHistoricalNote {
		t.Fatalf("source feed = %+v, want historical note event", sourceFeed)
	}
	for _, item := range targetFeed {
		if item.Action == ActionNoteCreated {
			t.Fatal("target feed unexpectedly contains source historical note event")
		}
	}
}

func TestContactMoveLifecycleSameVaultLeavesDavAndSearchUntouched(t *testing.T) {
	// Given
	ctx := setupContactMoveLifecycle(t)

	// When
	_, err := ctx.moveService.MoveMany([]string{ctx.contact.ID}, ctx.sourceVaultID, ctx.sourceVaultID, ctx.userID)

	// Then
	if err != nil {
		t.Fatalf("same-vault move: %v", err)
	}
	if events := ctx.recordedRemoteEvents(); len(events) != 0 {
		t.Fatalf("remote events = %#v, want none", events)
	}
	if events := ctx.searchEngine.recordedEvents(); len(events) != 0 {
		t.Fatalf("search events = %#v, want none", events)
	}
	var state models.ContactSubscriptionState
	if err := ctx.db.Where("id = ?", ctx.sourceState.ID).First(&state).Error; err != nil {
		t.Fatalf("source state after same-vault move: %v", err)
	}
}
