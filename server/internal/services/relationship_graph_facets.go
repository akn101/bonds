package services

import (
	"sort"
	"strconv"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/i18n"
	"github.com/naiba/bonds/internal/models"
)

// The dimensions the vault graph can be narrowed by. These are the attributes
// a contact carries directly or through a pivot; anything requiring a join
// through another contact is deliberately not a facet, because narrowing a
// relationship graph by a relationship is what the graph itself is for.
const (
	facetGender   = "gender"
	facetPronoun  = "pronoun"
	facetReligion = "religion"
	facetCompany  = "company"
	facetLabel    = "label"
	facetGroup    = "group"
)

// facetOrder fixes the order facets are returned in, so the filter bar does not
// reshuffle itself between requests.
var facetOrder = []string{facetGender, facetPronoun, facetReligion, facetCompany, facetLabel, facetGroup}

// VaultGraphFilter narrows which contacts are drawn, keyed by facet. Within one
// facet the selected values are OR-ed (a contact tagged either "school" or
// "family" matches both); across facets they are AND-ed (that contact must also
// match every other facet that has a selection). Facets with no selection do
// not constrain anything.
type VaultGraphFilter map[string][]string

// selection returns the chosen values of one facet as a set, and whether that
// facet constrains the graph at all.
func (f VaultGraphFilter) selection(key string) (map[string]struct{}, bool) {
	values := f[key]
	if len(values) == 0 {
		return nil, false
	}
	selected := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value != "" {
			selected[value] = struct{}{}
		}
	}
	return selected, len(selected) > 0
}

// contactFacets holds, for one vault, which facet values each contact carries
// and what each value is called. Values are identified by their numeric row id
// rather than their name, so a rename does not silently change what a saved
// filter means.
type contactFacets struct {
	// byContact[contactID][facetKey] is the set of value ids that contact has.
	byContact map[string]map[string]map[string]struct{}
	// names[facetKey][valueID] is the display label for that value.
	names map[string]map[string]string
}

func newContactFacets() *contactFacets {
	return &contactFacets{
		byContact: make(map[string]map[string]map[string]struct{}),
		names:     make(map[string]map[string]string),
	}
}

func (c *contactFacets) add(contactID, facetKey, valueID, name string) {
	if valueID == "" || name == "" {
		return
	}
	facets, ok := c.byContact[contactID]
	if !ok {
		facets = make(map[string]map[string]struct{}, 2)
		c.byContact[contactID] = facets
	}
	values, ok := facets[facetKey]
	if !ok {
		values = make(map[string]struct{}, 1)
		facets[facetKey] = values
	}
	values[valueID] = struct{}{}

	labels, ok := c.names[facetKey]
	if !ok {
		labels = make(map[string]string, 1)
		c.names[facetKey] = labels
	}
	labels[valueID] = name
}

