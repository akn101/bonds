package services

import (
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/search"
	"gorm.io/gorm"
)

type contactDeletionRecordingSearchEngine struct {
	mu                 sync.Mutex
	deletedIDs         []string
	sideEffectObserver func() contactDeletionSideEffectState
	sideEffectStates   chan<- contactDeletionSideEffectState
}

func (e *contactDeletionRecordingSearchEngine) IndexContact(string, string, string, string, string, string) error {
	return nil
}

func (e *contactDeletionRecordingSearchEngine) IndexNote(string, string, string, string, string) error {
	return nil
}

func (e *contactDeletionRecordingSearchEngine) DeleteDocument(id string) error {
	e.mu.Lock()
	e.deletedIDs = append(e.deletedIDs, id)
	e.mu.Unlock()
	if e.sideEffectObserver != nil && strings.HasPrefix(id, "contact:") {
		e.sideEffectStates <- e.sideEffectObserver()
	}
	return nil
}

func (e *contactDeletionRecordingSearchEngine) Search(string, string, int, int) (*search.SearchResponse, error) {
	return &search.SearchResponse{}, nil
}

func (e *contactDeletionRecordingSearchEngine) Rebuild() error { return nil }

func (e *contactDeletionRecordingSearchEngine) Close() error { return nil }

func (e *contactDeletionRecordingSearchEngine) deleted(id string) bool {
	for _, deletedID := range e.deleteIDs() {
		if deletedID == id {
			return true
		}
	}
	return false
}

func (e *contactDeletionRecordingSearchEngine) deleteIDs() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]string(nil), e.deletedIDs...)
}

type contactDeletionSideEffectState struct {
	source         string
	contactDeleted bool
	stateAbsent    bool
	err            error
}

func observeContactDeletionSideEffect(db *gorm.DB, contactID string, stateID uint, source string) contactDeletionSideEffectState {
	session := db.Session(&gorm.Session{NewDB: true})
	var deletedContact models.Contact
	contactErr := session.Unscoped().First(&deletedContact, "id = ?", contactID).Error
	var state models.ContactSubscriptionState
	stateErr := session.First(&state, "id = ?", stateID).Error
	return contactDeletionSideEffectState{source: source, contactDeleted: contactErr == nil && deletedContact.DeletedAt.Valid, stateAbsent: errors.Is(stateErr, gorm.ErrRecordNotFound), err: contactErr}
}

func assertContactDeletionSideEffectState(t *testing.T, state contactDeletionSideEffectState, source string) {
	t.Helper()
	if state.source != source || state.err != nil || !state.contactDeleted || !state.stateAbsent {
		t.Fatalf("%s side effect state = %+v, want committed deleted contact and absent subscription state", source, state)
	}
}
