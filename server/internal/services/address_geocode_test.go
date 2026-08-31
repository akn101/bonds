package services

import (
	"errors"
	"strings"
	"testing"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
)

// stubGeocoder records what it was asked and answers with fixed coordinates.
type stubGeocoder struct {
	queries      []string
	latitude     float64
	longitude    float64
	fail         bool
	noMatch      bool
	autocomplete bool
}

func (g *stubGeocoder) Geocode(address string) (*GeocodingResult, error) {
	g.queries = append(g.queries, address)
	if g.fail {
		return nil, errors.New("provider unavailable")
	}
	if g.noMatch {
		return nil, nil
	}
	return &GeocodingResult{Latitude: g.latitude, Longitude: g.longitude}, nil
}

func (g *stubGeocoder) SupportsAutocomplete() bool { return g.autocomplete }

func (g *stubGeocoder) Attribution() []ProviderAttribution {
	return []ProviderAttribution{{Label: "Test data", URL: "https://example.com/licence"}}
}

func (g *stubGeocoder) Suggest(query string, limit int) ([]GeocodingSuggestion, error) {
	return nil, nil
}

func storedCoordinates(t *testing.T, svc *AddressService, id uint) (*float64, *float64) {
	t.Helper()
	var address models.Address
	if err := svc.db.First(&address, id).Error; err != nil {
		t.Fatalf("reloading address: %v", err)
	}
	return address.Latitude, address.Longitude
}

