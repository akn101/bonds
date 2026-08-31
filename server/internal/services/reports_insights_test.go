package services

import (
	"testing"
	"time"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/testutil"
	"gorm.io/gorm"
)

type insightsFixture struct {
	db      *gorm.DB
	service *ReportService
	vaultID string
	userID  string
}

func setupInsightsTest(t *testing.T, email string) *insightsFixture {
	t.Helper()
	db := testutil.SetupTestDB(t)
	authSvc := NewAuthService(db, testutil.TestJWTConfig())
	vaultSvc := NewVaultService(db)

	resp, err := authSvc.Register(dto.RegisterRequest{
		FirstName: "Test", LastName: "User", Email: email, Password: "password123",
	}, "en")
	if err != nil {
		t.Fatalf("Register failed: %v", err)
	}
	vault, err := vaultSvc.CreateVault(resp.User.AccountID, resp.User.ID, dto.CreateVaultRequest{Name: "Test Vault"}, "en")
	if err != nil {
		t.Fatalf("CreateVault failed: %v", err)
	}
	return &insightsFixture{db: db, service: NewReportService(db), vaultID: vault.ID, userID: resp.User.ID}
}

func (f *insightsFixture) contact(t *testing.T, firstName string) string {
	t.Helper()
	contact, err := NewContactService(f.db).CreateContact(f.vaultID, f.userID, dto.CreateContactRequest{FirstName: firstName})
	if err != nil {
		t.Fatalf("CreateContact(%s) failed: %v", firstName, err)
	}
	return contact.ID
}

// lookupID resolves a seeded lookup row by its translation key, so the tests do
// not depend on autoincrement ids.
func (f *insightsFixture) lookupID(t *testing.T, table, keyColumn, key string) uint {
	t.Helper()
	var id uint
	if err := f.db.Table(table).Select("id").Where(keyColumn+" = ?", key).Scan(&id).Error; err != nil {
		t.Fatalf("looking up %s %s: %v", table, key, err)
	}
	if id == 0 {
		t.Fatalf("no %s row with %s = %s", table, keyColumn, key)
	}
	return id
}

func (f *insightsFixture) dimension(t *testing.T, report *dto.DemographicsReportResponse, key string) dto.DemographicDimension {
	t.Helper()
	for _, dimension := range report.Dimensions {
		if dimension.Key == key {
			return dimension
		}
	}
	t.Fatalf("dimension %q missing from report", key)
	return dto.DemographicDimension{}
}

func TestDemographicsReportCountsAndUnset(t *testing.T) {
	f := setupInsightsTest(t, "insights-demographics@example.com")

	femaleID := f.lookupID(t, "genders", "name_translation_key", "seed.genders.female")
	maleID := f.lookupID(t, "genders", "name_translation_key", "seed.genders.male")
	sheHerID := f.lookupID(t, "pronouns", "name_translation_key", "seed.pronouns.she_her")

	alice := f.contact(t, "Alice")
	bob := f.contact(t, "Bob")
	f.contact(t, "Carol") // deliberately left with nothing set

	if err := f.db.Model(&models.Contact{}).Where("id = ?", alice).
		Updates(map[string]any{"gender_id": femaleID, "pronoun_id": sheHerID}).Error; err != nil {
		t.Fatalf("updating Alice: %v", err)
	}
	if err := f.db.Model(&models.Contact{}).Where("id = ?", bob).
		Update("gender_id", maleID).Error; err != nil {
		t.Fatalf("updating Bob: %v", err)
	}

	report, err := f.service.DemographicsReport(f.vaultID, "en")
	if err != nil {
		t.Fatalf("DemographicsReport failed: %v", err)
	}
	if report.TotalContacts != 3 {
		t.Fatalf("expected 3 contacts, got %d", report.TotalContacts)
	}

	gender := f.dimension(t, report, demographicGender)
	if gender.Known != 2 || gender.Unset != 1 {
		t.Fatalf("gender: expected known=2 unset=1, got known=%d unset=%d", gender.Known, gender.Unset)
	}
	if len(gender.Buckets) != 2 {
		t.Fatalf("expected 2 gender buckets, got %d", len(gender.Buckets))
	}
	// Labels come from the translation key, not the stored name column.
	for _, bucket := range gender.Buckets {
		if bucket.Label != "Female" && bucket.Label != "Male" {
			t.Fatalf("unexpected gender label %q", bucket.Label)
		}
		if bucket.Count != 1 {
			t.Fatalf("expected count 1 for %q, got %d", bucket.Label, bucket.Count)
		}
	}

	pronoun := f.dimension(t, report, demographicPronoun)
	if pronoun.Known != 1 || pronoun.Unset != 2 {
		t.Fatalf("pronoun: expected known=1 unset=2, got known=%d unset=%d", pronoun.Known, pronoun.Unset)
	}

	// A dimension nobody carries is still reported, so the page can say the
	// field is empty rather than omit it and imply it does not exist.
	religion := f.dimension(t, report, demographicReligion)
	if religion.Known != 0 || religion.Unset != 3 || len(religion.Buckets) != 0 {
		t.Fatalf("religion: expected 0 known / 3 unset / no buckets, got %d / %d / %d", religion.Known, religion.Unset, len(religion.Buckets))
	}
}

