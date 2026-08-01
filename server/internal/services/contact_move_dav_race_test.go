package services

import (
	"context"
	"testing"
	"time"

	"github.com/emersion/go-vcard"
	"github.com/emersion/go-webdav/carddav"
	"github.com/naiba/bonds/internal/models"
)

func TestContactMoveWaitsForInFlightDavPushThenDeletesCapturedSourceObject(t *testing.T) {
	// Given
	ctx := setupContactMoveLifecycle(t)
	putStarted := make(chan string, 1)
	releasePut := make(chan struct{})
	ctx.pushService.SetClientFactory(&mockCardDAVClientFactory{client: &mockCardDAVClient{
		putAddrObjFn: func(_ context.Context, path string, _ vcard.Card) (*carddav.AddressObject, error) {
			putStarted <- path
			<-releasePut
			return &carddav.AddressObject{Path: path, ETag: "source-etag"}, nil
		},
		removeAllFn: func(_ context.Context, path string) error { ctx.recordRemote("source DELETE", path); return nil },
	}})
	pushDone := make(chan struct{})
	go func() { ctx.pushService.PushContactChange(ctx.contact.ID, ctx.sourceVaultID); close(pushDone) }()
	var sourcePutPath string
	select {
	case sourcePutPath = <-putStarted:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for source DAV PUT")
	}
	moveDone := make(chan error, 1)
	go func() {
		_, err := ctx.moveService.MoveMany([]string{ctx.contact.ID}, ctx.sourceVaultID, ctx.targetVaultID, ctx.userID)
		moveDone <- err
	}()
	waitForContactDAVLockReferences(t, &ctx.pushService.operationLocks, ctx.contact.ID, 2)

	// When
	close(releasePut)

	// Then
	select {
	case err := <-moveDone:
		if err != nil {
			t.Fatalf("move contact: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for move after source PUT release")
	}
	select {
	case <-pushDone:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for source push completion")
	}
	events := ctx.recordedRemoteEvents()
	if len(events) == 0 || events[0] != "source DELETE "+sourcePutPath {
		t.Fatalf("remote events = %#v, want DELETE of source PUT path", events)
	}
	var stateCount int64
	if err := ctx.db.Model(&models.ContactSubscriptionState{}).Where("contact_id = ? AND address_book_subscription_id = ?", ctx.contact.ID, ctx.sourceSubscription.ID).Count(&stateCount).Error; err != nil || stateCount != 0 {
		t.Fatalf("source state count = (%d, %v), want 0", stateCount, err)
	}
	waitForContactDAVLockRemoval(t, &ctx.pushService.operationLocks, ctx.contact.ID)
}
