package services

import (
	"sort"
	"strconv"
	"time"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
)

// Dimension keys returned by the demographics report. Age is derived rather
// than stored; the rest are attributes a contact carries directly or through a
// pivot.
const (
	demographicGender   = "gender"
	demographicPronoun  = "pronoun"
	demographicReligion = "religion"
	demographicAge      = "age"
	demographicLabel    = "label"
	demographicGroup    = "group"
)

// ageBands are the buckets an age is sorted into, low bound inclusive and high
// bound exclusive. The last band is open-ended.
var ageBands = []struct {
	key  string
	from int
	to   int
}{
	{"0_17", 0, 18},
	{"18_24", 18, 25},
	{"25_34", 25, 35},
	{"35_44", 35, 45},
	{"45_54", 45, 55},
	{"55_64", 55, 65},
	{"65_plus", 65, 0},
}

// DemographicsReport counts the vault's contacts by each attribute they can be
// grouped on.
//
// Scoping matches ReportService.Overview — listed, undeleted contacts — so the
// dimension totals always reconcile with the "Total contacts" stat card. A
// dimension nothing in the vault carries is still returned, because "nobody has
// a religion recorded" is itself the answer to a coverage question.
func (s *ReportService) DemographicsReport(vaultID, locale string) (*dto.DemographicsReportResponse, error) {
	var contacts []models.Contact
	if err := s.db.
		Select("id, gender_id, pronoun_id, religion_id").
		Where("vault_id = ? AND listed = ?", vaultID, true).
		Find(&contacts).Error; err != nil {
		return nil, err
	}

	total := len(contacts)
	response := &dto.DemographicsReportResponse{
		TotalContacts: total,
		Dimensions:    make([]dto.DemographicDimension, 0, 6),
	}
	if total == 0 {
		return response, nil
	}

	contactIDs := make([]string, len(contacts))
	for i, contact := range contacts {
		contactIDs[i] = contact.ID
	}

	genders, err := s.genderLabels(contacts, locale)
	if err != nil {
		return nil, err
	}
	pronouns, err := s.pronounLabels(contacts, locale)
	if err != nil {
		return nil, err
	}
	religions, err := s.religionLabels(contacts, locale)
	if err != nil {
		return nil, err
	}

	genderCounts := make(map[string]int)
	pronounCounts := make(map[string]int)
	religionCounts := make(map[string]int)
	for _, contact := range contacts {
		countLookup(genderCounts, contact.GenderID)
		countLookup(pronounCounts, contact.PronounID)
		countLookup(religionCounts, contact.ReligionID)
	}

	response.Dimensions = append(response.Dimensions,
		buildDimension(demographicGender, total, genderCounts, genders),
		buildDimension(demographicPronoun, total, pronounCounts, pronouns),
		buildDimension(demographicReligion, total, religionCounts, religions),
	)

	ageDimension, err := s.ageDimension(contactIDs, total)
	if err != nil {
		return nil, err
	}
	response.Dimensions = append(response.Dimensions, *ageDimension)

	labelDimension, err := s.labelDimension(contactIDs, total)
	if err != nil {
		return nil, err
	}
	groupDimension, err := s.groupDimension(contactIDs, total)
	if err != nil {
		return nil, err
	}
	response.Dimensions = append(response.Dimensions, *labelDimension, *groupDimension)

	return response, nil
}

// countLookup tallies one nullable foreign key, keyed by its id as a string.
func countLookup(counts map[string]int, id *uint) {
	if id == nil {
		return
	}
	counts[strconv.FormatUint(uint64(*id), 10)]++
}

func (s *ReportService) genderLabels(contacts []models.Contact, locale string) (map[string]string, error) {
	ids := make([]uint, 0, len(contacts))
	for _, contact := range contacts {
		if contact.GenderID != nil {
			ids = append(ids, *contact.GenderID)
		}
	}
	labels := make(map[string]string, len(ids))
	if len(ids) == 0 {
		return labels, nil
	}
	var rows []models.Gender
	if err := s.db.Where("id IN ?", uniqueUints(ids)).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		labels[strconv.FormatUint(uint64(row.ID), 10)] = translatedName(locale, row.Name, row.NameTranslationKey)
	}
	return labels, nil
}