func TestDemographicsReportUsesRequestLocale(t *testing.T) {
	f := setupInsightsTest(t, "insights-demographics-locale@example.com")
	femaleID := f.lookupID(t, "genders", "name_translation_key", "seed.genders.female")
	alice := f.contact(t, "Alice")
	if err := f.db.Model(&models.Contact{}).Where("id = ?", alice).Update("gender_id", femaleID).Error; err != nil {
		t.Fatalf("updating Alice: %v", err)
	}

	report, err := f.service.DemographicsReport(f.vaultID, "fr")
	if err != nil {
		t.Fatalf("DemographicsReport failed: %v", err)
	}
	gender := f.dimension(t, report, demographicGender)
	if len(gender.Buckets) != 1 {
		t.Fatalf("expected 1 bucket, got %d", len(gender.Buckets))
	}
	if gender.Buckets[0].Label == "Female" {
		t.Fatalf("expected the French label, got the English one")
	}
}

func TestDemographicsReportAgeBands(t *testing.T) {
	f := setupInsightsTest(t, "insights-age@example.com")
	birthdateTypeID := f.lookupID(t, "contact_important_date_types", "internal_type", "birthdate")

	now := time.Now().UTC()
	young := f.contact(t, "Young")
	old := f.contact(t, "Old")
	yearless := f.contact(t, "Yearless")

	addBirthdate := func(contactID string, year *int, month, day int) {
		t.Helper()
		row := models.ContactImportantDate{
			ContactID:                  contactID,
			ContactImportantDateTypeID: &birthdateTypeID,
			Label:                      "Birthdate",
			Day:                        &day,
			Month:                      &month,
			Year:                       year,
		}
		if err := f.db.Create(&row).Error; err != nil {
			t.Fatalf("creating birthdate: %v", err)
		}
	}
	twenty := now.Year() - 20
	seventy := now.Year() - 70
	addBirthdate(young, &twenty, 1, 1)
	addBirthdate(old, &seventy, 1, 1)
	// No year: the model supports it and no age can be derived from it.
	addBirthdate(yearless, nil, 5, 5)

	report, err := f.service.DemographicsReport(f.vaultID, "en")
	if err != nil {
		t.Fatalf("DemographicsReport failed: %v", err)
	}
	age := f.dimension(t, report, demographicAge)
	if age.Known != 2 {
		t.Fatalf("expected 2 contacts with a usable age, got %d", age.Known)
	}
	if age.Unset != 1 {
		t.Fatalf("expected the yearless birthday to count as unset, got unset=%d", age.Unset)
	}
	if len(age.Buckets) != 2 {
		t.Fatalf("expected 2 populated bands, got %d", len(age.Buckets))
	}
	// Bands keep their natural order rather than sorting by size.
	if age.Buckets[0].Value != "18_24" || age.Buckets[1].Value != "65_plus" {
		t.Fatalf("bands out of order: %s then %s", age.Buckets[0].Value, age.Buckets[1].Value)
	}
}

