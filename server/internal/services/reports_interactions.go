package services

import (
	"sort"
	"time"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
)

const (
	// defaultInteractionMonths is how far the time series looks back when the
	// caller does not say.
	defaultInteractionMonths = 24
	maxInteractionMonths     = 120
	// interactionListLimit caps the "most frequent" and "gone quiet" lists. Both
	// are meant to be read, not scrolled.
	interactionListLimit = 12
	// quietMinInteractions is how many separate days someone must have been in
	// touch on before a silence is worth remarking on. Below this the median gap
	// is not a rhythm, it is an accident.
	quietMinInteractions = 4
	// quietGapMultiplier and quietMinDays decide when a silence counts: the gap
	// must be several times the person's own normal rhythm, and long enough in
	// absolute terms that a weekly friend is not flagged after nine days.
	quietGapMultiplier = 3
	quietMinDays       = 30
)

// interactionEvent is one interaction, flattened out of the activity join.
type interactionEvent struct {
	ActivityID uint
	TypeID     uint
	Day        time.Time
}

// InteractionsReport describes how often the vault owner is actually in touch
// with people, derived from the activity log.
//
// Only activity types flagged counts_as_interaction are counted, which is the
// same rule the rest of Bonds uses to advance last_talked_to. That flag lives on
// the type and is user-editable, so a vault whose types are all unflagged gets
// an empty report — TotalActivities is returned alongside so the page can say
// why instead of drawing a blank chart.
//
// The monthly series covers the requested window; the per-contact figures are
// computed over all of history, because a median gap is meaningless if the
// window is shorter than the gap.
func (s *ReportService) InteractionsReport(vaultID, locale, userID string, months int) (*dto.InteractionsReportResponse, error) {
	if months <= 0 {
		months = defaultInteractionMonths
	}
	if months > maxInteractionMonths {
		months = maxInteractionMonths
	}

	formatter, err := newContactNameFormatter(s.db, userID)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	windowStart := monthStart(now).AddDate(0, -(months - 1), 0)
	// Activities can be dated in the future — a planned dinner, a booked call.
	// They are not history and must not be counted as it: the month series ends
	// at the current month, so a future event would be added to the totals while
	// having no bucket to appear in, and the report would not add up.
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	// The cut-off is the END of today. Activities are dated, but the stored
	// value can carry a time, so bounding at midnight would drop everything
	// logged earlier the same day.
	tomorrow := today.AddDate(0, 0, 1)

	var totalActivities int64
	if err := s.db.Model(&models.Activity{}).
		Where("vault_id = ? AND start_date >= ? AND start_date < ?", vaultID, windowStart, tomorrow).
		Count(&totalActivities).Error; err != nil {
		return nil, err
	}

	// The interaction flag is read from the live type row rather than snapshotted
	// onto the activity, because toggling it is expected to change history.
	type activityRow struct {
		ID        uint       `gorm:"column:id"`
		TypeID    uint       `gorm:"column:activity_type_id"`
		StartDate *time.Time `gorm:"column:start_date"`
	}
	var activities []activityRow
	if err := s.db.Table("activities").
		Select("activities.id, activities.activity_type_id, activities.start_date").
		Joins("JOIN activity_types ON activity_types.id = activities.activity_type_id").
		Where("activities.vault_id = ? AND activities.start_date IS NOT NULL AND activities.start_date < ? AND activity_types.counts_as_interaction = ?", vaultID, tomorrow, true).
		Scan(&activities).Error; err != nil {
		return nil, err
	}

	response := &dto.InteractionsReportResponse{
		TotalActivities: int(totalActivities),
		Months:          []dto.InteractionBucket{},
		Channels:        []dto.InteractionChannel{},
		MostFrequent:    []dto.InteractionContactItem{},
		GoneQuiet:       []dto.InteractionContactItem{},
	}

	response.Months = emptyMonthSeries(windowStart, now)

	if len(activities) == 0 {
		return response, nil
	}

	// One window contract for the whole report: every headline figure — totals,
	// channels and the monthly series — describes the requested window, so
	// changing it changes all of them together. The per-contact lists below are
	// the documented exception, because a rhythm measured only inside a
	// two-year window cannot describe a friendship with a three-year gap.
	events := make(map[uint]interactionEvent, len(activities))
	activityIDs := make([]uint, 0, len(activities))
	for _, activity := range activities {
		day := activity.StartDate.UTC().Truncate(24 * time.Hour)
		if day.After(today) {
			// Future-dated, so not part of any history this report describes —
			// neither the window totals nor the all-history per-contact cadence.
			continue
		}
		events[activity.ID] = interactionEvent{ActivityID: activity.ID, TypeID: activity.TypeID, Day: day}
		activityIDs = append(activityIDs, activity.ID)
		if !day.Before(windowStart) {
			response.TotalInteractions++
		}
	}

	// Monthly totals and per-channel series. Counting runs over activities, not
	// over participants, so a group dinner with six people is one interaction.
	monthIndex := make(map[string]int, len(response.Months))
	for i, bucket := range response.Months {
		monthIndex[bucket.Period] = i
	}
	perChannel := make(map[uint]map[string]int)
	channelTotals := make(map[uint]int)
	for _, event := range events {
		period := event.Day.Format("2006-01")
		i, inWindow := monthIndex[period]
		if !inWindow {
			// Outside the reported window: it still counts towards each
			// person's cadence below, but not towards the headline figures.
			continue
		}
		channelTotals[event.TypeID]++
		response.Months[i].Count++
		series, ok := perChannel[event.TypeID]
		if !ok {
			series = make(map[string]int)
			perChannel[event.TypeID] = series
		}
		series[period]++
	}

	channels, err := s.interactionChannels(perChannel, channelTotals, locale, response.Months)
	if err != nil {
		return nil, err
	}
	response.Channels = channels

	// Participants. A contact is credited with an interaction for each activity
	// they took part in; the pivot carries no vault id, so it is constrained by
	// the activity ids gathered above.
	type participantRow struct {
		ActivityID uint   `gorm:"column:activity_id"`
		ContactID  string `gorm:"column:contact_id"`
	}
	var participants []participantRow
	if err := s.db.Table("activity_participants").
		Select("activity_id, contact_id").
		Where("activity_id IN ?", activityIDs).
		Scan(&participants).Error; err != nil {
		return nil, err
	}
	if len(participants) == 0 {
		return response, nil
	}

	// Distinct days per contact: two conversations logged on one day are one
	// occasion, and counting them twice would report a gap of zero.
	daysByContact := make(map[string]map[time.Time]struct{})
	for _, participant := range participants {
		event, ok := events[participant.ActivityID]
		if !ok {
			continue
		}
		days, ok := daysByContact[participant.ContactID]
		if !ok {
			days = make(map[time.Time]struct{})
			daysByContact[participant.ContactID] = days
		}
		days[event.Day] = struct{}{}
	}
	response.ContactCount = len(daysByContact)

	contactIDs := make([]string, 0, len(daysByContact))
	for contactID := range daysByContact {
		contactIDs = append(contactIDs, contactID)
	}
	names, err := s.contactDisplayNames(vaultID, contactIDs, formatter)
	if err != nil {
		return nil, err
	}

	items := make([]dto.InteractionContactItem, 0, len(daysByContact))
	for contactID, days := range daysByContact {
		name, known := names[contactID]
		if !known {
			// Archived, deleted, or belonging to another vault — an activity can
			// outlive the contact list it was drawn from.
			continue
		}
		items = append(items, buildInteractionItem(contactID, name, days, now))
	}

	response.MostFrequent = topByCount(items)
	response.GoneQuiet = topQuiet(items, windowStart)
	return response, nil
}

