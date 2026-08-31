package services

import (
	"errors"
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"gorm.io/gorm"
)

var ErrAddressNotFound = errors.New("address not found")

type AddressService struct {
	db           *gorm.DB
	feedRecorder *FeedRecorder
	geocoder     Geocoder
}

func NewAddressService(db *gorm.DB) *AddressService {
	return &AddressService{db: db}
}

func (s *AddressService) SetFeedRecorder(fr *FeedRecorder) {
	s.feedRecorder = fr
}

func (s *AddressService) SetGeocoder(g Geocoder) {
	s.geocoder = g
}

func (s *AddressService) List(contactID, vaultID string) ([]dto.AddressResponse, error) {
	if err := validateContactBelongsToVault(s.db, contactID, vaultID); err != nil {
		return nil, err
	}
	var pivots []models.ContactAddress
	if err := s.db.Where("contact_id = ?", contactID).Find(&pivots).Error; err != nil {
		return nil, err
	}
	if len(pivots) == 0 {
		return []dto.AddressResponse{}, nil
	}

	addressIDs := make([]uint, len(pivots))
	pivotByAddr := make(map[uint]models.ContactAddress)
	for i, p := range pivots {
		addressIDs[i] = p.AddressID
		pivotByAddr[p.AddressID] = p
	}

	var addresses []models.Address
	if err := s.db.Where("id IN ?", addressIDs).Find(&addresses).Error; err != nil {
		return nil, err
	}

	result := make([]dto.AddressResponse, len(addresses))
	for i, a := range addresses {
		p := pivotByAddr[a.ID]
		result[i] = toAddressResponse(&a, p.IsPastAddress, p.DateFrom, p.DateTo)
	}
	return result, nil
}

func (s *AddressService) Create(contactID, vaultID string, req dto.CreateAddressRequest) (*dto.AddressResponse, error) {
	if err := validateContactBelongsToVault(s.db, contactID, vaultID); err != nil {
		return nil, err
	}
	address := models.Address{
		VaultID:       vaultID,
		Line1:         strPtrOrNil(req.Line1),
		Line2:         strPtrOrNil(req.Line2),
		City:          strPtrOrNil(req.City),
		Province:      strPtrOrNil(req.Province),
		PostalCode:    strPtrOrNil(req.PostalCode),
		Country:       strPtrOrNil(req.Country),
		AddressTypeID: req.AddressTypeID,
		Latitude:      req.Latitude,
		Longitude:     req.Longitude,
	}

	// A non-null DateTo implies the contact has moved out — auto-flip
	// IsPastAddress to true so the two fields can't disagree silently.
	isPast := req.IsPastAddress || req.DateTo != nil

	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&address).Error; err != nil {
			return err
		}
		pivot := models.ContactAddress{
			ContactID:     contactID,
			AddressID:     address.ID,
			IsPastAddress: isPast,
			DateFrom:      req.DateFrom,
			DateTo:        req.DateTo,
		}
		// Honor the GORM zero-value-bool trap for the false-explicit case
		// (per AGENTS.md). Create skips false; a separate Update locks it in.
		if err := tx.Create(&pivot).Error; err != nil {
			return err
		}
		if !isPast {
			return tx.Model(&pivot).Update("is_past_address", false).Error
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Coordinates the caller already knows are kept as given — spending a
	// provider request to second-guess them would make POST and PUT disagree
	// about whose coordinates win.
	if address.Latitude == nil || address.Longitude == nil {
		s.tryGeocode(&address)
	}

	if s.feedRecorder != nil {
		entityType := "Address"
		s.feedRecorder.Record(contactID, "", ActionAddressAdded, "Added an address", &address.ID, &entityType)
	}

	resp := toAddressResponse(&address, isPast, req.DateFrom, req.DateTo)
	return &resp, nil
}