// matches reports whether a contact satisfies every facet the filter constrains.
func (c *contactFacets) matches(contactID string, filter VaultGraphFilter) bool {
	for _, key := range facetOrder {
		selected, constrains := filter.selection(key)
		if !constrains {
			continue
		}
		values := c.byContact[contactID][key]
		found := false
		for value := range values {
			if _, ok := selected[value]; ok {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// options lists the facet values carried by the given contacts, with counts.
//
// The caller passes the contacts that are drawable *before* any filter is
// applied, on purpose: computing the options from the filtered set would make
// every selection narrow the list it was chosen from, and a reader who picked
// one value could never see the others to pick again.
func (c *contactFacets) options(drawable contactSet) []dto.GraphFacet {
	counts := make(map[string]map[string]int, len(facetOrder))
	for contactID := range drawable {
		for key, values := range c.byContact[contactID] {
			perFacet, ok := counts[key]
			if !ok {
				perFacet = make(map[string]int)
				counts[key] = perFacet
			}
			for value := range values {
				perFacet[value]++
			}
		}
	}

	facets := make([]dto.GraphFacet, 0, len(facetOrder))
	for _, key := range facetOrder {
		perFacet := counts[key]
		if len(perFacet) == 0 {
			// A facet nothing in this vault carries is left out entirely rather
			// than returned empty, so the page never renders a control that
			// could only ever match nothing.
			continue
		}
		values := make([]dto.GraphFacetValue, 0, len(perFacet))
		for value, count := range perFacet {
			values = append(values, dto.GraphFacetValue{
				Value: value,
				Label: c.names[key][value],
				Count: count,
			})
		}
		sort.Slice(values, func(i, j int) bool {
			if values[i].Count != values[j].Count {
				return values[i].Count > values[j].Count
			}
			return values[i].Label < values[j].Label
		})
		facets = append(facets, dto.GraphFacet{Key: key, Values: values})
	}
	return facets
}

// translatedName prefers the seeded translation key over the stored name, which
// is how the rest of the codebase renders these lookup rows.
func translatedName(locale string, name, translationKey *string) string {
	if translationKey != nil && *translationKey != "" {
		return i18n.T(locale, *translationKey)
	}
	if name != nil {
		return *name
	}
	return ""
}

// loadContactFacets reads the facet values of every contact in the vault.
//
// The lookup tables are read by the ids the contacts actually reference rather
// than by account, so this can never surface a value belonging to an account
// the caller has nothing to do with.
func (s *RelationshipService) loadContactFacets(vaultID, locale string, contacts []models.Contact) (*contactFacets, error) {
	facets := newContactFacets()
	type pivotRow struct {
		ContactID string
		ValueID   uint
		Name      string
	}

	genderIDs := make([]uint, 0)
	pronounIDs := make([]uint, 0)
	religionIDs := make([]uint, 0)
	companyIDs := make([]uint, 0)
	for _, contact := range contacts {
		if contact.GenderID != nil {
			genderIDs = append(genderIDs, *contact.GenderID)
		}
		if contact.PronounID != nil {
			pronounIDs = append(pronounIDs, *contact.PronounID)
		}
		if contact.ReligionID != nil {
			religionIDs = append(religionIDs, *contact.ReligionID)
		}
		if contact.CompanyID != nil {
			companyIDs = append(companyIDs, *contact.CompanyID)
		}
	}

	// Employment is stored in contact_companies by the current jobs API. Keep
	// reading Contact.CompanyID above for legacy rows, but build the facet from
	// the union so newly-created and multiple employments are represented.
	var companyRows []pivotRow
	if err := s.db.Table("contact_companies").
		Select("contact_companies.contact_id AS contact_id, companies.id AS value_id, companies.name AS name").
		Joins("JOIN companies ON companies.id = contact_companies.company_id").
		Where("contact_companies.contact_id IN (SELECT id FROM contacts WHERE vault_id = ?)", vaultID).
		Scan(&companyRows).Error; err != nil {
		return nil, err
	}
	for _, row := range companyRows {
		companyIDs = append(companyIDs, row.ValueID)
	}

	genderNames := make(map[uint]string, len(genderIDs))
	if len(genderIDs) > 0 {
		var rows []models.Gender
		if err := s.db.Where("id IN ?", uniqueUints(genderIDs)).Find(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			genderNames[row.ID] = translatedName(locale, row.Name, row.NameTranslationKey)
		}
	}

	pronounNames := make(map[uint]string, len(pronounIDs))
	if len(pronounIDs) > 0 {
		var rows []models.Pronoun
		if err := s.db.Where("id IN ?", uniqueUints(pronounIDs)).Find(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			pronounNames[row.ID] = translatedName(locale, row.Name, row.NameTranslationKey)
		}
	}

	religionNames := make(map[uint]string, len(religionIDs))
	if len(religionIDs) > 0 {
		var rows []models.Religion
		if err := s.db.Where("id IN ?", uniqueUints(religionIDs)).Find(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			religionNames[row.ID] = translatedName(locale, row.Name, row.TranslationKey)
		}
	}

	companyNames := make(map[uint]string, len(companyIDs))
	if len(companyIDs) > 0 {
		var rows []models.Company
		if err := s.db.Where("id IN ?", uniqueUints(companyIDs)).Find(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			companyNames[row.ID] = row.Name
		}
	}

	for _, contact := range contacts {
		if contact.GenderID != nil {
			facets.add(contact.ID, facetGender, strconv.FormatUint(uint64(*contact.GenderID), 10), genderNames[*contact.GenderID])
		}
		if contact.PronounID != nil {
			facets.add(contact.ID, facetPronoun, strconv.FormatUint(uint64(*contact.PronounID), 10), pronounNames[*contact.PronounID])
		}
		if contact.ReligionID != nil {
			facets.add(contact.ID, facetReligion, strconv.FormatUint(uint64(*contact.ReligionID), 10), religionNames[*contact.ReligionID])
		}
		if contact.CompanyID != nil {
			facets.add(contact.ID, facetCompany, strconv.FormatUint(uint64(*contact.CompanyID), 10), companyNames[*contact.CompanyID])
		}
	}
	for _, row := range companyRows {
		facets.add(row.ContactID, facetCompany, strconv.FormatUint(uint64(row.ValueID), 10), row.Name)
	}

	// Labels and groups are pivots, so they are read with a subquery on the
	// vault rather than by passing every contact id as a bind variable.
	var labelRows []pivotRow
	if err := s.db.Table("contact_label").
		Select("contact_label.contact_id AS contact_id, labels.id AS value_id, labels.name AS name").
		Joins("JOIN labels ON labels.id = contact_label.label_id").
		Where("contact_label.contact_id IN (SELECT id FROM contacts WHERE vault_id = ?)", vaultID).
		Scan(&labelRows).Error; err != nil {
		return nil, err
	}
	for _, row := range labelRows {
		facets.add(row.ContactID, facetLabel, strconv.FormatUint(uint64(row.ValueID), 10), row.Name)
	}

	var groupRows []pivotRow
	if err := s.db.Table("contact_group").
		Select("contact_group.contact_id AS contact_id, groups.id AS value_id, groups.name AS name").
		Joins("JOIN groups ON groups.id = contact_group.group_id").
		Where("contact_group.contact_id IN (SELECT id FROM contacts WHERE vault_id = ?)", vaultID).
		Scan(&groupRows).Error; err != nil {
		return nil, err
	}
	for _, row := range groupRows {
		facets.add(row.ContactID, facetGroup, strconv.FormatUint(uint64(row.ValueID), 10), row.Name)
	}

	return facets, nil
}

func uniqueUints(values []uint) []uint {
	seen := make(map[uint]struct{}, len(values))
	unique := make([]uint, 0, len(values))
	for _, value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		unique = append(unique, value)
	}
	return unique
}

// VaultGraphFacetKeys lists the facet keys the vault graph accepts, in the
// order they are returned. Exported so the transport layer reads the same set
// the service filters on rather than keeping its own copy in step by hand.
func VaultGraphFacetKeys() []string {
	keys := make([]string, len(facetOrder))
	copy(keys, facetOrder)
	return keys
}
