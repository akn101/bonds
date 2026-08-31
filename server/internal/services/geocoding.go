package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type GeocodingResult struct {
	Latitude  float64
	Longitude float64
}

// GeocodingSuggestion is one candidate address, already split into the fields
// the address form asks for so the client can fill the whole form from a pick
// rather than dumping a formatted string into line 1.
type GeocodingSuggestion struct {
	Label      string
	Line1      string
	City       string
	Province   string
	PostalCode string
	Country    string
	Latitude   float64
	Longitude  float64
}

// ErrGeocoderBusy is returned when the provider's rate limit could not be
// honoured within the caller's deadline. It is a signal to back off, not a
// failure of the query.
var ErrGeocoderBusy = errors.New("geocoder busy")

type Geocoder interface {
	Geocode(address string) (*GeocodingResult, error)
	// Suggest returns candidate addresses for a partial query, for autocomplete.
	Suggest(query string, limit int) ([]GeocodingSuggestion, error)
	// SupportsAutocomplete reports whether this provider's terms allow being
	// driven as a type-ahead. Rate limiting is not the deciding factor: a
	// provider can permit one request a second and still forbid autocomplete.
	SupportsAutocomplete() bool
}

// suggestionLimit caps how many candidates are ever requested from a provider,
// whatever the caller asks for.
const suggestionLimit = 8

// suggestWait is how long a suggest call will wait for a rate-limit slot before
// giving up. Autocomplete is only useful while the reader is still typing, so
// waiting longer than this would return answers to a question they have already
// moved on from.
const suggestWait = 2 * time.Second

// rateLimiter enforces a minimum interval between outbound requests to one
// provider.
//
// Nominatim's usage policy allows at most one request per second and blocks
// deployments that ignore it; nothing else in the server rate-limits anything,
// so an autocomplete box firing per keystroke would get the whole instance
// banned. Slots are booked rather than merely checked, so concurrent callers
// queue in order instead of all seeing the same free slot.
type rateLimiter struct {
	mu       sync.Mutex
	interval time.Duration
	next     time.Time
}