func TestDemographicsReportExcludesArchivedContacts(t *testing.T) {
	f := setupInsightsTest(t, "insights-archived@example.com")
	archived := f.contact(t, "Archived")
	f.contact(t, "Listed")
	if err := f.db.Model(&models.Contact{}).Where("id = ?", archived).Update("listed", false).Error; err != nil {
		t.Fatalf("archiving: %v", err)
	}

	report, err := f.service.DemographicsReport(f.vaultID, "en")
	if err != nil {
		t.Fatalf("DemographicsReport failed: %v", err)
	}
	// Matches the Overview stat card, which also counts listed contacts only.
	if report.TotalContacts != 1 {
		t.Fatalf("expected archived contacts to be excluded, got total=%d", report.TotalContacts)
	}
}

func TestMapReportSeparatesGeocodedFromCounted(t *testing.T) {
	f := setupInsightsTest(t, "insights-map@example.com")
	alice := f.contact(t, "Alice")

	london := 51.5072
	westminster := -0.1276
	addresses := []models.Address{
		{VaultID: f.vaultID, City: strPtr("London"), Country: strPtr("United Kingdom"), Latitude: &london, Longitude: &westminster},
		{VaultID: f.vaultID, City: strPtr("Leeds"), Country: strPtr("United Kingdom")},
		{VaultID: f.vaultID, City: strPtr("Vienna"), Country: strPtr("Austria")},
	}
	for i := range addresses {
		if err := f.db.Create(&addresses[i]).Error; err != nil {
			t.Fatalf("creating address: %v", err)
		}
	}
	if err := f.db.Create(&models.ContactAddress{ContactID: alice, AddressID: addresses[0].ID}).Error; err != nil {
		t.Fatalf("linking address: %v", err)
	}

	report, err := f.service.MapReport(f.vaultID, f.userID)
	if err != nil {
		t.Fatalf("MapReport failed: %v", err)
	}
	if report.TotalAddresses != 3 {
		t.Fatalf("expected 3 addresses, got %d", report.TotalAddresses)
	}
	// Only the geocoded one becomes a point, but all three are counted by
	// country — which is what lets the map draw before anything is geocoded.
	if report.GeocodedCount != 1 || len(report.Points) != 1 {
		t.Fatalf("expected 1 geocoded point, got geocoded=%d points=%d", report.GeocodedCount, len(report.Points))
	}
	if len(report.Points[0].Contacts) != 1 || report.Points[0].Contacts[0].ContactID != alice {
		t.Fatalf("expected Alice at the London point, got %+v", report.Points[0].Contacts)
	}
	if len(report.Countries) != 2 {
		t.Fatalf("expected 2 countries, got %d", len(report.Countries))
	}
	if report.Countries[0].Country != "United Kingdom" || report.Countries[0].AddressCount != 2 {
		t.Fatalf("expected the UK first with 2 addresses, got %+v", report.Countries[0])
	}
	if report.Countries[0].Geocoded != 1 {
		t.Fatalf("expected 1 geocoded UK address, got %d", report.Countries[0].Geocoded)
	}
}

// interactionFixture adds an activity type flagged as an interaction, plus a
// helper to log activities against it.
func (f *insightsFixture) interactionType(t *testing.T, label string, counts bool) uint {
	t.Helper()
	category := models.ActivityCategory{VaultID: f.vaultID, Label: strPtr("Test")}
	if err := f.db.Create(&category).Error; err != nil {
		t.Fatalf("creating activity category: %v", err)
	}
	activityType := models.ActivityType{
		ActivityCategoryID:  category.ID,
		Label:               strPtr(label),
		Color:               strPtr("#1677ff"),
		Icon:                strPtr("phone"),
		CountsAsInteraction: counts,
	}
	if err := f.db.Create(&activityType).Error; err != nil {
		t.Fatalf("creating activity type: %v", err)
	}
	return activityType.ID
}

func (f *insightsFixture) logActivity(t *testing.T, typeID uint, day time.Time, contactIDs ...string) {
	t.Helper()
	activity := models.Activity{
		VaultID: f.vaultID, ActivityTypeID: &typeID, Title: "Talked",
		StartDate: &day, StartPrecision: "day",
	}
	if err := f.db.Create(&activity).Error; err != nil {
		t.Fatalf("creating activity: %v", err)
	}
	for _, contactID := range contactIDs {
		if err := f.db.Create(&models.ActivityParticipant{ContactID: contactID, ActivityID: activity.ID}).Error; err != nil {
			t.Fatalf("creating participant: %v", err)
		}
	}
}

