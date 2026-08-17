package services

import (
	"errors"
	"testing"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/testutil"
)

// asContactGraph lets the vault graph reuse the node and relation assertions
// written for the single-contact graph; the two carry the same nodes and edges.
func asContactGraph(graph *dto.VaultGraphResponse) *dto.ContactGraphResponse {
	return &dto.ContactGraphResponse{Nodes: graph.Nodes, Edges: graph.Edges}
}

func createGraphContactInVault(t *testing.T, ctx relationshipTestCtx, vaultID, firstName string) string {
	t.Helper()
	contact, err := NewContactService(ctx.db).CreateContact(
		vaultID,
		ctx.userID,
		dto.CreateContactRequest{FirstName: firstName},
	)
	if err != nil {
		t.Fatalf("create contact %q in vault %s: %v", firstName, vaultID, err)
	}
	return contact.ID
}

func TestVaultGraphDrawsRelatedContactsAndCountsIsolatedOnes(t *testing.T) {
	ctx := setupRelationshipTestFull(t)
	isolated := createGraphContact(t, ctx, "Isolated")
	alsoIsolated := createGraphContact(t, ctx, "AlsoIsolated")
	forwardTypeID, _ := createAsymmetricTypePair(t, ctx.db, ctx.accountID)
	createGraphRelationship(t, ctx, ctx.contactID, ctx.relatedContactID, forwardTypeID)

	graph, err := ctx.svc.GetVaultGraph(ctx.vaultID, ctx.userID, "en", 0)
	if err != nil {
		t.Fatalf("GetVaultGraph: %v", err)
	}
	if len(graph.Nodes) != 2 {
		t.Fatalf("nodes = %d, want only the two related contacts", len(graph.Nodes))
	}
	for _, contactID := range []string{isolated, alsoIsolated} {
		if graphContainsNode(asContactGraph(graph), contactID) {
			t.Errorf("unrelated contact %s was drawn", contactID)
		}
	}
	if graph.IsolatedContacts != 2 {
		t.Errorf("isolated_contacts = %d, want 2", graph.IsolatedContacts)
	}
	if graph.Components != 1 {
		t.Errorf("components = %d, want 1", graph.Components)
	}
	if graph.ExternalRelationships != 0 {
		t.Errorf("external_relationships = %d, want 0", graph.ExternalRelationships)
	}
	if graph.Truncated {
		t.Error("graph reported as truncated when everything fitted")
	}
}

func TestVaultGraphCountsSeparateClustersIndependently(t *testing.T) {
	ctx := setupRelationshipTestFull(t)
	thirdContact := createGraphContact(t, ctx, "Third")
	fourthContact := createGraphContact(t, ctx, "Fourth")
	forwardTypeID, _ := createAsymmetricTypePair(t, ctx.db, ctx.accountID)
	createGraphRelationship(t, ctx, ctx.contactID, ctx.relatedContactID, forwardTypeID)
	createGraphRelationship(t, ctx, thirdContact, fourthContact, forwardTypeID)

	graph, err := ctx.svc.GetVaultGraph(ctx.vaultID, ctx.userID, "en", 0)
	if err != nil {
		t.Fatalf("GetVaultGraph: %v", err)
	}
	if len(graph.Nodes) != 4 {
		t.Fatalf("nodes = %d, want all four contacts across both clusters", len(graph.Nodes))
	}
	if graph.Components != 2 {
		t.Errorf("components = %d, want the two unconnected clusters", graph.Components)
	}
	if graph.IsolatedContacts != 0 {
		t.Errorf("isolated_contacts = %d, want 0", graph.IsolatedContacts)
	}
}

// The vault graph must infer family across the whole vault, not just around one
// person: the two siblings here are only siblings by way of a shared parent, and
// nothing in the request names any of them as a centre.
func TestVaultGraphInfersFamilyWithoutACentreContact(t *testing.T) {
	ctx := setupRelationshipTestFull(t)
	firstChild := ctx.contactID
	secondChild := ctx.relatedContactID
	parent := createGraphContact(t, ctx, "Parent")
	grandParent := createGraphContact(t, ctx, "GrandParent")
	parentTypeID := seededGraphRelationshipTypeID(t, ctx, relKeyParent)

	createGraphRelationship(t, ctx, grandParent, parent, parentTypeID)
	createGraphRelationship(t, ctx, parent, firstChild, parentTypeID)
	createGraphRelationship(t, ctx, parent, secondChild, parentTypeID)

	graph, err := ctx.svc.GetVaultGraph(ctx.vaultID, ctx.userID, "en", 0)
	if err != nil {
		t.Fatalf("GetVaultGraph: %v", err)
	}
	if len(graph.Nodes) != 4 {
		t.Fatalf("nodes = %d, want the whole four-person lineage", len(graph.Nodes))
	}
	if graphRelationCount(asContactGraph(graph), firstChild, secondChild, relKindSibling, relKindSibling, true) != 1 {
		t.Error("siblings sharing a parent were not inferred exactly once")
	}
	for _, child := range []string{firstChild, secondChild} {
		if graphRelationCount(asContactGraph(graph), grandParent, child, relKindGrandParent, relKindGrandChild, true) != 1 {
			t.Errorf("grandparent inference missing for child %s", child)
		}
	}
	for _, node := range graph.Nodes {
		if node.IsCenter {
			t.Errorf("vault graph named contact %s as a centre", node.ID)
		}
	}
}

