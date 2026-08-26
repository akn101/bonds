package services

import (
	"strconv"
	"testing"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
)

func labelContact(t *testing.T, ctx relationshipTestCtx, name string, contactIDs ...string) string {
	t.Helper()
	label := models.Label{VaultID: ctx.vaultID, Name: name, Slug: name}
	if err := ctx.db.Create(&label).Error; err != nil {
		t.Fatalf("create label %q: %v", name, err)
	}
	for _, contactID := range contactIDs {
		if err := ctx.db.Create(&models.ContactLabel{LabelID: label.ID, ContactID: contactID}).Error; err != nil {
			t.Fatalf("attach label %q to %s: %v", name, contactID, err)
		}
	}
	return uintToString(label.ID)
}

func groupContact(t *testing.T, ctx relationshipTestCtx, name string, contactIDs ...string) string {
	t.Helper()
	group := models.Group{VaultID: ctx.vaultID, Name: name}
	if err := ctx.db.Create(&group).Error; err != nil {
		t.Fatalf("create group %q: %v", name, err)
	}
	for _, contactID := range contactIDs {
		if err := ctx.db.Create(&models.ContactGroup{GroupID: group.ID, ContactID: contactID}).Error; err != nil {
			t.Fatalf("attach group %q to %s: %v", name, contactID, err)
		}
	}
	return uintToString(group.ID)
}

func genderContact(t *testing.T, ctx relationshipTestCtx, name string, contactIDs ...string) string {
	t.Helper()
	gender := models.Gender{AccountID: ctx.accountID, Name: &name}
	if err := ctx.db.Create(&gender).Error; err != nil {
		t.Fatalf("create gender %q: %v", name, err)
	}
	for _, contactID := range contactIDs {
		if err := ctx.db.Model(&models.Contact{}).Where("id = ?", contactID).
			Update("gender_id", gender.ID).Error; err != nil {
			t.Fatalf("set gender %q on %s: %v", name, contactID, err)
		}
	}
	return uintToString(gender.ID)
}

func uintToString(value uint) string {
	return strconv.FormatUint(uint64(value), 10)
}

func nodeIDs(t *testing.T, ids []string) map[string]struct{} {
	t.Helper()
	set := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		set[id] = struct{}{}
	}
	return set
}

// A facet nobody carries is not a filter anyone can use, so it is left out
// rather than rendered as an empty control.
func TestVaultGraphFacetsListOnlyWhatTheVaultCarries(t *testing.T) {
	ctx := setupRelationshipTestFull(t)
	forwardTypeID, _ := createAsymmetricTypePair(t, ctx.db, ctx.accountID)
	createGraphRelationship(t, ctx, ctx.contactID, ctx.relatedContactID, forwardTypeID)
	schoolID := labelContact(t, ctx, "school", ctx.contactID, ctx.relatedContactID)
	closeID := labelContact(t, ctx, "close", ctx.contactID)

	graph, err := ctx.svc.GetVaultGraph(ctx.vaultID, ctx.userID, "en", 0, nil)
	if err != nil {
		t.Fatalf("GetVaultGraph: %v", err)
	}

	byKey := map[string]map[string]int{}
	for _, facet := range graph.Facets {
		counts := map[string]int{}
		for _, value := range facet.Values {
			counts[value.Value] = value.Count
		}
		byKey[facet.Key] = counts
	}

	if got := byKey["label"][schoolID]; got != 2 {
		t.Errorf("school label count = %d, want 2", got)
	}
	if got := byKey["label"][closeID]; got != 1 {
		t.Errorf("close label count = %d, want 1", got)
	}
	for _, absent := range []string{"gender", "pronoun", "religion", "company", "group"} {
		if _, ok := byKey[absent]; ok {
			t.Errorf("facet %q returned despite nothing carrying it", absent)
		}
	}
}

