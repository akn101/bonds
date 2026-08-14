package dto

type ContactLayoutModuleDefinition struct {
	Key  string `json:"key" example:"relationships"`
	Name string `json:"name" example:"Relationships"`
}

type ContactLayoutTemplateSummary struct {
	ID           uint   `json:"id" example:"1"`
	VaultID      string `json:"vault_id" example:"550e8400-e29b-41d4-a716-446655440000"`
	Name         string `json:"name" example:"Default template"`
	Revision     uint   `json:"revision" example:"3"`
	CanBeDeleted bool   `json:"can_be_deleted" example:"true"`
	IsDefault    bool   `json:"is_default" example:"true"`
	ContactCount int64  `json:"contact_count" example:"12"`
}

type ContactLayoutModule struct {
	ID       uint   `json:"id" example:"1"`
	Key      string `json:"key" example:"relationships"`
	Name     string `json:"name" example:"Relationships"`
	Position int    `json:"position" example:"0"`
}

type ContactLayoutPage struct {
	ID       uint                  `json:"id" example:"1"`
	Name     string                `json:"name" example:"Social"`
	Slug     string                `json:"slug" example:"social"`
	Position int                   `json:"position" example:"0"`
	Type     string                `json:"type" example:"contact"`
	Visible  bool                  `json:"visible" example:"true"`
	Modules  []ContactLayoutModule `json:"modules"`
}

type ContactLayoutResponse struct {
	ContactLayoutTemplateSummary
	Pages []ContactLayoutPage `json:"pages"`
}

type CreateContactLayoutTemplateRequest struct {
	Name             string `json:"name" validate:"required,min=1,max=100" example:"Family view"`
	SourceTemplateID *uint  `json:"source_template_id" example:"1"`
}

type UpdateContactLayoutTemplateRequest struct {
	Name string `json:"name" validate:"required,min=1,max=100" example:"Family view"`
}

type SaveContactLayoutModuleRequest struct {
	Key string `json:"key" validate:"required,max=96" example:"relationships"`
}

type SaveContactLayoutPageRequest struct {
	ID      *uint                            `json:"id" example:"1"`
	Name    string                           `json:"name" validate:"required,min=1,max=100" example:"Social"`
	Slug    string                           `json:"slug" validate:"required,min=1,max=96" example:"social"`
	Type    string                           `json:"type" validate:"max=32" example:"contact"`
	Visible bool                             `json:"visible" example:"true"`
	Modules []SaveContactLayoutModuleRequest `json:"modules" validate:"max=64,dive"`
}

type SaveContactLayoutRequest struct {
	ExpectedRevision uint                           `json:"expected_revision" validate:"required" example:"3"`
	Pages            []SaveContactLayoutPageRequest `json:"pages" validate:"required,min=1,max=20,dive"`
}
