package services

import (
	"fmt"
	"strconv"

	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/search"
	"gorm.io/gorm"
)

type SearchService struct {
	db     *gorm.DB
	engine search.Engine
}

func NewSearchService(engine search.Engine) *SearchService {
	return &SearchService{engine: engine}
}

func NewSearchServiceWithDB(db *gorm.DB, engine search.Engine) *SearchService {
	return &SearchService{db: db, engine: engine}
}

func (s *SearchService) Search(vaultID, query string, page, perPage int) (*search.SearchResponse, error) {
	page, perPage = normalizeSearchPagination(page, perPage)
	offset := (page - 1) * perPage
	return s.engine.Search(vaultID, query, perPage, offset)
}

func (s *SearchService) SearchForUser(vaultID, userID, query string, page, perPage int) (*search.SearchResponse, error) {
	if userID == "" {
		return nil, ErrUserNotFound
	}
	if s.db == nil {
		return nil, fmt.Errorf("search service requires database for user-scoped result hydration")
	}
	page, perPage = normalizeSearchPagination(page, perPage)
	offset := (page - 1) * perPage
	resp, err := s.engine.Search(vaultID, query, perPage, offset)
	if err != nil || resp == nil {
		return resp, err
	}
	return s.hydrateSearchResults(resp, vaultID, userID)
}

func normalizeSearchPagination(page, perPage int) (int, int) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 20
	}
	return page, perPage
}

func (s *SearchService) hydrateSearchResults(resp *search.SearchResponse, vaultID, userID string) (*search.SearchResponse, error) {
	indexedResultCount := len(resp.Contacts) + len(resp.Notes)
	contactIDs := make([]string, 0, len(resp.Contacts))
	for _, result := range resp.Contacts {
		contactIDs = append(contactIDs, result.ID)
	}
	var contacts []models.Contact
	if len(contactIDs) > 0 {
		if err := s.db.Where("id IN ? AND vault_id = ? AND listed = ?", contactIDs, vaultID, true).Find(&contacts).Error; err != nil {
			return nil, err
		}
	}
	nameByID := make(map[string]string, len(contacts))
	if len(contacts) > 0 {
		formatter, err := newContactNameFormatter(s.db, userID)
		if err != nil {
			return nil, err
		}
		for i := range contacts {
			name, err := formatter.format(&contacts[i], "")
			if err != nil {
				return nil, err
			}
			nameByID[contacts[i].ID] = name
		}
	}
	filteredContacts := resp.Contacts[:0]
	for _, result := range resp.Contacts {
		if name, ok := nameByID[result.ID]; ok {
			result.Name = name
			filteredContacts = append(filteredContacts, result)
		}
	}
	resp.Contacts = filteredContacts

	noteIDByResultID := make(map[string]uint, len(resp.Notes))
	noteIDs := make([]uint, 0, len(resp.Notes))
	for _, result := range resp.Notes {
		noteID, err := strconv.ParseUint(result.ID, 10, strconv.IntSize)
		if err != nil || noteID == 0 {
			continue
		}
		noteIDByResultID[result.ID] = uint(noteID)
		noteIDs = append(noteIDs, uint(noteID))
	}
	type visibleNote struct {
		ID        uint
		ContactID string
	}
	var notes []visibleNote
	if len(noteIDs) > 0 {
		// Note vault_id alone is insufficient: hidden, soft-deleted, or inconsistent contacts would produce invalid deep links.
		if err := s.db.Table("notes").
			Select("notes.id, notes.contact_id").
			Joins("JOIN contacts ON contacts.id = notes.contact_id").
			Where("notes.id IN ? AND notes.vault_id = ?", noteIDs, vaultID).
			Where("contacts.vault_id = ? AND contacts.listed = ? AND contacts.deleted_at IS NULL", vaultID, true).
			Scan(&notes).Error; err != nil {
			return nil, err
		}
	}
	noteByID := make(map[uint]visibleNote, len(notes))
	for _, note := range notes {
		noteByID[note.ID] = note
	}
	filteredNotes := resp.Notes[:0]
	for _, result := range resp.Notes {
		noteID, ok := noteIDByResultID[result.ID]
		if !ok {
			continue
		}
		note, ok := noteByID[noteID]
		if !ok {
			continue
		}
		result.ContactID = note.ContactID
		filteredNotes = append(filteredNotes, result)
	}
	resp.Notes = filteredNotes

	removedResultCount := indexedResultCount - len(resp.Contacts) - len(resp.Notes)
	if removedResultCount > 0 {
		resp.Total -= removedResultCount
		if resp.Total < 0 {
			resp.Total = 0
		}
	}
	return resp, nil
}

func (s *SearchService) IndexContact(contact *models.Contact) error {
	firstName := ptrToStr(contact.FirstName)
	lastName := ptrToStr(contact.LastName)
	nickname := ptrToStr(contact.Nickname)
	jobPosition := ptrToStr(contact.JobPosition)
	return s.engine.IndexContact(contact.ID, contact.VaultID, firstName, lastName, nickname, jobPosition)
}

func (s *SearchService) IndexNote(note *models.Note) error {
	title := ptrToStr(note.Title)
	return s.engine.IndexNote(fmt.Sprintf("%d", note.ID), note.VaultID, note.ContactID, title, note.Body)
}

func (s *SearchService) DeleteContact(id string) error {
	return s.engine.DeleteDocument("contact:" + id)
}

func (s *SearchService) DeleteNote(id uint) error {
	return s.engine.DeleteDocument(fmt.Sprintf("note:%d", id))
}

// RebuildIndex clears the search index and re-indexes all contacts and notes.
func (s *SearchService) RebuildIndex(db *gorm.DB) (int, int, error) {
	if err := s.engine.Rebuild(); err != nil {
		return 0, 0, fmt.Errorf("failed to rebuild index: %w", err)
	}

	var contacts []models.Contact
	if err := db.Find(&contacts).Error; err != nil {
		return 0, 0, fmt.Errorf("failed to load contacts: %w", err)
	}
	contactCount := 0
	for i := range contacts {
		if err := s.IndexContact(&contacts[i]); err != nil {
			return contactCount, 0, fmt.Errorf("failed to index contact %s: %w", contacts[i].ID, err)
		}
		contactCount++
	}

	var notes []models.Note
	if err := db.Find(&notes).Error; err != nil {
		return contactCount, 0, fmt.Errorf("failed to load notes: %w", err)
	}
	noteCount := 0
	for i := range notes {
		if err := s.IndexNote(&notes[i]); err != nil {
			return contactCount, noteCount, fmt.Errorf("failed to index note %d: %w", notes[i].ID, err)
		}
		noteCount++
	}

	return contactCount, noteCount, nil
}