// The options describe what can be drawn, so a contact nothing connects to
// should not put a value into a list that only narrows the drawing.
func TestVaultGraphFacetsIgnoreContactsThatCannotBeDrawn(t *testing.T) {
	ctx := setupRelationshipTestFull(t)
	forwardTypeID, _ := createAsymmetricTypePair(t, ctx.db, ctx.accountID)
	createGraphRelationship(t, ctx, ctx.contactID, ctx.relatedContactID, forwardTypeID)
	loner := createGraphContact(t, ctx, "Loner")
	lonelyID := labelContact(t, ctx, "lonely", loner)

	graph, err := ctx.svc.GetVaultGraph(ctx.vaultID, ctx.userID, "en", 0, nil)
	if err != nil {
		t.Fatalf("GetVaultGraph: %v", err)
	}

	for _, facet := range graph.Facets {
		for _, value := range facet.Values {
			if value.Value == lonelyID {
				t.Fatalf("facet value %q from an undrawable contact was offered", value.Label)
			}
		}
	}
}

func TestVaultGraphFilterDrawsOnlyMatchingContacts(t *testing.T) {
	ctx := setupRelationshipTestFull(t)
	forwardTypeID, _ := createAsymmetricTypePair(t, ctx.db, ctx.accountID)
	third := createGraphContact(t, ctx, "Third")
	createGraphRelationship(t, ctx, ctx.contactID, ctx.relatedContactID, forwardTypeID)
	createGraphRelationship(t, ctx, ctx.contactID, third, forwardTypeID)
	schoolID := labelContact(t, ctx, "school", ctx.contactID, ctx.relatedContactID)

	graph, err := ctx.svc.GetVaultGraph(ctx.vaultID, ctx.userID, "en", 0,
		VaultGraphFilter{"label": {schoolID}})
	if err != nil {
		t.Fatalf("GetVaultGraph: %v", err)
	}

	drawn := map[string]struct{}{}
	for _, node := range graph.Nodes {
		drawn[node.ID] = struct{}{}
	}
	if len(drawn) != 2 {
		t.Fatalf("drew %d contacts, want 2", len(drawn))
	}
	if _, ok := drawn[third]; ok {
		t.Error("drew a contact that does not carry the filtered label")
	}
	if graph.FilteredOut != 1 {
		t.Errorf("filtered_out = %d, want 1", graph.FilteredOut)
	}
}

// Within a facet the values widen the result; across facets they narrow it.
// Getting this backwards would make every extra selection return less, which
// is not what a reader ticking a second box expects.
func TestVaultGraphFilterOrsWithinAFacetAndAndsAcrossThem(t *testing.T) {
	ctx := setupRelationshipTestFull(t)
	forwardTypeID, _ := createAsymmetricTypePair(t, ctx.db, ctx.accountID)
	third := createGraphContact(t, ctx, "Third")
	createGraphRelationship(t, ctx, ctx.contactID, ctx.relatedContactID, forwardTypeID)
	createGraphRelationship(t, ctx, ctx.contactID, third, forwardTypeID)

	schoolID := labelContact(t, ctx, "school", ctx.contactID)
	familyID := labelContact(t, ctx, "family", ctx.relatedContactID, third)
	etonID := groupContact(t, ctx, "Eton", ctx.contactID, ctx.relatedContactID)

	// Two values of one facet: everyone carrying either.
	wide, err := ctx.svc.GetVaultGraph(ctx.vaultID, ctx.userID, "en", 0,
		VaultGraphFilter{"label": {schoolID, familyID}})
	if err != nil {
		t.Fatalf("GetVaultGraph (or): %v", err)
	}
	if len(wide.Nodes) != 3 {
		t.Errorf("or within a facet drew %d contacts, want 3", len(wide.Nodes))
	}

	// Add a second facet: only those carrying a label *and* in the group.
	narrow, err := ctx.svc.GetVaultGraph(ctx.vaultID, ctx.userID, "en", 0,
		VaultGraphFilter{"label": {schoolID, familyID}, "group": {etonID}})
	if err != nil {
		t.Fatalf("GetVaultGraph (and): %v", err)
	}
	if len(narrow.Nodes) != 2 {
		t.Fatalf("and across facets drew %d contacts, want 2", len(narrow.Nodes))
	}
	drawn := nodeIDs(t, []string{narrow.Nodes[0].ID, narrow.Nodes[1].ID})
	if _, ok := drawn[third]; ok {
		t.Error("drew a contact that fails the second facet")
	}
}