// reserve books the next free slot and reports how long the caller must wait
// for it. It refuses, without booking, if the wait would exceed max.
func (l *rateLimiter) reserve(max time.Duration) (time.Duration, bool) {
	if l == nil || l.interval <= 0 {
		return 0, true
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	slot := l.next
	if slot.Before(now) {
		slot = now
	}
	wait := slot.Sub(now)
	if wait > max {
		return 0, false
	}
	l.next = slot.Add(l.interval)
	return wait, true
}

// wait blocks until this caller's slot comes up.
func (l *rateLimiter) wait(max time.Duration) error {
	delay, ok := l.reserve(max)
	if !ok {
		return ErrGeocoderBusy
	}
	if delay > 0 {
		time.Sleep(delay)
	}
	return nil
}

type NominatimGeocoder struct {
	client  *http.Client
	limiter *rateLimiter
}

func NewNominatimGeocoder() *NominatimGeocoder {
	return &NominatimGeocoder{
		client: &http.Client{Timeout: 10 * time.Second},
		// The public Nominatim instance permits one request per second.
		limiter: &rateLimiter{interval: time.Second},
	}
}

func (g *NominatimGeocoder) Geocode(address string) (*GeocodingResult, error) {
	return geocodeFromURL(g.client, "https://nominatim.openstreetmap.org/search", address, "", g.limiter)
}

func (g *NominatimGeocoder) Suggest(query string, limit int) ([]GeocodingSuggestion, error) {
	return suggestFromURL(g.client, "https://nominatim.openstreetmap.org/search", query, "", limit, g.limiter)
}

// SupportsAutocomplete is false for the public OSM instance. Its usage policy
// forbids autocomplete outright — "do not use for autocomplete search" — and
// that is a licensing restriction, not a throughput one, so honouring the
// one-request-per-second limit does not make it permitted.
// https://operations.osmfoundation.org/policies/nominatim/
func (g *NominatimGeocoder) SupportsAutocomplete() bool { return false }

type LocationIQGeocoder struct {
	client  *http.Client
	apiKey  string
	limiter *rateLimiter
}

func NewLocationIQGeocoder(apiKey string) *LocationIQGeocoder {
	return &LocationIQGeocoder{
		client: &http.Client{Timeout: 10 * time.Second},
		apiKey: apiKey,
		// LocationIQ's free tier is two requests per second.
		limiter: &rateLimiter{interval: 500 * time.Millisecond},
	}
}

func (g *LocationIQGeocoder) Geocode(address string) (*GeocodingResult, error) {
	return geocodeFromURL(g.client, "https://us1.locationiq.com/v1/search", address, g.apiKey, g.limiter)
}

func (g *LocationIQGeocoder) Suggest(query string, limit int) ([]GeocodingSuggestion, error) {
	return suggestFromURL(g.client, "https://us1.locationiq.com/v1/search", query, g.apiKey, limit, g.limiter)
}

// SupportsAutocomplete is true: LocationIQ is a keyed commercial service whose
// plans include type-ahead, so the instance operator's own quota governs it.
func (g *LocationIQGeocoder) SupportsAutocomplete() bool { return true }

func NewGeocoder(provider, apiKey string) Geocoder {
	switch provider {
	case "locationiq":
		return NewLocationIQGeocoder(apiKey)
	default:
		return NewNominatimGeocoder()
	}
}

// nominatimAddress is the structured breakdown returned with addressdetails=1.
// LocationIQ is a Nominatim fork and answers in the same shape.
type nominatimAddress struct {
	HouseNumber   string `json:"house_number"`
	Road          string `json:"road"`
	Neighbourhood string `json:"neighbourhood"`
	Suburb        string `json:"suburb"`
	Village       string `json:"village"`
	Hamlet        string `json:"hamlet"`
	Town          string `json:"town"`
	City          string `json:"city"`
	Municipality  string `json:"municipality"`
	County        string `json:"county"`
	State         string `json:"state"`
	Postcode      string `json:"postcode"`
	Country       string `json:"country"`
}

// city picks the most specific populated-place name the provider returned;
// which key carries it varies by country.
func (a nominatimAddress) city() string {
	return firstNonEmpty(a.City, a.Town, a.Village, a.Hamlet, a.Suburb, a.Municipality)
}

// province is the administrative level above the city, again under whichever
// key the provider used.
func (a nominatimAddress) province() string {
	return firstNonEmpty(a.State, a.County)
}

// line1 reassembles the street line the address form expects.
func (a nominatimAddress) line1() string {
	road := firstNonEmpty(a.Road, a.Neighbourhood)
	if road == "" {
		return ""
	}
	if a.HouseNumber == "" {
		return road
	}
	return a.HouseNumber + " " + road
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

type nominatimResponse struct {
	Lat         string           `json:"lat"`
	Lon         string           `json:"lon"`
	DisplayName string           `json:"display_name"`
	Address     nominatimAddress `json:"address"`
}

// geocodeParams is the query every provider call shares.
func geocodeParams(query, apiKey string, limit int, details bool) url.Values {
	params := url.Values{}
	params.Set("q", query)
	params.Set("format", "json")
	params.Set("limit", strconv.Itoa(limit))
	if details {
		params.Set("addressdetails", "1")
	}
	if apiKey != "" {
		params.Set("key", apiKey)
	}
	return params
}

func fetchGeocoding(client *http.Client, baseURL string, params url.Values, limiter *rateLimiter, maxWait time.Duration) ([]nominatimResponse, error) {
	if err := limiter.wait(maxWait); err != nil {
		return nil, err
	}

	req, err := http.NewRequest(http.MethodGet, baseURL+"?"+params.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create geocoding request: %w", err)
	}
	req.Header.Set("User-Agent", "Bonds/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("geocoding request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("geocoding returned status %d", resp.StatusCode)
	}

	var results []nominatimResponse
	if err := json.NewDecoder(resp.Body).Decode(&results); err != nil {
		return nil, fmt.Errorf("failed to parse geocoding response: %w", err)
	}
	return results, nil
}

func geocodeFromURL(client *http.Client, baseURL, address, apiKey string, limiter *rateLimiter) (*GeocodingResult, error) {
	// A geocode happens while someone waits on a save, so it takes whatever slot
	// it needs rather than giving up on a busy limiter.
	results, err := fetchGeocoding(client, baseURL, geocodeParams(address, apiKey, 1, false), limiter, time.Minute)
	if err != nil {
		return nil, err
	}
	if len(results) == 0 {
		return nil, nil
	}

	lat, err := strconv.ParseFloat(results[0].Lat, 64)
	if err != nil {
		return nil, fmt.Errorf("failed to parse latitude: %w", err)
	}
	lon, err := strconv.ParseFloat(results[0].Lon, 64)
	if err != nil {
		return nil, fmt.Errorf("failed to parse longitude: %w", err)
	}

	return &GeocodingResult{Latitude: lat, Longitude: lon}, nil
}

func suggestFromURL(client *http.Client, baseURL, query, apiKey string, limit int, limiter *rateLimiter) ([]GeocodingSuggestion, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []GeocodingSuggestion{}, nil
	}
	if limit <= 0 || limit > suggestionLimit {
		limit = suggestionLimit
	}

	results, err := fetchGeocoding(client, baseURL, geocodeParams(query, apiKey, limit, true), limiter, suggestWait)
	if err != nil {
		return nil, err
	}

	suggestions := make([]GeocodingSuggestion, 0, len(results))
	for _, result := range results {
		lat, latErr := strconv.ParseFloat(result.Lat, 64)
		lon, lonErr := strconv.ParseFloat(result.Lon, 64)
		if latErr != nil || lonErr != nil {
			// One unparseable candidate should not lose the others.
			continue
		}
		suggestions = append(suggestions, GeocodingSuggestion{
			Label:      result.DisplayName,
			Line1:      result.Address.line1(),
			City:       result.Address.city(),
			Province:   result.Address.province(),
			PostalCode: result.Address.Postcode,
			Country:    result.Address.Country,
			Latitude:   lat,
			Longitude:  lon,
		})
	}
	return suggestions, nil
}
