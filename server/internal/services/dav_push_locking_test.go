package services

import (
	"testing"
	"time"
)

func TestContactDAVOperationLockRegistryRemovesEntryAfterWaiterReleases(t *testing.T) {
	// Given
	var registry contactDAVOperationLockRegistry
	contactID := "serialized-contact"
	releaseHolder := registry.lock(contactID)
	waiterAcquired := make(chan func(), 1)
	go func() { waiterAcquired <- registry.lock(contactID) }()
	waitForContactDAVLockReferences(t, &registry, contactID, 2)

	// When
	releaseHolder()
	var releaseWaiter func()
	select {
	case releaseWaiter = <-waiterAcquired:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for DAV lock waiter")
	}
	waitForContactDAVLockReferences(t, &registry, contactID, 1)
	releaseWaiter()

	// Then
	waitForContactDAVLockRemoval(t, &registry, contactID)
}