func TestUpdateAddressKeepsCoordinatesWhenNotMoved(t *testing.T) {
	svc, contactID, vaultID := setupAddressTest(t)
	geocoder := &stubGeocoder{latitude: 51.5072, longitude: -0.1276}
	svc.SetGeocoder(geocoder)

	created, err := svc.Create(contactID, vaultID, dto.CreateAddressRequest{
		Line1: "10 Downing Street", City: "London", Country: "United Kingdom",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if len(geocoder.queries) != 1 {
		t.Fatalf("expected the new address to be geocoded once, got %d calls", len(geocoder.queries))
	}

	// The address form does not send coordinates. Before this was fixed, that
	// alone wiped them on every save and nothing ever recomputed them.
	if _, err := svc.Update(created.ID, contactID, vaultID, dto.UpdateAddressRequest{
		Line1: "10 Downing Street", City: "London", Country: "United Kingdom",
	}); err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	latitude, longitude := storedCoordinates(t, svc, created.ID)
	if latitude == nil || longitude == nil {
		t.Fatal("editing an address must not erase its coordinates")
	}
	if *latitude != 51.5072 || *longitude != -0.1276 {
		t.Fatalf("unexpected coordinates: %v, %v", *latitude, *longitude)
	}
	// Unchanged text must not spend another provider request.
	if len(geocoder.queries) != 1 {
		t.Fatalf("expected no re-geocode for an unchanged address, got %d calls", len(geocoder.queries))
	}
}

func TestUpdateAddressRegeocodesWhenMoved(t *testing.T) {
	svc, contactID, vaultID := setupAddressTest(t)
	geocoder := &stubGeocoder{latitude: 51.5072, longitude: -0.1276}
	svc.SetGeocoder(geocoder)

	created, err := svc.Create(contactID, vaultID, dto.CreateAddressRequest{
		Line1: "10 Downing Street", City: "London", Country: "United Kingdom",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	geocoder.latitude, geocoder.longitude = 48.2082, 16.3738
	if _, err := svc.Update(created.ID, contactID, vaultID, dto.UpdateAddressRequest{
		Line1: "Stephansplatz 1", City: "Vienna", Country: "Austria",
	}); err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	latitude, longitude := storedCoordinates(t, svc, created.ID)
	if latitude == nil || *latitude != 48.2082 || longitude == nil || *longitude != 16.3738 {
		t.Fatalf("expected the moved address to be re-geocoded, got %v, %v", latitude, longitude)
	}
	if len(geocoder.queries) != 2 {
		t.Fatalf("expected exactly one re-geocode, got %d calls", len(geocoder.queries))
	}
	if geocoder.queries[1] != "Stephansplatz 1, Vienna, Austria" {
		t.Fatalf("unexpected geocoding query: %q", geocoder.queries[1])
	}
}

func TestUpdateAddressPrefersCallerSuppliedCoordinates(t *testing.T) {
	svc, contactID, vaultID := setupAddressTest(t)
	geocoder := &stubGeocoder{latitude: 51.5072, longitude: -0.1276}
	svc.SetGeocoder(geocoder)

	created, err := svc.Create(contactID, vaultID, dto.CreateAddressRequest{
		Line1: "10 Downing Street", City: "London", Country: "United Kingdom",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// A client that picked a suggestion already knows the coordinates, so the
	// provider should not be asked again.
	latitude, longitude := 48.2082, 16.3738
	if _, err := svc.Update(created.ID, contactID, vaultID, dto.UpdateAddressRequest{
		Line1: "Stephansplatz 1", City: "Vienna", Country: "Austria",
		Latitude: &latitude, Longitude: &longitude,
	}); err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	storedLat, storedLon := storedCoordinates(t, svc, created.ID)
	if storedLat == nil || *storedLat != 48.2082 || storedLon == nil || *storedLon != 16.3738 {
		t.Fatalf("expected the supplied coordinates to be kept, got %v, %v", storedLat, storedLon)
	}
	if len(geocoder.queries) != 1 {
		t.Fatalf("expected no extra geocode, got %d calls", len(geocoder.queries))
	}
}

func TestSuggestReportsLookupDisabledWithoutGeocoder(t *testing.T) {
	svc, _, _ := setupAddressTest(t)

	suggestions, enabled, err := svc.Suggest("downing", 5)
	if err != nil {
		t.Fatalf("Suggest failed: %v", err)
	}
	if enabled {
		t.Fatal("lookup must report itself disabled when no provider is configured")
	}
	if suggestions == nil {
		t.Fatal("expected an empty slice rather than nil")
	}
}

func TestOutwardCodeKeepsOnlyTheDistrict(t *testing.T) {
	cases := map[string]string{
		"SW1A 2AA":   "SW1A",  // UK: the outward half covers a neighbourhood
		"sw1a 2aa":   "sw1a",  // case is the caller's business, not ours
		"EC1A 1BB ":  "EC1A",  // trailing space
		"94103-1234": "94103", // ZIP+4 reduces to the ZIP
		"94103":      "94103", // already district-sized
		"75008":      "75008", // no separator, left alone
		"":           "",      // nothing to reduce
		"   ":        "",      // whitespace is nothing
	}
	for input, want := range cases {
		if got := outwardCode(input); got != want {
			t.Errorf("outwardCode(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestLocalityPrecisionNeverSendsTheStreet(t *testing.T) {
	address := &models.Address{
		Line1:      strPtr("221B Baker Street"),
		Line2:      strPtr("Flat 3"),
		City:       strPtr("London"),
		Province:   strPtr("Greater London"),
		PostalCode: strPtr("NW1 6XE"),
		Country:    strPtr("United Kingdom"),
	}

	exact := geocodeQuery(address, GeocodingPrecisionExact)
	if exact != "221B Baker Street, London, Greater London, NW1 6XE, United Kingdom" {
		t.Fatalf("unexpected exact query: %q", exact)
	}

	locality := geocodeQuery(address, GeocodingPrecisionLocality)
	if strings.Contains(locality, "Baker Street") || strings.Contains(locality, "221B") {
		t.Fatalf("the street must never leave the server at locality precision: %q", locality)
	}
	if strings.Contains(locality, "6XE") {
		t.Fatalf("the inward postcode identifies a building and must be dropped: %q", locality)
	}
	if locality != "NW1, London, Greater London, United Kingdom" {
		t.Fatalf("unexpected locality query: %q", locality)
	}
}

func TestLocalityPrecisionFallsBackToTheTown(t *testing.T) {
	address := &models.Address{
		Line1:   strPtr("12 Rue de Rivoli"),
		City:    strPtr("Paris"),
		Country: strPtr("France"),
	}
	// No postcode: the town has to carry the answer on its own.
	if got := geocodeQuery(address, GeocodingPrecisionLocality); got != "Paris, France" {
		t.Fatalf("unexpected locality query: %q", got)
	}
}

func TestLocalityPrecisionIsUsedWhenGeocoding(t *testing.T) {
	svc, contactID, vaultID := setupAddressTest(t)
	geocoder := &stubGeocoder{latitude: 51.5237, longitude: -0.1585}
	svc.SetGeocoder(geocoder)
	svc.SetGeocodingPrecision(GeocodingPrecisionLocality)

	if _, err := svc.Create(contactID, vaultID, dto.CreateAddressRequest{
		Line1: "221B Baker Street", City: "London", PostalCode: "NW1 6XE", Country: "United Kingdom",
	}); err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if len(geocoder.queries) != 1 {
		t.Fatalf("expected one geocode, got %d", len(geocoder.queries))
	}
	if strings.Contains(geocoder.queries[0], "Baker Street") {
		t.Fatalf("the street reached the provider: %q", geocoder.queries[0])
	}
	if geocoder.queries[0] != "NW1, London, United Kingdom" {
		t.Fatalf("unexpected query: %q", geocoder.queries[0])
	}
}

func TestLocalityPrecisionSkipsRegeocodeWhenOnlyTheStreetChanges(t *testing.T) {
	svc, contactID, vaultID := setupAddressTest(t)
	geocoder := &stubGeocoder{latitude: 51.5237, longitude: -0.1585}
	svc.SetGeocoder(geocoder)
	svc.SetGeocodingPrecision(GeocodingPrecisionLocality)

	created, err := svc.Create(contactID, vaultID, dto.CreateAddressRequest{
		Line1: "221B Baker Street", City: "London", PostalCode: "NW1 6XE", Country: "United Kingdom",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Moving down the same street does not change the district, so there is
	// nothing new to ask the provider.
	if _, err := svc.Update(created.ID, contactID, vaultID, dto.UpdateAddressRequest{
		Line1: "224 Baker Street", City: "London", PostalCode: "NW1 6XE", Country: "United Kingdom",
	}); err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if len(geocoder.queries) != 1 {
		t.Fatalf("expected no second geocode, got %d", len(geocoder.queries))
	}
}

func TestUpdateAddressDropsCoordinatesWhenGeocodingFails(t *testing.T) {
	svc, contactID, vaultID := setupAddressTest(t)
	geocoder := &stubGeocoder{latitude: 51.5072, longitude: -0.1276}
	svc.SetGeocoder(geocoder)

	created, err := svc.Create(contactID, vaultID, dto.CreateAddressRequest{
		Line1: "10 Downing Street", City: "London", Country: "United Kingdom",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if lat, _ := storedCoordinates(t, svc, created.ID); lat == nil {
		t.Fatal("expected the new address to be geocoded")
	}

	// The address moves, and the provider cannot answer. Keeping the old
	// coordinates would leave this address pinned to London on the map.
	geocoder.fail = true
	if _, err := svc.Update(created.ID, contactID, vaultID, dto.UpdateAddressRequest{
		Line1: "Stephansplatz 1", City: "Vienna", Country: "Austria",
	}); err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	latitude, longitude := storedCoordinates(t, svc, created.ID)
	if latitude != nil || longitude != nil {
		t.Fatalf("a moved address must not keep its old coordinates when geocoding fails, got %v, %v", latitude, longitude)
	}
}

func TestUpdateAddressDropsCoordinatesWhenProviderFindsNothing(t *testing.T) {
	svc, contactID, vaultID := setupAddressTest(t)
	geocoder := &stubGeocoder{latitude: 51.5072, longitude: -0.1276}
	svc.SetGeocoder(geocoder)

	created, err := svc.Create(contactID, vaultID, dto.CreateAddressRequest{
		Line1: "10 Downing Street", City: "London", Country: "United Kingdom",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	geocoder.noMatch = true
	if _, err := svc.Update(created.ID, contactID, vaultID, dto.UpdateAddressRequest{
		Line1: "Nowhere At All", City: "Nowhereville", Country: "Atlantis",
	}); err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if latitude, _ := storedCoordinates(t, svc, created.ID); latitude != nil {
		t.Fatalf("expected no coordinates for an unresolvable address, got %v", *latitude)
	}
}

func TestSuggestRefusedWhenProviderForbidsAutocomplete(t *testing.T) {
	svc, _, _ := setupAddressTest(t)
	// The public Nominatim instance forbids autocomplete outright.
	svc.SetGeocoder(&stubGeocoder{autocomplete: false})

	suggestions, enabled, err := svc.Suggest("10 downing", 5)
	if err != nil {
		t.Fatalf("Suggest failed: %v", err)
	}
	if enabled {
		t.Fatal("autocomplete must report itself unavailable when the provider forbids it")
	}
	if len(suggestions) != 0 {
		t.Fatalf("expected no suggestions, got %d", len(suggestions))
	}
}

func TestSuggestRefusedAtLocalityPrecision(t *testing.T) {
	svc, _, _ := setupAddressTest(t)
	geocoder := &stubGeocoder{autocomplete: true}
	svc.SetGeocoder(geocoder)
	svc.SetGeocodingPrecision(GeocodingPrecisionLocality)

	// Locality mode promises no street address leaves the server. Autocomplete
	// would send the partial street line the reader is typing, so it is
	// withdrawn rather than quietly weakened.
	_, enabled, err := svc.Suggest("221b baker street", 5)
	if err != nil {
		t.Fatalf("Suggest failed: %v", err)
	}
	if enabled {
		t.Fatal("autocomplete must be unavailable at locality precision")
	}
	if len(geocoder.queries) != 0 {
		t.Fatalf("nothing may reach the provider at locality precision, got %v", geocoder.queries)
	}
}

func TestSuggestWorksWhenProviderPermitsAndPrecisionIsExact(t *testing.T) {
	svc, _, _ := setupAddressTest(t)
	svc.SetGeocoder(&stubGeocoder{autocomplete: true})
	svc.SetGeocodingPrecision(GeocodingPrecisionExact)

	_, enabled, err := svc.Suggest("10 downing", 5)
	if err != nil {
		t.Fatalf("Suggest failed: %v", err)
	}
	if !enabled {
		t.Fatal("expected autocomplete to be available")
	}
}

func TestAttributionFollowsAvailability(t *testing.T) {
	svc, _, _ := setupAddressTest(t)

	// No provider: nothing is shown, so nothing needs crediting.
	if credits := svc.Attribution(); len(credits) != 0 {
		t.Fatalf("expected no attribution without a geocoder, got %v", credits)
	}

	svc.SetGeocoder(&stubGeocoder{autocomplete: true})
	credits := svc.Attribution()
	if len(credits) != 1 || credits[0].Label != "Test data" || credits[0].URL != "https://example.com/licence" {
		t.Fatalf("expected the provider's credit passed through, got %v", credits)
	}

	// Locality precision withdraws lookup, and the credit goes with it.
	svc.SetGeocodingPrecision(GeocodingPrecisionLocality)
	if credits := svc.Attribution(); len(credits) != 0 {
		t.Fatalf("expected no attribution at locality precision, got %v", credits)
	}
}