func TestInteractionsReportOnlyCountsFlaggedTypes(t *testing.T) {
	f := setupInsightsTest(t, "insights-interactions-flag@example.com")
	alice := f.contact(t, "Alice")
	interaction := f.interactionType(t, "Phone call", true)
	other := f.interactionType(t, "Watched a movie", false)

	day := time.Now().UTC().AddDate(0, 0, -3)
	f.logActivity(t, interaction, day, alice)
	f.logActivity(t, other, day, alice)

	report, err := f.service.InteractionsReport(f.vaultID, "en", f.userID, 0)
	if err != nil {
		t.Fatalf("InteractionsReport failed: %v", err)
	}
	if report.TotalInteractions != 1 {
		t.Fatalf("expected only the flagged activity to count, got %d", report.TotalInteractions)
	}
	// The unflagged one is still reported in the total, so a vault with nothing
	// flagged can be told why its report is empty.
	if report.TotalActivities != 2 {
		t.Fatalf("expected 2 total activities, got %d", report.TotalActivities)
	}
	if len(report.Channels) != 1 || report.Channels[0].Label != "Phone call" {
		t.Fatalf("expected one Phone call channel, got %+v", report.Channels)
	}
}

func TestInteractionsReportMonthSeriesIsContiguous(t *testing.T) {
	f := setupInsightsTest(t, "insights-interactions-months@example.com")
	alice := f.contact(t, "Alice")
	interaction := f.interactionType(t, "Phone call", true)
	f.logActivity(t, interaction, time.Now().UTC(), alice)

	report, err := f.service.InteractionsReport(f.vaultID, "en", f.userID, 6)
	if err != nil {
		t.Fatalf("InteractionsReport failed: %v", err)
	}
	// Empty months are present, otherwise a chart drawn from this would compress
	// silences out of existence.
	if len(report.Months) != 6 {
		t.Fatalf("expected 6 month buckets, got %d", len(report.Months))
	}
	if report.Months[len(report.Months)-1].Count != 1 {
		t.Fatalf("expected today's interaction in the last bucket, got %+v", report.Months[len(report.Months)-1])
	}
	for _, channel := range report.Channels {
		if len(channel.Months) != len(report.Months) {
			t.Fatalf("channel series must align with the overall series, got %d vs %d", len(channel.Months), len(report.Months))
		}
	}
}

func TestInteractionsReportMedianGapAndQuietList(t *testing.T) {
	f := setupInsightsTest(t, "insights-interactions-quiet@example.com")
	regular := f.contact(t, "Regular")
	lapsed := f.contact(t, "Lapsed")
	interaction := f.interactionType(t, "Phone call", true)

	now := time.Now().UTC()
	// Weekly for six weeks, up to a few days ago.
	for week := 6; week >= 0; week-- {
		f.logActivity(t, interaction, now.AddDate(0, 0, -7*week-2), regular)
	}
	// Also weekly, but the last one was half a year ago.
	for week := 6; week >= 0; week-- {
		f.logActivity(t, interaction, now.AddDate(0, 0, -7*week-180), lapsed)
	}

	report, err := f.service.InteractionsReport(f.vaultID, "en", f.userID, 24)
	if err != nil {
		t.Fatalf("InteractionsReport failed: %v", err)
	}
	if report.ContactCount != 2 {
		t.Fatalf("expected 2 contacts, got %d", report.ContactCount)
	}

	byName := map[string]dto.InteractionContactItem{}
	for _, item := range report.MostFrequent {
		byName[item.ContactName] = item
	}
	if item, ok := byName["Regular"]; !ok || item.MedianGapDays == nil || *item.MedianGapDays != 7 {
		t.Fatalf("expected a 7-day median gap for Regular, got %+v", item)
	}

	if len(report.GoneQuiet) != 1 {
		t.Fatalf("expected exactly the lapsed contact to be quiet, got %d: %+v", len(report.GoneQuiet), report.GoneQuiet)
	}
	if report.GoneQuiet[0].ContactName != "Lapsed" {
		t.Fatalf("expected Lapsed, got %s", report.GoneQuiet[0].ContactName)
	}
}

