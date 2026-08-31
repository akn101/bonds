package services

import (
	"errors"
	"testing"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
)

// stubGeocoder answers with fixed coordinates, and can be made to fail or to
// find nothing, which is where the interesting behaviour is.
type stubGeocoder struct {
	queries   []string
	latitude  float64
	longitude float64
	fail      bool
	noMatch   bool
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