// interactionChannels turns the per-type tallies into sorted channel series,
// each carrying the same month buckets as the overall series so the page can
// stack them without realigning anything.
func (s *ReportService) interactionChannels(perChannel map[uint]map[string]int, totals map[uint]int, locale string, months []dto.InteractionBucket) ([]dto.InteractionChannel, error) {
	typeIDs := make([]uint, 0, len(totals))
	for typeID := range totals {
		typeIDs = append(typeIDs, typeID)
	}
	var rows []models.ActivityType
	if err := s.db.Where("id IN ?", uniqueUints(typeIDs)).Find(&rows).Error; err != nil {
		return nil, err
	}
	byID := make(map[uint]models.ActivityType, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
	}

	channels := make([]dto.InteractionChannel, 0, len(totals))
	for typeID, total := range totals {
		row := byID[typeID]
		series := make([]dto.InteractionBucket, len(months))
		for i, bucket := range months {
			series[i] = dto.InteractionBucket{Period: bucket.Period, Count: perChannel[typeID][bucket.Period]}
		}
		channels = append(channels, dto.InteractionChannel{
			ActivityTypeID: typeID,
			Label:          translatedName(locale, row.Label, row.LabelTranslationKey),
			Icon:           ptrToStr(row.Icon),
			Color:          ptrToStr(row.Color),
			Count:          total,
			Months:         series,
		})
	}
	sort.Slice(channels, func(i, j int) bool {
		if channels[i].Count != channels[j].Count {
			return channels[i].Count > channels[j].Count
		}
		return channels[i].Label < channels[j].Label
	})
	return channels, nil
}