func (s *AddressService) Update(id uint, contactID, vaultID string, req dto.UpdateAddressRequest) (*dto.AddressResponse, error) {
	if err := validateContactBelongsToVault(s.db, contactID, vaultID); err != nil {
		return nil, err
	}
	var pivot models.ContactAddress
	if err := s.db.Where("address_id = ? AND contact_id = ?", id, contactID).First(&pivot).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAddressNotFound
		}
		return nil, err
	}

	var address models.Address
	if err := s.db.First(&address, id).Error; err != nil {
		return nil, ErrAddressNotFound
	}

	// Remember where the address was before it is overwritten, so an edit that
	// does not move it keeps its coordinates. The address form does not send
	// latitude or longitude, so assigning them straight from the request would
	// erase the geocode on every save and nothing would ever recompute it.
	previousQuery := geocodeQuery(&address)
	previousLatitude, previousLongitude := address.Latitude, address.Longitude

	address.Line1 = strPtrOrNil(req.Line1)
	address.Line2 = strPtrOrNil(req.Line2)
	address.City = strPtrOrNil(req.City)
	address.Province = strPtrOrNil(req.Province)
	address.PostalCode = strPtrOrNil(req.PostalCode)
	address.Country = strPtrOrNil(req.Country)
	address.AddressTypeID = req.AddressTypeID

	// A cosmetic edit is not a move: trailing whitespace or a change of case
	// would be asked of the geocoder as the same question, so it must not cost
	// the stored coordinates (nor a provider request to recompute them).
	movedElsewhere := !sameGeocodeQuery(geocodeQuery(&address), previousQuery)

	// Coordinates in the request only count as caller-supplied when they say
	// something the server did not already say. PUT is full-replace, so a
	// read-modify-write client echoes the whole object back — including the
	// coordinates it was handed. If the address text moved but the coordinates
	// are the old pair verbatim, that is a stale echo, not an instruction to
	// pin a Vienna address at London forever.
	echoedCoordinates := req.Latitude != nil && req.Longitude != nil &&
		previousLatitude != nil && previousLongitude != nil &&
		*req.Latitude == *previousLatitude && *req.Longitude == *previousLongitude
	coordinatesGiven := req.Latitude != nil && req.Longitude != nil &&
		!(movedElsewhere && echoedCoordinates)
	switch {
	case coordinatesGiven:
		address.Latitude = req.Latitude
		address.Longitude = req.Longitude
	case movedElsewhere:
		// The address now describes somewhere else, so the old coordinates are
		// simply wrong. Drop them before re-geocoding: keeping them until a
		// replacement arrives would leave the address pinned to its previous
		// location whenever the provider errors or finds nothing, which is a
		// worse answer than having no pin at all.
		address.Latitude, address.Longitude = nil, nil
	default:
		address.Latitude = previousLatitude
		address.Longitude = previousLongitude
	}

	isPast := req.IsPastAddress || req.DateTo != nil
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&address).Error; err != nil {
			return err
		}
		pivot.IsPastAddress = isPast
		pivot.DateFrom = req.DateFrom
		pivot.DateTo = req.DateTo
		return tx.Save(&pivot).Error
	})
	if err != nil {
		return nil, err
	}

	// Re-geocode when the address actually moved — and also when it has no
	// coordinates at all, because "arrive back at the coordinates already
	// stored" is no reason to skip when nothing is stored: an address created
	// while the provider was down would otherwise never get a pin without the
	// user mangling its text and changing it back.
	if !coordinatesGiven && (movedElsewhere || address.Latitude == nil || address.Longitude == nil) {
		s.tryGeocode(&address)
	}

	resp := toAddressResponse(&address, isPast, req.DateFrom, req.DateTo)
	return &resp, nil
}

func (s *AddressService) Delete(id uint, contactID, vaultID string) error {
	if err := validateContactBelongsToVault(s.db, contactID, vaultID); err != nil {
		return err
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Where("address_id = ? AND contact_id = ?", id, contactID).Delete(&models.ContactAddress{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrAddressNotFound
		}
		return tx.Where("id = ?", id).Delete(&models.Address{}).Error
	})
}

