package services

import (
	"errors"
	"math"
	"regexp"
	"sort"
	"strings"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/utils"
	"github.com/naiba/bonds/pkg/response"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrLifeEventNotFound = errors.New("life event not found")
var ErrInvalidLifeEventTime = errors.New("invalid life event time")
var ErrInvalidLifeEventInput = errors.New("invalid life event input")

var contactMentionPattern = regexp.MustCompile(`@\[(?:\\[\\\]]|[^\]\r\n])+\]\(contact:([0-9a-fA-F-]{36})\)`)

type LifeEventService struct {
	db           *gorm.DB
	feedRecorder *FeedRecorder
}

func NewLifeEventService(db *gorm.DB) *LifeEventService      { return &LifeEventService{db: db} }
func (s *LifeEventService) SetFeedRecorder(fr *FeedRecorder) { s.feedRecorder = fr }

func (s *LifeEventService) List(vaultID, contactID string, page, perPage int) ([]dto.LifeEventResponse, response.Meta, error) {
	if contactID != "" {
		if err := validateContactBelongsToVault(s.db, contactID, vaultID); err != nil {
			return nil, response.Meta{}, err
		}
	}
	query := s.db.Model(&models.LifeEvent{}).Where("life_events.vault_id = ?", vaultID)
	if contactID != "" {
		query = query.Joins("JOIN life_event_participants ON life_event_participants.life_event_id = life_events.id").
			Where("life_event_participants.contact_id = ?", contactID)
	}
	var total int64
	if err := query.Distinct("life_events.id").Count(&total).Error; err != nil {
		return nil, response.Meta{}, err
	}
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 15
	}
	var events []models.LifeEvent
	if err := query.Distinct("life_events.*").Preload("Participants").
		Order("start_date IS NULL, start_date DESC, life_events.id DESC").
		Offset((page - 1) * perPage).Limit(perPage).Find(&events).Error; err != nil {
		return nil, response.Meta{}, err
	}
	items := make([]dto.LifeEventResponse, len(events))
	for i := range events {
		items[i] = toLifeEventResponse(&events[i])
	}
	return items, response.Meta{Page: page, PerPage: perPage, Total: total, TotalPages: int(math.Ceil(float64(total) / float64(perPage)))}, nil
}

func (s *LifeEventService) Create(vaultID string, req dto.LifeEventUpsertRequest) (*dto.LifeEventResponse, error) {
	event, contactIDs, err := s.eventFromRequest(vaultID, req)
	if err != nil {
		return nil, err
	}
	if err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&event).Error; err != nil {
			return err
		}
		return replaceLifeEventParticipants(tx, event.ID, contactIDs)
	}); err != nil {
		return nil, err
	}
	if s.feedRecorder != nil && req.PrimaryContactID != "" {
		entityType := "LifeEvent"
		s.feedRecorder.Record(req.PrimaryContactID, "", ActionLifeEventCreated, "Created a life event", &event.ID, &entityType)
	}
	return s.get(vaultID, event.ID)
}

func (s *LifeEventService) Update(vaultID string, id uint, req dto.LifeEventUpsertRequest) (*dto.LifeEventResponse, error) {
	var current models.LifeEvent
	if err := s.db.Where("id = ? AND vault_id = ?", id, vaultID).First(&current).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLifeEventNotFound
		}
		return nil, err
	}
	replacement, contactIDs, err := s.eventFromRequest(vaultID, req)
	if err != nil {
		return nil, err
	}
	replacement.ID, replacement.CreatedAt = current.ID, current.CreatedAt
	if replacement.ParentID != nil && *replacement.ParentID == id {
		return nil, ErrInvalidLifeEventTime
	}
	if err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&replacement).Error; err != nil {
			return err
		}
		return replaceLifeEventParticipantsLocked(tx, id, contactIDs)
	}); err != nil {
		return nil, err
	}
	return s.get(vaultID, id)
}

func (s *LifeEventService) Delete(vaultID string, id uint) error {
	var event models.LifeEvent
	if err := s.db.Where("id = ? AND vault_id = ?", id, vaultID).First(&event).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrLifeEventNotFound
		}
		return err
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.LifeEvent{}).Where("parent_id = ?", id).Update("parent_id", nil).Error; err != nil {
			return err
		}
		if err := tx.Where("life_event_id = ?", id).Delete(&models.LifeEventParticipant{}).Error; err != nil {
			return err
		}
		return tx.Delete(&event).Error
	})
}

