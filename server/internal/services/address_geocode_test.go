package services

import (
	"bytes"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

// stubGeocoder answers with fixed coordinates, and can be made to fail or to
// find nothing, which is where the interesting behaviour is.
type stubGeocoder struct {
	queries   []string
	latitude  float64
	longitude float64
	fail      bool
	noMatch   bool
	// onGeocode runs while the provider is "on the wire", so tests can stage
	// what happens between an edit's commit and the geocode answer landing.
	onGeocode func()
}

func (g *stubGeocoder) Geocode(address string) (*GeocodingResult, error) {
	g.queries = append(g.queries, address)
	if g.onGeocode != nil {
		g.onGeocode()
	}
	if g.fail {
		return nil, errors.New("provider unavailable")
	}
	if g.noMatch {
		return nil, nil
	}
	return &GeocodingResult{Latitude: g.latitude, Longitude: g.longitude}, nil
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

	// The address moves and the provider cannot answer. Keeping the previous
	// coordinates would leave this address pinned to London on a map.
	geocoder.fail = true
	if _, err := svc.Update(created.ID, contactID, vaultID, dto.UpdateAddressRequest{
		Line1: "Stephansplatz 1", City: "Vienna", Country: "Austria",
	}); err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	latitude, longitude := storedCoordinates(t, svc, created.ID)
	if latitude != nil || longitude != nil {
		t.Fatalf("a moved address must not keep its old coordinates, got %v, %v", latitude, longitude)
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

// urlErrorGeocoder fails the way a real provider does over HTTP: with a
// transport error that carries the full request URL, query string and all.
type urlErrorGeocoder struct{}

func (g *urlErrorGeocoder) Geocode(address string) (*GeocodingResult, error) {
	return nil, &url.Error{
		Op:  "Get",
		URL: "https://us1.locationiq.com/v1/search?key=super-secret-api-key&q=" + url.QueryEscape(address),
		Err: errors.New("connection refused"),
	}
}

func TestGeocodeFailureLogLeavesTheAddressOut(t *testing.T) {
	svc, contactID, vaultID := setupAddressTest(t)
	svc.SetGeocoder(&urlErrorGeocoder{})

	var buf bytes.Buffer
	log.SetOutput(&buf)
	defer log.SetOutput(os.Stderr)

	created, err := svc.Create(contactID, vaultID, dto.CreateAddressRequest{
		Line1: "10 Downing Street", City: "London", Country: "United Kingdom",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	logged := buf.String()
	if logged == "" {
		t.Fatal("expected the geocoding failure to be logged")
	}
	// Neither the query nor the request URL may appear: in exact mode both are
	// a contact's complete home address.
	// The API key rides in the same URL, so it must go down with it.
	for _, fragment := range []string{"Downing", "London", "United Kingdom", "q=", "super-secret-api-key"} {
		if strings.Contains(logged, fragment) {
			t.Fatalf("log line leaks the address (%q): %s", fragment, logged)
		}
	}
	if !strings.Contains(logged, fmt.Sprintf("address %d", created.ID)) {
		t.Fatalf("log line should identify the address by ID: %s", logged)
	}
	if !strings.Contains(logged, "connection refused") {
		t.Fatalf("log line should keep the underlying cause: %s", logged)
	}
}

// PUT is full-replace, so a read-modify-write API client echoes the whole
// object back — coordinates included. Echoed coordinates on a moved address
// are a stale copy of what the server said, not an instruction to keep the
// old pin, and treating them as authoritative would pin the moved address to
// its old location permanently (every subsequent echo re-supplies them).
func TestUpdateAddressTreatsEchoedCoordinatesAsStale(t *testing.T) {
	svc, contactID, vaultID := setupAddressTest(t)
	geocoder := &stubGeocoder{latitude: 51.5072, longitude: -0.1276}
	svc.SetGeocoder(geocoder)

	created, err := svc.Create(contactID, vaultID, dto.CreateAddressRequest{
		Line1: "10 Downing Street", City: "London", Country: "United Kingdom",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// The provider now answers for the new city.
	geocoder.latitude, geocoder.longitude = 48.2082, 16.3738
	london := 51.5072
	londonLongitude := -0.1276
	if _, err := svc.Update(created.ID, contactID, vaultID, dto.UpdateAddressRequest{
		Line1: "10 Downing Street", City: "Vienna", Country: "Austria",
		Latitude: &london, Longitude: &londonLongitude,
	}); err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	latitude, longitude := storedCoordinates(t, svc, created.ID)
	if latitude == nil || *latitude != 48.2082 || longitude == nil || *longitude != 16.3738 {
		t.Fatalf("a moved address with echoed coordinates must be re-geocoded, got %v, %v", latitude, longitude)
	}

	// Coordinates that DIFFER from what the server handed out are a deliberate
	// override and still win.
	custom, customLongitude := 40.0, -70.0
	if _, err := svc.Update(created.ID, contactID, vaultID, dto.UpdateAddressRequest{
		Line1: "10 Downing Street", City: "Berlin", Country: "Germany",
		Latitude: &custom, Longitude: &customLongitude,
	}); err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	latitude, longitude = storedCoordinates(t, svc, created.ID)
	if latitude == nil || *latitude != 40.0 {
		t.Fatalf("caller-chosen coordinates must win, got %v", latitude)
	}
}

// Trailing whitespace or a change of case would be asked of the geocoder as
// the same question — it is not a move, and must not cost the pin (nor spend
// a provider request), even when the provider is down.
func TestUpdateAddressKeepsCoordinatesOnCosmeticEdit(t *testing.T) {
	svc, contactID, vaultID := setupAddressTest(t)
	geocoder := &stubGeocoder{latitude: 51.5072, longitude: -0.1276}
	svc.SetGeocoder(geocoder)

	created, err := svc.Create(contactID, vaultID, dto.CreateAddressRequest{
		Line1: "10 Downing Street", City: "London ", Country: "UNITED KINGDOM",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// The provider goes down; the cosmetic edit must not need it.
	geocoder.fail = true
	if _, err := svc.Update(created.ID, contactID, vaultID, dto.UpdateAddressRequest{
		Line1: "10 Downing Street", City: "London", Country: "United Kingdom",
	}); err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	latitude, longitude := storedCoordinates(t, svc, created.ID)
	if latitude == nil || longitude == nil {
		t.Fatal("a cosmetic edit erased the coordinates")
	}
	if len(geocoder.queries) != 1 {
		t.Fatalf("a cosmetic edit must not spend a provider request, got %d calls", len(geocoder.queries))
	}
}

// An address created while the provider was down has no pin, and "the stored
// coordinates are already right" is no reason to skip re-geocoding when
// nothing is stored: a plain save must be able to heal it.
func TestUpdateAddressRetriesGeocodeWhenPinMissing(t *testing.T) {
	svc, contactID, vaultID := setupAddressTest(t)
	geocoder := &stubGeocoder{latitude: 51.5072, longitude: -0.1276, fail: true}
	svc.SetGeocoder(geocoder)

	created, err := svc.Create(contactID, vaultID, dto.CreateAddressRequest{
		Line1: "10 Downing Street", City: "London", Country: "United Kingdom",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if latitude, _ := storedCoordinates(t, svc, created.ID); latitude != nil {
		t.Fatal("precondition: the failed create should have stored no coordinates")
	}

	geocoder.fail = false
	if _, err := svc.Update(created.ID, contactID, vaultID, dto.UpdateAddressRequest{
		Line1: "10 Downing Street", City: "London", Country: "United Kingdom",
	}); err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	latitude, longitude := storedCoordinates(t, svc, created.ID)
	if latitude == nil || *latitude != 51.5072 || longitude == nil {
		t.Fatalf("an unchanged save should have healed the missing pin, got %v, %v", latitude, longitude)
	}
}

// The geocode answer arrives after the edit's transaction committed, and the
// row may have been edited again while the provider was thinking. The late
// answer is for a question the row no longer asks, and must not be stored.
func TestLateGeocodeAnswerDoesNotClobberANewerEdit(t *testing.T) {
	svc, contactID, vaultID := setupAddressTest(t)
	geocoder := &stubGeocoder{latitude: 51.5072, longitude: -0.1276}
	svc.SetGeocoder(geocoder)

	created, err := svc.Create(contactID, vaultID, dto.CreateAddressRequest{
		Line1: "10 Downing Street", City: "London", Country: "United Kingdom",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// While Vienna's geocode is "on the wire", the address moves on to Berlin.
	geocoder.latitude, geocoder.longitude = 48.2082, 16.3738
	geocoder.onGeocode = func() {
		geocoder.onGeocode = nil
		if err := svc.db.Model(&models.Address{}).Where("id = ?", created.ID).
			Updates(map[string]any{"city": "Berlin", "country": "Germany", "latitude": 52.52, "longitude": 13.405}).Error; err != nil {
			t.Fatalf("staging the concurrent edit: %v", err)
		}
	}
	if _, err := svc.Update(created.ID, contactID, vaultID, dto.UpdateAddressRequest{
		Line1: "10 Downing Street", City: "Vienna", Country: "Austria",
	}); err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	latitude, longitude := storedCoordinates(t, svc, created.ID)
	if latitude == nil || *latitude != 52.52 || longitude == nil || *longitude != 13.405 {
		t.Fatalf("Vienna's late answer clobbered Berlin's coordinates: %v, %v", latitude, longitude)
	}
}

// Even a newer edit that lands after the provider answer has been accepted
// but immediately before its coordinates are written must win. This stages
// that edit in GORM's update callback: the optimistic updated_at predicate is
// already built, then the row version changes before the SQL executes.
func TestGeocodeCoordinateWriteIsAtomicWithAddressVersion(t *testing.T) {
	svc, contactID, vaultID := setupAddressTest(t)
	geocoder := &stubGeocoder{latitude: 51.5072, longitude: -0.1276}
	svc.SetGeocoder(geocoder)

	created, err := svc.Create(contactID, vaultID, dto.CreateAddressRequest{
		Line1: "10 Downing Street", City: "London", Country: "United Kingdom",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	const callbackName = "test:edit_before_geocode_coordinate_write"
	fired := false
	if err := svc.db.Callback().Update().Before("gorm:update").Register(callbackName, func(tx *gorm.DB) {
		if fired || len(tx.Statement.Selects) != 2 ||
			tx.Statement.Selects[0] != "latitude" || tx.Statement.Selects[1] != "longitude" {
			return
		}
		fired = true
		newerVersion := time.Now().UTC().Add(time.Hour)
		if err := tx.Session(&gorm.Session{SkipHooks: true}).Exec(
			"UPDATE addresses SET city = ?, country = ?, latitude = ?, longitude = ?, updated_at = ? WHERE id = ?",
			"Berlin", "Germany", 52.52, 13.405, newerVersion, created.ID,
		).Error; err != nil {
			t.Fatalf("staging edit immediately before coordinate write: %v", err)
		}
	}); err != nil {
		t.Fatalf("registering update callback: %v", err)
	}
	defer func() {
		if err := svc.db.Callback().Update().Remove(callbackName); err != nil {
			t.Fatalf("removing update callback: %v", err)
		}
	}()

	geocoder.latitude, geocoder.longitude = 48.2082, 16.3738
	if _, err := svc.Update(created.ID, contactID, vaultID, dto.UpdateAddressRequest{
		Line1: "Stephansplatz 1", City: "Vienna", Country: "Austria",
	}); err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if !fired {
		t.Fatal("the concurrent-edit callback did not intercept the coordinate write")
	}

	latitude, longitude := storedCoordinates(t, svc, created.ID)
	if latitude == nil || *latitude != 52.52 || longitude == nil || *longitude != 13.405 {
		t.Fatalf("Vienna's coordinate write clobbered the newer Berlin edit: %v, %v", latitude, longitude)
	}
}

// POST with coordinates the caller already knows must store them as given —
// spending a provider request to second-guess them would make Create and
// Update disagree about whose coordinates win.
func TestCreateAddressKeepsCallerCoordinates(t *testing.T) {
	svc, contactID, vaultID := setupAddressTest(t)
	geocoder := &stubGeocoder{latitude: 51.5072, longitude: -0.1276}
	svc.SetGeocoder(geocoder)

	latitude, longitude := 48.8566, 2.3522
	created, err := svc.Create(contactID, vaultID, dto.CreateAddressRequest{
		Line1: "48 Rue de Rivoli", City: "Paris", Country: "France",
		Latitude: &latitude, Longitude: &longitude,
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	stored, storedLongitude := storedCoordinates(t, svc, created.ID)
	if stored == nil || *stored != 48.8566 || storedLongitude == nil || *storedLongitude != 2.3522 {
		t.Fatalf("caller coordinates must be stored as given, got %v, %v", stored, storedLongitude)
	}
	if len(geocoder.queries) != 0 {
		t.Fatalf("no provider request should be spent on known coordinates, got %d", len(geocoder.queries))
	}
}