func TestInteractionsReportCountsGroupActivityOnce(t *testing.T) {
	f := setupInsightsTest(t, "insights-interactions-group@example.com")
	alice := f.contact(t, "Alice")
	bob := f.contact(t, "Bob")
	interaction := f.interactionType(t, "In-person meeting", true)

	f.logActivity(t, interaction, time.Now().UTC(), alice, bob)

	report, err := f.service.InteractionsReport(f.vaultID, "en", f.userID, 12)
	if err != nil {
		t.Fatalf("InteractionsReport failed: %v", err)
	}
	// One dinner with two people is one interaction, not two.
	if report.TotalInteractions != 1 {
		t.Fatalf("expected 1 interaction, got %d", report.TotalInteractions)
	}
	if report.ContactCount != 2 {
		t.Fatalf("expected both participants credited, got %d", report.ContactCount)
	}
}

func TestInteractionsReportTreatsOneDayAsOneOccasion(t *testing.T) {
	f := setupInsightsTest(t, "insights-interactions-sameday@example.com")
	alice := f.contact(t, "Alice")
	interaction := f.interactionType(t, "Phone call", true)

	day := time.Now().UTC().AddDate(0, 0, -1)
	f.logActivity(t, interaction, day, alice)
	f.logActivity(t, interaction, day, alice)

	report, err := f.service.InteractionsReport(f.vaultID, "en", f.userID, 12)
	if err != nil {
		t.Fatalf("InteractionsReport failed: %v", err)
	}
	if len(report.MostFrequent) != 1 {
		t.Fatalf("expected 1 contact, got %d", len(report.MostFrequent))
	}
	// Two calls on one day are one occasion; counting both would report a gap of
	// zero days and make the median meaningless.
	if report.MostFrequent[0].Count != 1 {
		t.Fatalf("expected same-day activities to collapse, got count=%d", report.MostFrequent[0].Count)
	}
	if report.MostFrequent[0].MedianGapDays != nil {
		t.Fatalf("expected no median gap from a single occasion, got %d", *report.MostFrequent[0].MedianGapDays)
	}
}

func TestMedianGapDaysUsesMedianNotMean(t *testing.T) {
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	days := []time.Time{base, base.AddDate(0, 0, 7), base.AddDate(0, 0, 14), base.AddDate(0, 0, 1000)}
	median := medianGapDays(days)
	if median == nil {
		t.Fatal("expected a median")
	}
	// Gaps are 7, 7, 986: the mean would be 333, which describes nobody.
	if *median != 7 {
		t.Fatalf("expected 7, got %d", *median)
	}
}