func (s *LifeEventService) get(vaultID string, id uint) (*dto.LifeEventResponse, error) {
	var event models.LifeEvent
	if err := s.db.Preload("Participants").Where("id = ? AND vault_id = ?", id, vaultID).First(&event).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLifeEventNotFound
		}
		return nil, err
	}
	resp := toLifeEventResponse(&event)
	return &resp, nil
}

func (s *LifeEventService) eventFromRequest(vaultID string, req dto.LifeEventUpsertRequest) (models.LifeEvent, []string, error) {
	if strings.TrimSpace(req.Title) == "" || req.LifeEventTypeID == 0 {
		return models.LifeEvent{}, nil, ErrInvalidLifeEventInput
	}
	if !validPrecision(req.StartPrecision, true) || !validEndStatus(req.EndStatus) ||
		(normalizedEndStatus(req.EndStatus) == "known" && !validPrecision(req.EndPrecision, true)) ||
		(req.CalendarType != "" && req.CalendarType != "gregorian" && req.CalendarType != "lunar") {
		return models.LifeEvent{}, nil, ErrInvalidLifeEventInput
	}
	if err := validateLifeEventTypeBelongsToVault(s.db, req.LifeEventTypeID, vaultID); err != nil {
		return models.LifeEvent{}, nil, err
	}
	if err := validateLifeEventTime(req); err != nil {
		return models.LifeEvent{}, nil, err
	}
	if req.ParentID != nil {
		var count int64
		if err := s.db.Model(&models.LifeEvent{}).Where("id = ? AND vault_id = ? AND parent_id IS NULL", *req.ParentID, vaultID).Count(&count).Error; err != nil {
			return models.LifeEvent{}, nil, err
		}
		if count != 1 {
			return models.LifeEvent{}, nil, ErrLifeEventNotFound
		}
	}
	contactIDs := mergeContactIDs([]string{req.PrimaryContactID}, contactMentionIDs(req.Description))
	if len(contactIDs) == 0 {
		return models.LifeEvent{}, nil, ErrContactNotFound
	}
	if err := validateContactsBelongToVault(s.db, contactIDs, vaultID); err != nil {
		return models.LifeEvent{}, nil, err
	}
	typeID := req.LifeEventTypeID
	event := models.LifeEvent{
		VaultID: vaultID, ParentID: req.ParentID, LifeEventTypeID: &typeID, Title: strings.TrimSpace(req.Title),
		Description: strPtrOrNil(req.Description), StartDate: req.StartDate, StartPrecision: normalizedPrecision(req.StartPrecision),
		EndDate: req.EndDate, EndPrecision: normalizedPrecision(req.EndPrecision), EndStatus: normalizedEndStatus(req.EndStatus),
		CalendarType: req.CalendarType, OriginalDay: req.OriginalDay, OriginalMonth: req.OriginalMonth, OriginalYear: req.OriginalYear,
		EmotionID: req.EmotionID, Costs: req.Costs, CurrencyID: req.CurrencyID, DurationInMinutes: req.DurationInMinutes,
		Distance: req.Distance, DistanceUnit: strPtrOrNil(req.DistanceUnit), FromPlace: strPtrOrNil(req.FromPlace),
		ToPlace: strPtrOrNil(req.ToPlace), Place: strPtrOrNil(req.Place),
	}
	if event.CalendarType == "" {
		event.CalendarType = "gregorian"
	}
	return event, contactIDs, nil
}

func validateLifeEventTime(req dto.LifeEventUpsertRequest) error {
	status := normalizedEndStatus(req.EndStatus)
	if status == "known" {
		if req.StartDate == nil || req.EndDate == nil || req.EndDate.Before(*req.StartDate) {
			return ErrInvalidLifeEventTime
		}
	} else if req.EndDate != nil {
		return ErrInvalidLifeEventTime
	}
	return nil
}

