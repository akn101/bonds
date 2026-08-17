package dto

import "time"

type CreateRelationshipRequest struct {
	RelationshipTypeID  uint   `json:"relationship_type_id" validate:"required" example:"1"`
	RelatedContactID    string `json:"related_contact_id" example:"550e8400-e29b-41d4-a716-446655440000"`
	ExternalContactName string `json:"external_contact_name" example:"Aunt Mary"`
}

type UpdateRelationshipRequest struct {
	RelationshipTypeID uint   `json:"relationship_type_id" validate:"required" example:"1"`
	RelatedContactID   string `json:"related_contact_id" validate:"required" example:"550e8400-e29b-41d4-a716-446655440000"`
}

type RelationshipResponse struct {
	ID                   uint      `json:"id" example:"1"`
	ContactID            string    `json:"contact_id" example:"550e8400-e29b-41d4-a716-446655440000"`
	RelatedContactID     string    `json:"related_contact_id" example:"550e8400-e29b-41d4-a716-446655440000"`
	RelationshipTypeID   uint      `json:"relationship_type_id" example:"1"`
	RelationshipTypeName string    `json:"relationship_type_name" example:"Parent"`
	RelatedContactName   string    `json:"related_contact_name" example:"Jane Doe"`
	RelatedVaultID       string    `json:"related_vault_id" example:"550e8400-e29b-41d4-a716-446655440000"`
	RelatedVaultName     string    `json:"related_vault_name" example:"Family"`
	CreatedAt            time.Time `json:"created_at" example:"2026-01-15T10:30:00Z"`
	UpdatedAt            time.Time `json:"updated_at" example:"2026-01-15T10:30:00Z"`
}

type GraphNode struct {
	ID       string `json:"id" example:"550e8400-e29b-41d4-a716-446655440000"`
	Label    string `json:"label" example:"Alice Smith"`
	IsCenter bool   `json:"is_center" example:"true"`
}

type GraphEdge struct {
	Source    string          `json:"source" example:"550e8400-e29b-41d4-a716-446655440000"`
	Target    string          `json:"target" example:"660e8400-e29b-41d4-a716-446655440001"`
	Type      string          `json:"type" example:"Parent"`
	Inferred  bool            `json:"inferred" example:"false"`
	Relations []GraphRelation `json:"relations"`
}

// GraphRelation describes one relationship carried by a visual edge. The
// labels are stored from both endpoint perspectives so reciprocal database
// rows (for example Parent/Child) can be rendered as one non-overlapping edge.
type GraphRelation struct {
	SourceKind  string `json:"source_kind" example:"parent"`
	TargetKind  string `json:"target_kind" example:"child"`
	SourceLabel string `json:"source_label" example:"Parent"`
	TargetLabel string `json:"target_label" example:"Child"`
	Inferred    bool   `json:"inferred" example:"false"`
	Generations int    `json:"generations,omitempty" example:"2"`
}

type ContactGraphResponse struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

// VaultGraphResponse is the whole-vault graph. The counts alongside the graph
// describe what was left out of it, so the page can account for the difference
// between the vault and the drawing.
type VaultGraphResponse struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
	// Components is the number of separate clusters drawn.
	Components int `json:"components" example:"3"`
	// IsolatedContacts counts contacts in the vault with no relationship to
	// another contact in the same vault; they are not drawn.
	IsolatedContacts int `json:"isolated_contacts" example:"12"`
	// ExternalRelationships counts relationships from a contact in this vault
	// to a readable contact outside it; they are not drawn.
	ExternalRelationships int `json:"external_relationships" example:"4"`
	// Truncated reports that whole components were dropped to stay within the
	// node limit.
	Truncated bool `json:"truncated" example:"false"`
}

type KinshipResponse struct {
	Degree *int     `json:"degree" example:"2"`
	Path   []string `json:"path" example:"id1,id2,id3"`
}

// CrossVaultContactItem represents a contact candidate for cross-vault relationship selection.
// Includes vault info and whether the current user has Editor permission on that vault.
type CrossVaultContactItem struct {
	ContactID   string `json:"contact_id" example:"550e8400-e29b-41d4-a716-446655440000"`
	ContactName string `json:"contact_name" example:"Jane Doe"`
	VaultID     string `json:"vault_id" example:"550e8400-e29b-41d4-a716-446655440000"`
	VaultName   string `json:"vault_name" example:"Family"`
	HasEditor   bool   `json:"has_editor" example:"true"`
}