func TestInteractionsReportWindowScopesEveryHeadlineFigure(t *testing.T) {
	f := setupInsightsTest(t, "insights-window-contract@example.com")
	alice := f.contact(t, "Alice")
	interaction := f.interactionType(t, "Phone call", true)
	other := f.interactionType(t, "Watched a movie", false)

	now := time.Now().UTC()
	// Two inside a 12-month window, two well outside it.
	f.logActivity(t, interaction, now.AddDate(0, -1, 0), alice)
	f.logActivity(t, interaction, now.AddDate(0, -2, 0), alice)
	f.logActivity(t, interaction, now.AddDate(-3, 0, 0), alice)
	f.logActivity(t, interaction, now.AddDate(-4, 0, 0), alice)
	f.logActivity(t, other, now.AddDate(0, -1, 0), alice)

	narrow, err := f.service.InteractionsReport(f.vaultID, "en", f.userID, 12)
	if err != nil {
		t.Fatalf("InteractionsReport failed: %v", err)
	}
	wide, err := f.service.InteractionsReport(f.vaultID, "en", f.userID, 120)
	if err != nil {
		t.Fatalf("InteractionsReport failed: %v", err)
	}

	// Every headline figure must move with the window, together.
	if narrow.TotalInteractions != 2 {
		t.Fatalf("12-month window: expected 2 interactions, got %d", narrow.TotalInteractions)
	}
	if wide.TotalInteractions != 4 {
		t.Fatalf("120-month window: expected 4 interactions, got %d", wide.TotalInteractions)
	}
	if narrow.TotalActivities != 3 {
		t.Fatalf("12-month window: expected 3 activities, got %d", narrow.TotalActivities)
	}
	if wide.TotalActivities != 5 {
		t.Fatalf("120-month window: expected 5 activities, got %d", wide.TotalActivities)
	}

	channelCount := func(r *dto.InteractionsReportResponse) int {
		total := 0
		for _, channel := range r.Channels {
			total += channel.Count
		}
		return total
	}
	// The bug this guards: channel counts stayed at all-history while the bars
	// followed the window, so the legend disagreed with the chart beside it.
	if channelCount(narrow) != narrow.TotalInteractions {
		t.Fatalf("channel counts must sum to the window total, got %d vs %d",
			channelCount(narrow), narrow.TotalInteractions)
	}
	if channelCount(wide) != wide.TotalInteractions {
		t.Fatalf("channel counts must sum to the window total, got %d vs %d",
			channelCount(wide), wide.TotalInteractions)
	}

	monthSum := 0
	for _, bucket := range narrow.Months {
		monthSum += bucket.Count
	}
	if monthSum != narrow.TotalInteractions {
		t.Fatalf("month buckets must sum to the window total, got %d vs %d", monthSum, narrow.TotalInteractions)
	}

	// Per-contact cadence is the documented exception: all history, either way.
	for _, r := range []*dto.InteractionsReportResponse{narrow, wide} {
		if len(r.MostFrequent) != 1 || r.MostFrequent[0].Count != 4 {
			t.Fatalf("per-contact figures must cover all history, got %+v", r.MostFrequent)
		}
	}
}

func TestInteractionsReportExcludesFutureDatedActivities(t *testing.T) {
	f := setupInsightsTest(t, "insights-future@example.com")
	alice := f.contact(t, "Alice")
	interaction := f.interactionType(t, "Phone call", true)
	other := f.interactionType(t, "Watched a movie", false)

	now := time.Now().UTC()
	// Two real conversations, plus a planned one and an unflagged future event.
	f.logActivity(t, interaction, now.AddDate(0, 0, -10), alice)
	f.logActivity(t, interaction, now.AddDate(0, 0, -3), alice)
	f.logActivity(t, interaction, now.AddDate(0, 2, 0), alice) // future, flagged
	f.logActivity(t, other, now.AddDate(0, 3, 0), alice)       // future, unflagged

	report, err := f.service.InteractionsReport(f.vaultID, "en", f.userID, 12)
	if err != nil {
		t.Fatalf("InteractionsReport failed: %v", err)
	}

	// An activity dated next month is a plan, not history. Counting it broke the
	// report's own arithmetic: the month series stops at the current month, so
	// the total said one thing and the bars added up to another.
	if report.TotalInteractions != 2 {
		t.Fatalf("expected 2 past interactions, got %d", report.TotalInteractions)
	}
	if report.TotalActivities != 2 {
		t.Fatalf("expected 2 past activities, got %d", report.TotalActivities)
	}

	monthSum := 0
	for _, bucket := range report.Months {
		monthSum += bucket.Count
	}
	if monthSum != report.TotalInteractions {
		t.Fatalf("month buckets must sum to the total, got %d vs %d", monthSum, report.TotalInteractions)
	}
	channelSum := 0
	for _, channel := range report.Channels {
		channelSum += channel.Count
	}
	if channelSum != report.TotalInteractions {
		t.Fatalf("channel counts must sum to the total, got %d vs %d", channelSum, report.TotalInteractions)
	}

	// The all-history per-contact figures must not see it either, or someone
	// with a booked appointment would appear to have been in touch already.
	if len(report.MostFrequent) != 1 {
		t.Fatalf("expected 1 contact, got %d", len(report.MostFrequent))
	}
	item := report.MostFrequent[0]
	if item.Count != 2 {
		t.Fatalf("per-contact count must exclude future dates, got %d", item.Count)
	}
	if item.LastAt == nil || item.LastAt.After(now) {
		t.Fatalf("last contact must not be in the future, got %v", item.LastAt)
	}
	if item.DaysSinceLast == nil || *item.DaysSinceLast < 0 {
		t.Fatalf("days since last must not be negative, got %v", item.DaysSinceLast)
	}
}