func (s *ReportService) pronounLabels(contacts []models.Contact, locale string) (map[string]string, error) {
	ids := make([]uint, 0, len(contacts))
	for _, contact := range contacts {
		if contact.PronounID != nil {
			ids = append(ids, *contact.PronounID)
		}
	}
	labels := make(map[string]string, len(ids))
	if len(ids) == 0 {
		return labels, nil
	}
	var rows []models.Pronoun
	if err := s.db.Where("id IN ?", uniqueUints(ids)).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		labels[strconv.FormatUint(uint64(row.ID), 10)] = translatedName(locale, row.Name, row.NameTranslationKey)
	}
	return labels, nil
}

// religionLabels reads the religion rows. Religion names its key column
// TranslationKey where Gender and Pronoun use NameTranslationKey, so this
// cannot share their body.
func (s *ReportService) religionLabels(contacts []models.Contact, locale string) (map[string]string, error) {
	ids := make([]uint, 0, len(contacts))
	for _, contact := range contacts {
		if contact.ReligionID != nil {
			ids = append(ids, *contact.ReligionID)
		}
	}
	labels := make(map[string]string, len(ids))
	if len(ids) == 0 {
		return labels, nil
	}
	var rows []models.Religion
	if err := s.db.Where("id IN ?", uniqueUints(ids)).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		labels[strconv.FormatUint(uint64(row.ID), 10)] = translatedName(locale, row.Name, row.TranslationKey)
	}
	return labels, nil
}

// ageDimension buckets contacts by their birthdate.
//
// A birthdate is an important date whose type row is marked internal_type
// 'birthdate'; matching on the label would break in every locale but English.
// Contacts whose birthday has no year — common, and modelled explicitly by
// is_year_unknown — have no age and land in Unset alongside those with no
// birthday at all. A year alone, though, is enough: ages here only need to
// land in a ~decade band, so the "year" and "month" precisions the date model
// explicitly supports must not be discarded for lacking a day.
func (s *ReportService) ageDimension(contactIDs []string, total int) (*dto.DemographicDimension, error) {
	var dates []models.ContactImportantDate
	if err := s.db.
		Joins("JOIN contact_important_date_types ON contact_important_date_types.id = contact_important_dates.contact_important_date_type_id").
		Where("contact_important_dates.contact_id IN ? AND contact_important_date_types.internal_type = ?", contactIDs, "birthdate").
		Where("contact_important_dates.deleted_at IS NULL").
		Find(&dates).Error; err != nil {
		return nil, err
	}

	// One contact can hold more than one birthdate row; the first that yields an
	// age wins, so the same person is never counted into two bands.
	seen := make(map[string]struct{}, len(dates))
	counts := make(map[string]int, len(ageBands))
	for i := range dates {
		date := dates[i]
		if _, done := seen[date.ContactID]; done {
			continue
		}
		age := ageFromPartialBirthdate(&date, time.Now())
		if age == nil {
			continue
		}
		seen[date.ContactID] = struct{}{}
		counts[ageBandKey(*age)]++
	}

	dimension := dto.DemographicDimension{
		Key:     demographicAge,
		Known:   len(seen),
		Unset:   total - len(seen),
		Buckets: make([]dto.DemographicBucket, 0, len(ageBands)),
	}
	// Age bands keep their natural order rather than sorting by count — a
	// histogram whose bars are reordered by height is not a histogram.
	for _, band := range ageBands {
		if counts[band.key] == 0 {
			continue
		}
		dimension.Buckets = append(dimension.Buckets, dto.DemographicBucket{
			Value: band.key,
			Label: band.key,
			Count: counts[band.key],
		})
	}
	return &dimension, nil
}

