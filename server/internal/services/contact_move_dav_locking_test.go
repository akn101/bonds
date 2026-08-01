package services

import (
	"testing"
	"time"
)

func TestContactMoveDavLocksAcquireAscendingAndReleaseWithoutLeak(t *testing.T) {
	// Given
	registry := &contactDAVOperationLockRegistry{}
	lowerID := "a-contact"
	higherID := "z-contact"
	releaseLower := registry.lock(lowerID)
	helperStarted := make(chan struct{})
	helperDone := make(chan struct{})
	go func() {
		close(helperStarted)
		release := lockMovedContactDAVOperations(registry, []string{higherID, lowerID})
		release()
		close(helperDone)
	}()
	<-helperStarted
	waitForContactDAVLockReferences(t, registry, lowerID, 2)
	registry.mu.Lock()
	_, higherExists := registry.locks[higherID]
	registry.mu.Unlock()
	if higherExists {
		t.Fatal("higher contact lock acquired before lexicographically lower lock released")
	}

	// When
	releaseLower()

	// Then
	select {
	case <-helperDone:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for sorted bulk DAV locks")
	}
	waitForContactDAVLockRemoval(t, registry, lowerID)
	waitForContactDAVLockRemoval(t, registry, higherID)
}