func TestInteractionsReportKeepsTodaysActivities(t *testing.T) {
	f := setupInsightsTest(t, "insights-today@example.com")
	alice := f.contact(t, "Alice")
	interaction := f.interactionType(t, "Phone call", true)

	// The boundary is the end of today, not the current instant: a conversation
	// logged this morning is history and must still count.
	f.logActivity(t, interaction, time.Now().UTC(), alice)

	report, err := f.service.InteractionsReport(f.vaultID, "en", f.userID, 12)
	if err != nil {
		t.Fatalf("InteractionsReport failed: %v", err)
	}
	if report.TotalInteractions != 1 {
		t.Fatalf("today's interaction must be counted, got %d", report.TotalInteractions)
	}
}

// The reader's calendar, not the server's, decides what "today" is. Activity
// dates are stored as the picked calendar date at UTC midnight, so someone in
// UTC+14 logs this morning's call under a date UTC has not reached yet for
// most of their day — and the report must still count it.
func TestInteractionsReportUsesTheReadersCalendar(t *testing.T) {
	f := setupInsightsTest(t, "insights-calendar@example.com")
	if err := f.db.Model(&models.User{}).Where("id = ?", f.userID).
		Update("timezone", "Pacific/Kiritimati").Error; err != nil {
		t.Fatalf("setting timezone: %v", err)
	}
	location, err := time.LoadLocation("Pacific/Kiritimati")
	if err != nil {
		t.Fatalf("loading location: %v", err)
	}
	userNow := time.Now().In(location)
	userToday := time.Date(userNow.Year(), userNow.Month(), userNow.Day(), 0, 0, 0, 0, time.UTC)

	alice := f.contact(t, "Alice")
	phoneCall := f.interactionType(t, "Phone call", true)
	f.logActivity(t, phoneCall, userToday, alice)

	report, err := f.service.InteractionsReport(f.vaultID, "en", f.userID, 12)
	if err != nil {
		t.Fatalf("InteractionsReport failed: %v", err)
	}
	if report.TotalInteractions != 1 {
		t.Fatalf("an activity dated the reader's own today must be counted, got %d", report.TotalInteractions)
	}
	// The invariant the window contract promises: whatever is in the total has
	// a bucket to live in.
	bucketSum := 0
	for _, bucket := range report.Months {
		bucketSum += bucket.Count
	}
	if bucketSum != report.TotalInteractions {
		t.Fatalf("month buckets sum to %d but total is %d", bucketSum, report.TotalInteractions)
	}
	if len(report.MostFrequent) != 1 || report.MostFrequent[0].DaysSinceLast == nil || *report.MostFrequent[0].DaysSinceLast != 0 {
		t.Fatalf("the reader's today must read as zero days ago: %+v", report.MostFrequent)
	}
}

// ContactCount documents itself as "how many people appear in the per-contact
// lists" — so a contact archived or deleted since their last conversation must
// not be counted, exactly as they are excluded from the lists themselves.
func TestInteractionsReportContactCountExcludesUnlistedContacts(t *testing.T) {
	f := setupInsightsTest(t, "insights-contactcount@example.com")
	alice := f.contact(t, "Alice")
	archived := f.contact(t, "Archived")
	phoneCall := f.interactionType(t, "Phone call", true)
	day := time.Date(2026, 5, 10, 0, 0, 0, 0, time.UTC)
	f.logActivity(t, phoneCall, day, alice)
	f.logActivity(t, phoneCall, day.AddDate(0, 0, 3), archived)
	if err := f.db.Model(&models.Contact{}).Where("id = ?", archived).Update("listed", false).Error; err != nil {
		t.Fatalf("archiving: %v", err)
	}

	report, err := f.service.InteractionsReport(f.vaultID, "en", f.userID, 12)
	if err != nil {
		t.Fatalf("InteractionsReport failed: %v", err)
	}
	if report.ContactCount != 1 {
		t.Fatalf("expected the archived contact excluded from ContactCount, got %d", report.ContactCount)
	}
	if len(report.MostFrequent) != 1 {
		t.Fatalf("expected 1 listed contact in the lists, got %d", len(report.MostFrequent))
	}
}