// ageFromPartialBirthdate computes an age from whatever precision the
// birthday was recorded at. Only a missing year makes the age unknowable;
// when the month (and day) are known they decide whether this year's birthday
// has passed, and when they are not, the year difference alone is at worst
// one off — invisible at the band widths this report draws.
//
// calculateAgeFromDate is deliberately not reused: it answers "how old is
// this person, exactly", which needs the full date, while this answers
// "which decade of life are they in".
func ageFromPartialBirthdate(date *models.ContactImportantDate, now time.Time) *int {
	if date.Year == nil {
		return nil
	}
	age := now.Year() - *date.Year
	if date.Month != nil {
		beforeBirthdayMonth := int(now.Month()) < *date.Month
		inBirthdayMonth := int(now.Month()) == *date.Month
		beforeBirthday := date.Day != nil && now.Day() < *date.Day
		if beforeBirthdayMonth || (inBirthdayMonth && beforeBirthday) {
			age--
		}
	}
	if age < 0 {
		return nil
	}
	return &age
}

func ageBandKey(age int) string {
	for _, band := range ageBands {
		if age >= band.from && (band.to == 0 || age < band.to) {
			return band.key
		}
	}
	return ageBands[len(ageBands)-1].key
}

// labelDimension counts contacts per label. Unlike gender a contact can carry
// several labels, so the buckets deliberately sum to more than Known.
func (s *ReportService) labelDimension(contactIDs []string, total int) (*dto.DemographicDimension, error) {
	type row struct {
		ContactID string `gorm:"column:contact_id"`
		ID        uint   `gorm:"column:id"`
		Name      string `gorm:"column:name"`
	}
	var rows []row
	if err := s.db.Table("contact_label").
		Select("contact_label.contact_id, labels.id, labels.name").
		Joins("JOIN labels ON labels.id = contact_label.label_id").
		Where("contact_label.contact_id IN ?", contactIDs).
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	counts := make(map[string]int)
	labels := make(map[string]string)
	seen := make(map[string]struct{})
	for _, r := range rows {
		key := strconv.FormatUint(uint64(r.ID), 10)
		counts[key]++
		labels[key] = r.Name
		seen[r.ContactID] = struct{}{}
	}
	dimension := buildDimension(demographicLabel, total, counts, labels)
	dimension.Known = len(seen)
	dimension.Unset = total - len(seen)
	return &dimension, nil
}

// groupDimension counts contacts per group. Groups are soft-deleted, so the
// deleted ones are excluded explicitly — the manual join means GORM will not do
// it for us.
func (s *ReportService) groupDimension(contactIDs []string, total int) (*dto.DemographicDimension, error) {
	type row struct {
		ContactID string `gorm:"column:contact_id"`
		ID        uint   `gorm:"column:id"`
		Name      string `gorm:"column:name"`
	}
	var rows []row
	if err := s.db.Table("contact_group").
		Select("contact_group.contact_id, groups.id, groups.name").
		Joins("JOIN groups ON groups.id = contact_group.group_id").
		Where("contact_group.contact_id IN ? AND groups.deleted_at IS NULL", contactIDs).
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	counts := make(map[string]int)
	labels := make(map[string]string)
	seen := make(map[string]struct{})
	for _, r := range rows {
		key := strconv.FormatUint(uint64(r.ID), 10)
		counts[key]++
		labels[key] = r.Name
		seen[r.ContactID] = struct{}{}
	}
	dimension := buildDimension(demographicGroup, total, counts, labels)
	dimension.Known = len(seen)
	dimension.Unset = total - len(seen)
	return &dimension, nil
}

// buildDimension turns raw counts into a sorted dimension. Buckets come back
// biggest first so the chart reads top-down, ties broken by label so the order
// is stable between requests.
func buildDimension(key string, total int, counts map[string]int, labels map[string]string) dto.DemographicDimension {
	buckets := make([]dto.DemographicBucket, 0, len(counts))
	known := 0
	for value, count := range counts {
		known += count
		buckets = append(buckets, dto.DemographicBucket{
			Value: value,
			Label: labels[value],
			Count: count,
		})
	}
	sort.Slice(buckets, func(i, j int) bool {
		if buckets[i].Count != buckets[j].Count {
			return buckets[i].Count > buckets[j].Count
		}
		return buckets[i].Label < buckets[j].Label
	})
	return dto.DemographicDimension{
		Key:     key,
		Known:   known,
		Unset:   total - known,
		Buckets: buckets,
	}
}