// contactDisplayNames formats the names of the contacts that are still listed in
// this vault, keyed by id. Contacts missing from the result have been archived
// or deleted since the activity was recorded.
func (s *ReportService) contactDisplayNames(vaultID string, contactIDs []string, formatter *contactNameFormatter) (map[string]string, error) {
	names := make(map[string]string, len(contactIDs))
	if len(contactIDs) == 0 {
		return names, nil
	}
	var contacts []models.Contact
	if err := s.db.
		Where("vault_id = ? AND listed = ? AND id IN ?", vaultID, true, contactIDs).
		Find(&contacts).Error; err != nil {
		return nil, err
	}
	for i := range contacts {
		name, err := formatter.format(&contacts[i], "")
		if err != nil {
			return nil, err
		}
		names[contacts[i].ID] = name
	}
	return names, nil
}

// buildInteractionItem derives one person's cadence from the distinct days they
// were in touch on.
func buildInteractionItem(contactID, name string, days map[time.Time]struct{}, now time.Time) dto.InteractionContactItem {
	ordered := make([]time.Time, 0, len(days))
	for day := range days {
		ordered = append(ordered, day)
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].Before(ordered[j]) })

	first := ordered[0]
	last := ordered[len(ordered)-1]
	sinceLast := int(now.Sub(last).Hours() / 24)
	if sinceLast < 0 {
		sinceLast = 0
	}

	item := dto.InteractionContactItem{
		ContactID:     contactID,
		ContactName:   name,
		Count:         len(ordered),
		FirstAt:       &first,
		LastAt:        &last,
		DaysSinceLast: &sinceLast,
	}
	if median := medianGapDays(ordered); median != nil {
		item.MedianGapDays = median
	}
	return item
}

// medianGapDays is the median number of days between consecutive contact days.
// The median rather than the mean: one three-year silence should not turn a
// weekly friend into a yearly one.
func medianGapDays(days []time.Time) *int {
	if len(days) < 2 {
		return nil
	}
	gaps := make([]int, 0, len(days)-1)
	for i := 1; i < len(days); i++ {
		gaps = append(gaps, int(days[i].Sub(days[i-1]).Hours()/24))
	}
	sort.Ints(gaps)
	middle := len(gaps) / 2
	median := gaps[middle]
	if len(gaps)%2 == 0 {
		median = (gaps[middle-1] + gaps[middle]) / 2
	}
	return &median
}

func topByCount(items []dto.InteractionContactItem) []dto.InteractionContactItem {
	sorted := make([]dto.InteractionContactItem, len(items))
	copy(sorted, items)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].Count != sorted[j].Count {
			return sorted[i].Count > sorted[j].Count
		}
		return sorted[i].ContactName < sorted[j].ContactName
	})
	if len(sorted) > interactionListLimit {
		sorted = sorted[:interactionListLimit]
	}
	return sorted
}

// topQuiet finds people the owner used to be in regular touch with and is not
// any more, measured against each person's own rhythm rather than one global
// threshold — a daily friend going quiet for three weeks matters, a yearly
// acquaintance doing the same does not.
//
// Anyone last heard from before the reported window is left out. Someone you
// stopped speaking to six years ago has not "gone quiet", they are simply part
// of your past, and burying this week's drifting friend under a decade of them
// would make the list unusable. Widening the window widens the list.
func topQuiet(items []dto.InteractionContactItem, windowStart time.Time) []dto.InteractionContactItem {
	quiet := make([]dto.InteractionContactItem, 0)
	for _, item := range items {
		if item.Count < quietMinInteractions || item.MedianGapDays == nil || item.DaysSinceLast == nil {
			continue
		}
		if item.LastAt == nil || item.LastAt.Before(windowStart) {
			continue
		}
		threshold := *item.MedianGapDays * quietGapMultiplier
		if threshold < quietMinDays {
			threshold = quietMinDays
		}
		if *item.DaysSinceLast > threshold {
			quiet = append(quiet, item)
		}
	}
	// Most overdue relative to their own rhythm first, so the top of the list is
	// the most out of character rather than merely the longest silence.
	sort.Slice(quiet, func(i, j int) bool {
		left := overdueRatio(quiet[i])
		right := overdueRatio(quiet[j])
		if left != right {
			return left > right
		}
		return quiet[i].ContactName < quiet[j].ContactName
	})
	if len(quiet) > interactionListLimit {
		quiet = quiet[:interactionListLimit]
	}
	return quiet
}

func overdueRatio(item dto.InteractionContactItem) float64 {
	median := *item.MedianGapDays
	if median < 1 {
		median = 1
	}
	return float64(*item.DaysSinceLast) / float64(median)
}

func monthStart(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}

// emptyMonthSeries lists every month in the window, including the ones with
// nothing in them — a series that omits its quiet months draws a lie.
func emptyMonthSeries(from, to time.Time) []dto.InteractionBucket {
	buckets := make([]dto.InteractionBucket, 0)
	for cursor := monthStart(from); !cursor.After(monthStart(to)); cursor = cursor.AddDate(0, 1, 0) {
		buckets = append(buckets, dto.InteractionBucket{Period: cursor.Format("2006-01")})
	}
	return buckets
}