func normalizedPrecision(value string) string {
	switch value {
	case "day", "month", "year":
		return value
	default:
		return "day"
	}
}
func validPrecision(value string, allowEmpty bool) bool {
	return (allowEmpty && value == "") || value == "day" || value == "month" || value == "year"
}
func validEndStatus(value string) bool {
	return value == "" || value == "none" || value == "known" || value == "ongoing" || value == "unknown"
}
func normalizedEndStatus(value string) string {
	switch value {
	case "known", "ongoing", "unknown":
		return value
	default:
		return "none"
	}
}

func contactMentionIDs(content string) []string {
	ids := make([]string, 0)
	for _, match := range contactMentionPattern.FindAllStringSubmatch(content, -1) {
		if len(match) == 2 {
			ids = append(ids, strings.ToLower(match[1]))
		}
	}
	return dedupeContactIDs(ids)
}

func validateLifeEventTypeBelongsToVault(db *gorm.DB, id uint, vaultID string) error {
	var count int64
	if err := db.Model(&models.LifeEventType{}).Joins("JOIN life_event_categories ON life_event_categories.id = life_event_types.life_event_category_id").
		Where("life_event_types.id = ? AND life_event_categories.vault_id = ?", id, vaultID).Count(&count).Error; err != nil {
		return err
	}
	if count != 1 {
		return ErrLifeEventNotFound
	}
	return nil
}

func toLifeEventResponse(le *models.LifeEvent) dto.LifeEventResponse {
	resp := dto.LifeEventResponse{ID: le.ID, VaultID: le.VaultID, ParentID: le.ParentID, LifeEventTypeID: le.LifeEventTypeID,
		Title: le.Title, Description: ptrToStr(le.Description), StartDate: le.StartDate, StartPrecision: le.StartPrecision,
		EndDate: le.EndDate, EndPrecision: le.EndPrecision, EndStatus: le.EndStatus, CalendarType: le.CalendarType,
		OriginalDay: le.OriginalDay, OriginalMonth: le.OriginalMonth, OriginalYear: le.OriginalYear, EmotionID: le.EmotionID,
		Costs: le.Costs, CurrencyID: le.CurrencyID, DurationInMinutes: le.DurationInMinutes, Distance: le.Distance,
		DistanceUnit: ptrToStr(le.DistanceUnit), FromPlace: ptrToStr(le.FromPlace), ToPlace: ptrToStr(le.ToPlace),
		Place: ptrToStr(le.Place), Participants: contactRefs(le.Participants), CreatedAt: le.CreatedAt, UpdatedAt: le.UpdatedAt}
	for i := range le.Milestones {
		resp.Milestones = append(resp.Milestones, toLifeEventResponse(&le.Milestones[i]))
	}
	return resp
}

func replaceLifeEventParticipants(tx *gorm.DB, lifeEventID uint, contactIDs []string) error {
	if err := tx.Where("life_event_id = ?", lifeEventID).Delete(&models.LifeEventParticipant{}).Error; err != nil {
		return err
	}
	ids := dedupeContactIDs(contactIDs)
	if len(ids) == 0 {
		return nil
	}
	rows := make([]models.LifeEventParticipant, 0, len(ids))
	for _, id := range ids {
		rows = append(rows, models.LifeEventParticipant{ContactID: id, LifeEventID: lifeEventID})
	}
	return tx.Create(&rows).Error
}

func replaceLifeEventParticipantsLocked(tx *gorm.DB, lifeEventID uint, contactIDs []string) error {
	var target models.LifeEvent
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").Where("id = ?", lifeEventID).First(&target).Error; err != nil {
		return err
	}
	return replaceLifeEventParticipants(tx, lifeEventID, contactIDs)
}

func mergeContactIDs(required, additional []string) []string {
	return dedupeContactIDs(append(append([]string{}, required...), additional...))
}
func dedupeContactIDs(ids []string) []string {
	seen := make(map[string]struct{}, len(ids))
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result
}

func contactRefs(contacts []models.Contact) []dto.TaskContactRef {
	refs := make([]dto.TaskContactRef, 0, len(contacts))
	for i := range contacts {
		refs = append(refs, dto.TaskContactRef{ID: contacts[i].ID, Name: utils.FormatContactName("%first_name% %last_name%", &contacts[i], contacts[i].ID)})
	}
	sort.Slice(refs, func(i, j int) bool {
		if refs[i].Name == refs[j].Name {
			return refs[i].ID < refs[j].ID
		}
		return refs[i].Name < refs[j].Name
	})
	return refs
}