// Someone whose every relation was filtered away has nothing to show on a
// relationship graph. Drawing them as a loose dot is the noise that isolated
// contacts are excluded to avoid.
func TestVaultGraphFilterDropsMatchesLeftWithoutAPartner(t *testing.T) {
	ctx := setupRelationshipTestFull(t)
	forwardTypeID, _ := createAsymmetricTypePair(t, ctx.db, ctx.accountID)
	createGraphRelationship(t, ctx, ctx.contactID, ctx.relatedContactID, forwardTypeID)
	schoolID := labelContact(t, ctx, "school", ctx.contactID)

	graph, err := ctx.svc.GetVaultGraph(ctx.vaultID, ctx.userID, "en", 0,
		VaultGraphFilter{"label": {schoolID}})
	if err != nil {
		t.Fatalf("GetVaultGraph: %v", err)
	}

	if len(graph.Nodes) != 0 {
		t.Errorf("drew %d contacts, want none: the only match lost its partner", len(graph.Nodes))
	}
	// Both are reported: the one the filter rejected and the one it stranded.
	if graph.FilteredOut != 2 {
		t.Errorf("filtered_out = %d, want 2", graph.FilteredOut)
	}
	if graph.Components != 0 {
		t.Errorf("components = %d, want 0", graph.Components)
	}
}

// A selection must not narrow the list it was chosen from, or a reader who
// picks one value can never see the others to pick again.
func TestVaultGraphFacetsAreUnchangedByTheFilter(t *testing.T) {
	ctx := setupRelationshipTestFull(t)
	forwardTypeID, _ := createAsymmetricTypePair(t, ctx.db, ctx.accountID)
	third := createGraphContact(t, ctx, "Third")
	createGraphRelationship(t, ctx, ctx.contactID, ctx.relatedContactID, forwardTypeID)
	createGraphRelationship(t, ctx, ctx.contactID, third, forwardTypeID)
	schoolID := labelContact(t, ctx, "school", ctx.contactID, ctx.relatedContactID)
	labelContact(t, ctx, "family", third)

	unfiltered, err := ctx.svc.GetVaultGraph(ctx.vaultID, ctx.userID, "en", 0, nil)
	if err != nil {
		t.Fatalf("GetVaultGraph (unfiltered): %v", err)
	}
	filtered, err := ctx.svc.GetVaultGraph(ctx.vaultID, ctx.userID, "en", 0,
		VaultGraphFilter{"label": {schoolID}})
	if err != nil {
		t.Fatalf("GetVaultGraph (filtered): %v", err)
	}

	if len(unfiltered.Facets) != len(filtered.Facets) {
		t.Fatalf("facet count changed under a filter: %d then %d",
			len(unfiltered.Facets), len(filtered.Facets))
	}
	for index, facet := range unfiltered.Facets {
		other := filtered.Facets[index]
		if facet.Key != other.Key || len(facet.Values) != len(other.Values) {
			t.Fatalf("facet %q changed under a filter", facet.Key)
		}
		for valueIndex, value := range facet.Values {
			if value != other.Values[valueIndex] {
				t.Errorf("facet %q value %q changed under a filter", facet.Key, value.Label)
			}
		}
	}
}

// Gender is the facet people ask for first, and it is also the one most often
// left unset; it must work exactly like the rest once it is populated.
func TestVaultGraphFiltersByGenderLikeAnyOtherFacet(t *testing.T) {
	ctx := setupRelationshipTestFull(t)
	forwardTypeID, _ := createAsymmetricTypePair(t, ctx.db, ctx.accountID)
	third := createGraphContact(t, ctx, "Third")
	createGraphRelationship(t, ctx, ctx.contactID, ctx.relatedContactID, forwardTypeID)
	createGraphRelationship(t, ctx, ctx.contactID, third, forwardTypeID)
	femaleID := genderContact(t, ctx, "Female", ctx.contactID, ctx.relatedContactID)
	genderContact(t, ctx, "Male", third)

	graph, err := ctx.svc.GetVaultGraph(ctx.vaultID, ctx.userID, "en", 0,
		VaultGraphFilter{"gender": {femaleID}})
	if err != nil {
		t.Fatalf("GetVaultGraph: %v", err)
	}

	if len(graph.Nodes) != 2 {
		t.Fatalf("drew %d contacts, want 2", len(graph.Nodes))
	}
	var genderFacet bool
	for _, facet := range graph.Facets {
		if facet.Key == "gender" {
			genderFacet = true
			if len(facet.Values) != 2 {
				t.Errorf("gender facet offered %d values, want 2", len(facet.Values))
			}
		}
	}
	if !genderFacet {
		t.Error("gender facet missing even though contacts carry one")
	}
}