func TestVaultGraphCountsRelationshipsLeavingTheVaultWithoutDrawingThem(t *testing.T) {
	ctx := setupRelationshipTestFull(t)
	otherVault, err := NewVaultService(ctx.db).CreateVault(ctx.accountID, ctx.userID, dto.CreateVaultRequest{Name: "Other Vault"}, "en")
	if err != nil {
		t.Fatalf("CreateVault: %v", err)
	}
	outsider := createGraphContactInVault(t, ctx, otherVault.ID, "Outsider")
	forwardTypeID, _ := createAsymmetricTypePair(t, ctx.db, ctx.accountID)
	createGraphRelationship(t, ctx, ctx.contactID, ctx.relatedContactID, forwardTypeID)
	createGraphRelationship(t, ctx, ctx.contactID, outsider, forwardTypeID)

	graph, err := ctx.svc.GetVaultGraph(ctx.vaultID, ctx.userID, "en", 0)
	if err != nil {
		t.Fatalf("GetVaultGraph: %v", err)
	}
	if graphContainsNode(asContactGraph(graph), outsider) {
		t.Error("a contact from another vault was drawn on this vault's graph")
	}
	if len(graph.Nodes) != 2 {
		t.Fatalf("nodes = %d, want only the two in-vault contacts", len(graph.Nodes))
	}
	if graph.ExternalRelationships != 1 {
		t.Errorf("external_relationships = %d, want the one relationship leaving the vault", graph.ExternalRelationships)
	}
}

// The limit drops whole clusters rather than cutting one in half, so a family is
// never shown with members missing from the middle of it.
func TestVaultGraphDropsWholeClustersAtTheNodeLimit(t *testing.T) {
	ctx := setupRelationshipTestFull(t)
	thirdContact := createGraphContact(t, ctx, "Third")
	fourthContact := createGraphContact(t, ctx, "Fourth")
	fifthContact := createGraphContact(t, ctx, "Fifth")
	forwardTypeID, _ := createAsymmetricTypePair(t, ctx.db, ctx.accountID)
	// A three-contact cluster and a two-contact one.
	createGraphRelationship(t, ctx, ctx.contactID, ctx.relatedContactID, forwardTypeID)
	createGraphRelationship(t, ctx, ctx.relatedContactID, thirdContact, forwardTypeID)
	createGraphRelationship(t, ctx, fourthContact, fifthContact, forwardTypeID)

	graph, err := ctx.svc.GetVaultGraph(ctx.vaultID, ctx.userID, "en", 4)
	if err != nil {
		t.Fatalf("GetVaultGraph: %v", err)
	}
	if len(graph.Nodes) != 3 {
		t.Fatalf("nodes = %d, want the larger cluster whole and the smaller one dropped", len(graph.Nodes))
	}
	if graph.Components != 1 {
		t.Errorf("components = %d, want 1", graph.Components)
	}
	if !graph.Truncated {
		t.Error("dropping a cluster was not reported as truncation")
	}
	for _, contactID := range []string{ctx.contactID, ctx.relatedContactID, thirdContact} {
		if !graphContainsNode(asContactGraph(graph), contactID) {
			t.Errorf("largest cluster is missing contact %s", contactID)
		}
	}
}

// A cluster bigger than the limit on its own is still returned: an oversized
// drawing is a better answer than an empty one.
func TestVaultGraphKeepsTheLargestClusterEvenWhenItExceedsTheLimit(t *testing.T) {
	ctx := setupRelationshipTestFull(t)
	thirdContact := createGraphContact(t, ctx, "Third")
	forwardTypeID, _ := createAsymmetricTypePair(t, ctx.db, ctx.accountID)
	createGraphRelationship(t, ctx, ctx.contactID, ctx.relatedContactID, forwardTypeID)
	createGraphRelationship(t, ctx, ctx.relatedContactID, thirdContact, forwardTypeID)

	graph, err := ctx.svc.GetVaultGraph(ctx.vaultID, ctx.userID, "en", 1)
	if err != nil {
		t.Fatalf("GetVaultGraph: %v", err)
	}
	if len(graph.Nodes) != 3 {
		t.Fatalf("nodes = %d, want the whole oversized cluster", len(graph.Nodes))
	}
	if graph.Truncated {
		t.Error("nothing was dropped, so the graph should not report truncation")
	}
}

func TestVaultGraphRejectsAVaultTheUserCannotRead(t *testing.T) {
	ctx := setupRelationshipTestFull(t)
	strangerResp, err := NewAuthService(ctx.db, testutil.TestJWTConfig()).Register(dto.RegisterRequest{
		FirstName: "Stranger",
		LastName:  "User",
		Email:     "vault-graph-stranger@example.com",
		Password:  "password123",
	}, "en")
	if err != nil {
		t.Fatalf("Register stranger: %v", err)
	}
	strangerVault, err := NewVaultService(ctx.db).CreateVault(
		strangerResp.User.AccountID,
		strangerResp.User.ID,
		dto.CreateVaultRequest{Name: "Stranger Vault"},
		"en",
	)
	if err != nil {
		t.Fatalf("CreateVault for stranger: %v", err)
	}

	if _, err := ctx.svc.GetVaultGraph(strangerVault.ID, ctx.userID, "en", 0); !errors.Is(err, ErrVaultNotFound) {
		t.Fatalf("GetVaultGraph on another account's vault = %v, want ErrVaultNotFound", err)
	}
}
