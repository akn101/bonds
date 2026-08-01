package dto

import "time"

type FeedItemResponse struct {
	ID              uint                `json:"id" example:"1"`
	ContactID       string              `json:"contact_id" example:"550e8400-e29b-41d4-a716-446655440000"`
	ContactName     string              `json:"contact_name" example:"John Doe"`
	ContactLinkable bool                `json:"contact_linkable"`
	AuthorID        string              `json:"author_id" example:"550e8400-e29b-41d4-a716-446655440000"`
	Action          string              `json:"action" example:"contact_created"`
	Description     string              `json:"description" example:"Contact John Doe was created"`
	Source          *FeedSourceResponse `json:"source,omitempty"`
	CreatedAt       time.Time           `json:"created_at" example:"2026-01-15T10:30:00Z"`
}

type FeedSourceResponse struct {
	Kind      string `json:"kind" example:"Note"`
	ID        uint   `json:"id" example:"1"`
	Available bool   `json:"available"`
	Module    string `json:"module,omitempty" example:"notes"`
}