// geocodeQuery renders the address as the single line a geocoder is asked
// about. Line 2 is left out deliberately: flat and building numbers are noise
// to a geocoder and routinely cost it the match.
func geocodeQuery(address *models.Address) string {
	parts := []string{}
	for _, p := range []*string{address.Line1, address.City, address.Province, address.PostalCode, address.Country} {
		if p != nil && *p != "" {
			parts = append(parts, *p)
		}
	}
	return strings.Join(parts, ", ")
}

// sameGeocodeQuery reports whether two geocoding queries would ask the
// provider the same question: case and whitespace do not change the answer,
// so they do not count as a move. Whitespace is removed entirely rather than
// collapsed, because a trimmed field otherwise leaves a stranded separator
// ("London ," versus "London,") that a word-level comparison still sees.
func sameGeocodeQuery(a, b string) bool {
	return strings.EqualFold(strings.Join(strings.Fields(a), ""), strings.Join(strings.Fields(b), ""))
}

func (s *AddressService) tryGeocode(address *models.Address) {
	if s.geocoder == nil {
		return
	}
	query := geocodeQuery(address)
	if query == "" {
		return
	}
	result, err := s.geocoder.Geocode(query)
	if err != nil {
		// Worth a line in the log: a misconfigured provider or a blocked IP is
		// otherwise completely invisible, and the only symptom is addresses
		// quietly never getting coordinates. The query itself stays out of the
		// log, though — in exact mode it is a contact's complete home address,
		// and the address ID identifies the row just as well.
		log.Printf("geocoding address %d via %T failed: %v", address.ID, s.geocoder, redactGeocodeError(err))
		return
	}
	if result == nil {
		return
	}
	// The provider can take seconds to answer, and this runs after the edit's
	// transaction committed — the row may already describe somewhere else. A
	// late answer for the old text must not overwrite the newer edit's
	// coordinates, so re-read and only store if the row still asks the same
	// question that was geocoded. (A concurrent edit landing in the microseconds
	// between this check and the write can still lose, but that window is the
	// provider round-trip no longer.)
	var current models.Address
	if err := s.db.First(&current, address.ID).Error; err != nil {
		return
	}
	if !sameGeocodeQuery(geocodeQuery(&current), query) {
		return
	}
	address.Latitude = &result.Latitude
	address.Longitude = &result.Longitude
	if err := s.db.Model(address).Select("latitude", "longitude").Updates(address).Error; err != nil {
		log.Printf("storing geocode for address %d failed: %v", address.ID, err)
	}
}

// redactGeocodeError strips the request URL from a geocoding failure before
// it reaches the log. A transport error carries the full URL it was for, and
// that URL embeds the geocoding query — the same address the log line above
// deliberately leaves out.
func redactGeocodeError(err error) error {
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return fmt.Errorf("%s request failed: %w", urlErr.Op, urlErr.Err)
	}
	return err
}

func toAddressResponse(a *models.Address, isPastAddress bool, dateFrom, dateTo *time.Time) dto.AddressResponse {
	return dto.AddressResponse{
		ID:            a.ID,
		VaultID:       a.VaultID,
		Line1:         ptrToStr(a.Line1),
		Line2:         ptrToStr(a.Line2),
		City:          ptrToStr(a.City),
		Province:      ptrToStr(a.Province),
		PostalCode:    ptrToStr(a.PostalCode),
		Country:       ptrToStr(a.Country),
		AddressTypeID: a.AddressTypeID,
		Latitude:      a.Latitude,
		Longitude:     a.Longitude,
		IsPastAddress: isPastAddress,
		DateFrom:      dateFrom,
		DateTo:        dateTo,
		CreatedAt:     a.CreatedAt,
		UpdatedAt:     a.UpdatedAt,
	}
}