// A report can be empty for two very different reasons, and the page gives
// different advice for each: no type is flagged (fix the settings), or types
// are flagged but the flagged events are older than the window. The flag must
// tell them apart — the old heuristic (any unflagged activity in the window)
// gave settings advice to vaults whose settings were fine.
func TestInteractionsReportSaysWhetherAnyTypeCounts(t *testing.T) {
	f := setupInsightsTest(t, "insights-configured@example.com")
	// A new vault seeds flagged types; unflag them all so this starts from the
	// state the flag exists to describe.
	if err := f.db.Model(&models.ActivityType{}).
		Where("activity_category_id IN (?)", f.db.Model(&models.ActivityCategory{}).Select("id").Where("vault_id = ?", f.vaultID)).
		Update("counts_as_interaction", false).Error; err != nil {
		t.Fatalf("unflagging seeded types: %v", err)
	}
	alice := f.contact(t, "Alice")
	unflagged := f.interactionType(t, "Errand", false)
	inWindow := time.Now().UTC().AddDate(0, -1, 0)
	f.logActivity(t, unflagged, inWindow, alice)

	report, err := f.service.InteractionsReport(f.vaultID, "en", f.userID, 12)
	if err != nil {
		t.Fatalf("InteractionsReport failed: %v", err)
	}
	if report.InteractionTypesConfigured {
		t.Fatal("no flagged type exists, so InteractionTypesConfigured must be false")
	}

	// Now a flagged type exists, but its only event is older than the window:
	// the settings are fine, and the response must say so.
	phoneCall := f.interactionType(t, "Phone call", true)
	f.logActivity(t, phoneCall, time.Now().UTC().AddDate(-2, 0, 0), alice)

	report, err = f.service.InteractionsReport(f.vaultID, "en", f.userID, 12)
	if err != nil {
		t.Fatalf("InteractionsReport failed: %v", err)
	}
	if !report.InteractionTypesConfigured {
		t.Fatal("a flagged type exists; InteractionTypesConfigured must be true")
	}
	if report.TotalInteractions != 0 {
		t.Fatalf("the flagged event is outside the window, got %d interactions", report.TotalInteractions)
	}
	if report.TotalActivities != 1 {
		t.Fatalf("the unflagged activity is inside the window, got %d activities", report.TotalActivities)
	}
}

// Birthdays are routinely recorded with only a year, or a year and month —
// precisions the date model supports explicitly. A ~decade band does not need
// the day, so those contacts must land in a band, not in Unset.
func TestDemographicsReportAgeBandsAcceptPartialBirthdates(t *testing.T) {
	f := setupInsightsTest(t, "insights-partial-age@example.com")
	birthdateTypeID := f.lookupID(t, "contact_important_date_types", "internal_type", "birthdate")

	yearOnly := f.contact(t, "YearOnly")
	yearMonth := f.contact(t, "YearMonth")

	now := time.Now().UTC()
	thirty := now.Year() - 30
	fifty := now.Year() - 50
	january := 1
	for _, row := range []models.ContactImportantDate{
		{ContactID: yearOnly, ContactImportantDateTypeID: &birthdateTypeID, Label: "Birthdate", Year: &thirty},
		{ContactID: yearMonth, ContactImportantDateTypeID: &birthdateTypeID, Label: "Birthdate", Year: &fifty, Month: &january},
	} {
		if err := f.db.Create(&row).Error; err != nil {
			t.Fatalf("creating birthdate: %v", err)
		}
	}

	report, err := f.service.DemographicsReport(f.vaultID, "en")
	if err != nil {
		t.Fatalf("DemographicsReport failed: %v", err)
	}
	age := f.dimension(t, report, demographicAge)
	if age.Known != 2 {
		t.Fatalf("year-only and year-month birthdays both yield an age, got known=%d unset=%d", age.Known, age.Unset)
	}
}
