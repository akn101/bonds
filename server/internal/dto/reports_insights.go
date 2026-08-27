package dto

import "time"

// --- Demographics -----------------------------------------------------------

// DemographicBucket is one value of one dimension, with how many contacts carry
// it. Value is the stable row id (or a synthetic key for derived dimensions like
// age) so a rename never changes what a bucket means; Label is what to display.
type DemographicBucket struct {
	Value string `json:"value" example:"2"`
	Label string `json:"label" example:"Female"`
	Count int    `json:"count" example:"48"`
}

// DemographicDimension is one groupable attribute. Unset is reported alongside
// the buckets rather than folded into them: for most vaults the interesting
// number is how much of the address book is unfilled, and a chart that silently
// drops the blanks makes 3% coverage look like 100%.
type DemographicDimension struct {
	Key     string              `json:"key" example:"gender"`
	Known   int                 `json:"known" example:"120"`
	Unset   int                 `json:"unset" example:"22"`
	Buckets []DemographicBucket `json:"buckets"`
}

type DemographicsReportResponse struct {
	TotalContacts int                    `json:"total_contacts" example:"142"`
	Dimensions    []DemographicDimension `json:"dimensions"`
}

// --- Map --------------------------------------------------------------------

type MapContactItem struct {
	ContactID   string `json:"contact_id" example:"550e8400-e29b-41d4-a716-446655440000"`
	ContactName string `json:"contact_name" example:"John Doe"`
}

// MapPoint is one geocoded address and everyone who lives at it.
type MapPoint struct {
	AddressID uint             `json:"address_id" example:"12"`
	Latitude  float64          `json:"latitude" example:"51.5072"`
	Longitude float64          `json:"longitude" example:"-0.1276"`
	City      string           `json:"city" example:"London"`
	Province  string           `json:"province" example:"Greater London"`
	Country   string           `json:"country" example:"United Kingdom"`
	Contacts  []MapContactItem `json:"contacts"`
}

// MapCountryItem lets the map draw a choropleth even when nothing is geocoded,
// which is the normal state of a vault imported from a phone address book.
type MapCountryItem struct {
	Country      string `json:"country" example:"United Kingdom"`
	AddressCount int    `json:"address_count" example:"227"`
	ContactCount int    `json:"contact_count" example:"180"`
	Geocoded     int    `json:"geocoded" example:"40"`
}

type MapReportResponse struct {
	TotalAddresses int              `json:"total_addresses" example:"379"`
	GeocodedCount  int              `json:"geocoded_count" example:"40"`
	Points         []MapPoint       `json:"points"`
	Countries      []MapCountryItem `json:"countries"`
}

// --- Interactions -----------------------------------------------------------

// InteractionBucket is one calendar month, as YYYY-MM. Bucketing happens in Go
// rather than SQL because SQLite and PostgreSQL disagree on date functions and
// the server supports both.
type InteractionBucket struct {
	Period string `json:"period" example:"2026-08"`
	Count  int    `json:"count" example:"37"`
}

// InteractionChannel is one activity type that counts as an interaction —
// "WhatsApp", "Phone call", "In-person meeting" — over the reported window.
type InteractionChannel struct {
	ActivityTypeID uint                `json:"activity_type_id" example:"195"`
	Label          string              `json:"label" example:"Phone call"`
	Icon           string              `json:"icon" example:"phone"`
	Color          string              `json:"color" example:"#1677ff"`
	Count          int                 `json:"count" example:"212"`
	Months         []InteractionBucket `json:"months"`
}

// InteractionContactItem is one person's cadence.
//
// MedianGapDays is the median number of days between consecutive interactions,
// which is a far better description of a relationship's rhythm than a mean —
// one three-year gap should not turn a weekly friend into a yearly one.
type InteractionContactItem struct {
	ContactID     string     `json:"contact_id" example:"550e8400-e29b-41d4-a716-446655440000"`
	ContactName   string     `json:"contact_name" example:"John Doe"`
	Count         int        `json:"count" example:"64"`
	FirstAt       *time.Time `json:"first_at" example:"2021-03-04T00:00:00Z"`
	LastAt        *time.Time `json:"last_at" example:"2026-08-19T00:00:00Z"`
	DaysSinceLast *int       `json:"days_since_last" example:"6"`
	MedianGapDays *int       `json:"median_gap_days" example:"9"`
}

type InteractionsReportResponse struct {
	// TotalActivities counts every activity in the window regardless of type, so
	// a vault whose types are all unflagged can be told why its report is empty
	// instead of being shown a blank chart.
	TotalActivities   int                      `json:"total_activities" example:"7643"`
	TotalInteractions int                      `json:"total_interactions" example:"1204"`
	ContactCount      int                      `json:"contact_count" example:"88"`
	Months            []InteractionBucket      `json:"months"`
	Channels          []InteractionChannel     `json:"channels"`
	MostFrequent      []InteractionContactItem `json:"most_frequent"`
	GoneQuiet         []InteractionContactItem `json:"gone_quiet"`
}
