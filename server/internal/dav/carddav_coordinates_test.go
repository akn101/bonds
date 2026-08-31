package dav

import (
	"testing"

	"github.com/emersion/go-vcard"
	"github.com/naiba/bonds/internal/models"
)

// A phone syncing a contact back rewrites every address row, and vCards do
// not carry coordinates — so without the carry-over, any CardDAV write erased
// every pin the server had geocoded, even when the sync never touched the
// addresses. These tests pin the carry-over: same address, same pin; moved
// address, no stale pin.
func TestPutAddressObjectKeepsCoordinatesOfUnchangedAddresses(t *testing.T) {
	backend, db, ctx, vaultID, userID := setupCardDAVTest(t)

	newCard := func(street, city, country string) vcard.Card {
		card := make(vcard.Card)
		card.SetValue(vcard.FieldVersion, "3.0")
		card.SetValue(vcard.FieldFormattedName, "Pinned Person")
		card.SetName(&vcard.Name{GivenName: "Pinned", FamilyName: "Person"})
		card.AddAddress(&vcard.Address{StreetAddress: street, Locality: city, Country: country})
		return card
	}

	if _, err := backend.PutAddressObject(ctx,
		"/dav/addressbooks/"+userID+"/"+vaultID+"/pinned-person.vcf",
		newCard("10 Downing Street", "London", "United Kingdom"), nil); err != nil {
		t.Fatalf("initial PutAddressObject failed: %v", err)
	}
	// A real client PUTs back to the path it was given, which carries the
	// contact's actual id.
	var contact models.Contact
	if err := db.Where("vault_id = ? AND first_name = ?", vaultID, "Pinned").First(&contact).Error; err != nil {
		t.Fatalf("loading created contact: %v", err)
	}
	path := "/dav/addressbooks/" + userID + "/" + vaultID + "/" + contact.ID + ".vcf"

	loadAddress := func() models.Address {
		t.Helper()
		var pivot models.ContactAddress
		if err := db.Where("contact_id = ?", contact.ID).First(&pivot).Error; err != nil {
			t.Fatalf("loading address pivot: %v", err)
		}
		var address models.Address
		if err := db.First(&address, pivot.AddressID).Error; err != nil {
			t.Fatalf("loading address: %v", err)
		}
		return address
	}

	// The server geocoded the address at some point after the first sync.
	latitude, longitude := 51.5072, -0.1276
	if err := db.Model(&models.Address{}).Where("id = ?", loadAddress().ID).
		Updates(models.Address{Latitude: &latitude, Longitude: &longitude}).Error; err != nil {
		t.Fatalf("staging coordinates: %v", err)
	}

	// The phone syncs the same contact back — same address, different case and
	// spacing, which is how phones routinely normalise fields.
	if _, err := backend.PutAddressObject(ctx, path, newCard("10 Downing Street ", "LONDON", "United Kingdom"), nil); err != nil {
		t.Fatalf("second PutAddressObject failed: %v", err)
	}

	address := loadAddress()
	if address.Latitude == nil || *address.Latitude != 51.5072 || address.Longitude == nil {
		t.Fatalf("a sync of the same address must keep its coordinates, got %v, %v", address.Latitude, address.Longitude)
	}

	// The phone moves the address: the old pin is wrong and must not survive.
	if _, err := backend.PutAddressObject(ctx, path, newCard("Stephansplatz 1", "Vienna", "Austria"), nil); err != nil {
		t.Fatalf("third PutAddressObject failed: %v", err)
	}
	address = loadAddress()
	if address.Latitude != nil || address.Longitude != nil {
		t.Fatalf("a moved address must not keep the old pin, got %v, %v", address.Latitude, address.Longitude)
	}
}