func TestVaultGraphCompanyFacetUsesCurrentContactJobs(t *testing.T) {
	ctx := setupRelationshipTestFull(t)
	forwardTypeID, _ := createAsymmetricTypePair(t, ctx.db, ctx.accountID)
	createGraphRelationship(t, ctx, ctx.contactID, ctx.relatedContactID, forwardTypeID)

	company := models.Company{VaultID: ctx.vaultID, Name: "Acme"}
	if err := ctx.db.Create(&company).Error; err != nil {
		t.Fatalf("create company: %v", err)
	}
	jobService := NewContactJobService(ctx.db)
	for _, contactID := range []string{ctx.contactID, ctx.relatedContactID} {
		if _, err := jobService.Create(contactID, ctx.vaultID, dto.CreateContactJobRequest{
			CompanyID: company.ID,
		}); err != nil {
			t.Fatalf("create current contact job for %s: %v", contactID, err)
		}
	}

	companyID := uintToString(company.ID)
	unfiltered, err := ctx.svc.GetVaultGraph(ctx.vaultID, ctx.userID, "en", 0, nil)
	if err != nil {
		t.Fatalf("GetVaultGraph: %v", err)
	}
	var found bool
	for _, facet := range unfiltered.Facets {
		if facet.Key != facetCompany {
			continue
		}
		for _, value := range facet.Values {
			if value.Value == companyID && value.Label == company.Name && value.Count == 2 {
				found = true
			}
		}
	}
	if !found {
		t.Fatal("company from contact_companies was not offered as a facet")
	}

	filtered, err := ctx.svc.GetVaultGraph(ctx.vaultID, ctx.userID, "en", 0,
		VaultGraphFilter{facetCompany: {companyID}})
	if err != nil {
		t.Fatalf("GetVaultGraph filtered by current contact job: %v", err)
	}
	if len(filtered.Nodes) != 2 || filtered.FilteredOut != 0 {
		t.Fatalf("company filter should draw both current employees: nodes=%d filtered_out=%d", len(filtered.Nodes), filtered.FilteredOut)
	}
}

// An empty filter must be the same graph as no filter at all, so a page that
// sends its controls unset does not quietly get a different answer.
func TestVaultGraphEmptyFilterMatchesNoFilter(t *testing.T) {
	ctx := setupRelationshipTestFull(t)
	forwardTypeID, _ := createAsymmetricTypePair(t, ctx.db, ctx.accountID)
	createGraphRelationship(t, ctx, ctx.contactID, ctx.relatedContactID, forwardTypeID)
	labelContact(t, ctx, "school", ctx.contactID)

	none, err := ctx.svc.GetVaultGraph(ctx.vaultID, ctx.userID, "en", 0, nil)
	if err != nil {
		t.Fatalf("GetVaultGraph (nil): %v", err)
	}
	empty, err := ctx.svc.GetVaultGraph(ctx.vaultID, ctx.userID, "en", 0,
		VaultGraphFilter{"label": {}, "gender": {""}})
	if err != nil {
		t.Fatalf("GetVaultGraph (empty): %v", err)
	}

	if len(none.Nodes) != len(empty.Nodes) || none.FilteredOut != empty.FilteredOut {
		t.Errorf("empty filter drew %d nodes / %d filtered out, no filter drew %d / %d",
			len(empty.Nodes), empty.FilteredOut, len(none.Nodes), none.FilteredOut)
	}
}
