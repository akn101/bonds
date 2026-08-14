package handlers

import (
	"errors"
	"strconv"

	"github.com/labstack/echo/v4"
	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/middleware"
	"github.com/naiba/bonds/internal/services"
	"github.com/naiba/bonds/pkg/response"
)

type ContactLayoutHandler struct {
	service *services.ContactLayoutService
}

func NewContactLayoutHandler(service *services.ContactLayoutService) *ContactLayoutHandler {
	return &ContactLayoutHandler{service: service}
}

// Modules godoc
//
//	@Summary		List contact view modules
//	@Description	Return the stable module registry available to contact layouts
//	@Tags			contact-layouts
//	@Produce		json
//	@Security		BearerAuth
//	@Param			vault_id	path		string	true	"Vault ID"
//	@Success		200			{object}	response.APIResponse{data=[]dto.ContactLayoutModuleDefinition}
//	@Router			/vaults/{vault_id}/contact-layout/modules [get]
func (h *ContactLayoutHandler) Modules(c echo.Context) error {
	return response.OK(c, h.service.ModuleDefinitions(middleware.GetLocale(c)))
}

// List godoc
//
//	@Summary		List contact view templates
//	@Description	Return reusable contact view templates owned by this vault
//	@Tags			contact-layouts
//	@Produce		json
//	@Security		BearerAuth
//	@Param			vault_id	path		string	true	"Vault ID"
//	@Success		200			{object}	response.APIResponse{data=[]dto.ContactLayoutTemplateSummary}
//	@Router			/vaults/{vault_id}/contact-layout/templates [get]
func (h *ContactLayoutHandler) List(c echo.Context) error {
	items, err := h.service.List(c.Param("vault_id"), middleware.GetLocale(c))
	if err != nil {
		return contactLayoutError(c, err)
	}
	return response.OK(c, items)
}

// Get godoc
//
//	@Summary		Get a contact view template
//	@Description	Return a complete vault contact layout
//	@Tags			contact-layouts
//	@Produce		json
//	@Security		BearerAuth
//	@Param			vault_id		path		string	true	"Vault ID"
//	@Param			template_id	path		integer	true	"Template ID"
//	@Success		200				{object}	response.APIResponse{data=dto.ContactLayoutResponse}
//	@Router			/vaults/{vault_id}/contact-layout/templates/{template_id} [get]
func (h *ContactLayoutHandler) Get(c echo.Context) error {
	templateID, err := contactLayoutTemplateID(c)
	if err != nil {
		return response.BadRequest(c, "err.invalid_template_id", nil)
	}
	layout, err := h.service.Get(c.Param("vault_id"), templateID, middleware.GetLocale(c))
	if err != nil {
		return contactLayoutError(c, err)
	}
	return response.OK(c, layout)
}

// Create godoc
//
//	@Summary		Create a contact view template
//	@Description	Clone a vault template into a new reusable contact view
//	@Tags			contact-layouts
//	@Accept			json
//	@Produce		json
//	@Security		BearerAuth
//	@Param			vault_id	path		string	true	"Vault ID"
//	@Param			request		body		dto.CreateContactLayoutTemplateRequest	true	"Template details"
//	@Success		201			{object}	response.APIResponse{data=dto.ContactLayoutResponse}
//	@Router			/vaults/{vault_id}/contact-layout/templates [post]
func (h *ContactLayoutHandler) Create(c echo.Context) error {
	var req dto.CreateContactLayoutTemplateRequest
	if err := c.Bind(&req); err != nil {
		return response.BadRequest(c, "err.invalid_request_body", nil)
	}
	if err := validateRequest(req); err != nil {
		return response.ValidationError(c, map[string]string{"validation": err.Error()})
	}
	layout, err := h.service.Create(c.Param("vault_id"), middleware.GetLocale(c), req)
	if err != nil {
		return contactLayoutError(c, err)
	}
	return response.Created(c, layout)
}

// Rename godoc
//
//	@Summary		Rename a contact view template
//	@Tags			contact-layouts
//	@Accept			json
//	@Produce		json
//	@Security		BearerAuth
//	@Param			vault_id		path		string	true	"Vault ID"
//	@Param			template_id	path		integer	true	"Template ID"
//	@Param			request			body		dto.UpdateContactLayoutTemplateRequest	true	"Template details"
//	@Success		200				{object}	response.APIResponse{data=dto.ContactLayoutResponse}
//	@Router			/vaults/{vault_id}/contact-layout/templates/{template_id} [put]
func (h *ContactLayoutHandler) Rename(c echo.Context) error {
	templateID, err := contactLayoutTemplateID(c)
	if err != nil {
		return response.BadRequest(c, "err.invalid_template_id", nil)
	}
	var req dto.UpdateContactLayoutTemplateRequest
	if err := c.Bind(&req); err != nil {
		return response.BadRequest(c, "err.invalid_request_body", nil)
	}
	if err := validateRequest(req); err != nil {
		return response.ValidationError(c, map[string]string{"validation": err.Error()})
	}
	layout, err := h.service.Rename(c.Param("vault_id"), templateID, req, middleware.GetLocale(c))
	if err != nil {
		return contactLayoutError(c, err)
	}
	return response.OK(c, layout)
}

// Save godoc
//
//	@Summary		Save a contact view layout
//	@Description	Atomically replace page and module placement using optimistic revision control
//	@Tags			contact-layouts
//	@Accept			json
//	@Produce		json
//	@Security		BearerAuth
//	@Param			vault_id		path		string	true	"Vault ID"
//	@Param			template_id	path		integer	true	"Template ID"
//	@Param			request			body		dto.SaveContactLayoutRequest	true	"Complete layout"
//	@Success		200				{object}	response.APIResponse{data=dto.ContactLayoutResponse}
//	@Failure		409				{object}	response.APIResponse
//	@Router			/vaults/{vault_id}/contact-layout/templates/{template_id}/layout [put]
func (h *ContactLayoutHandler) Save(c echo.Context) error {
	templateID, err := contactLayoutTemplateID(c)
	if err != nil {
		return response.BadRequest(c, "err.invalid_template_id", nil)
	}
	var req dto.SaveContactLayoutRequest
	if err := c.Bind(&req); err != nil {
		return response.BadRequest(c, "err.invalid_request_body", nil)
	}
	if err := validateRequest(req); err != nil {
		return response.ValidationError(c, map[string]string{"validation": err.Error()})
	}
	layout, err := h.service.Save(c.Param("vault_id"), templateID, req, middleware.GetLocale(c))
	if err != nil {
		return contactLayoutError(c, err)
	}
	return response.OK(c, layout)
}

// SetDefault godoc
//
//	@Summary		Set the vault default contact view
//	@Tags			contact-layouts
//	@Security		BearerAuth
//	@Param			vault_id		path	string	true	"Vault ID"
//	@Param			template_id	path	integer	true	"Template ID"
//	@Success		204
//	@Router			/vaults/{vault_id}/contact-layout/templates/{template_id}/default [put]
func (h *ContactLayoutHandler) SetDefault(c echo.Context) error {
	templateID, err := contactLayoutTemplateID(c)
	if err != nil {
		return response.BadRequest(c, "err.invalid_template_id", nil)
	}
	if err := h.service.SetDefault(c.Param("vault_id"), templateID); err != nil {
		return contactLayoutError(c, err)
	}
	return response.NoContent(c)
}

// Delete godoc
//
//	@Summary		Delete a contact view template
//	@Tags			contact-layouts
//	@Security		BearerAuth
//	@Param			vault_id		path	string	true	"Vault ID"
//	@Param			template_id	path	integer	true	"Template ID"
//	@Success		204
//	@Router			/vaults/{vault_id}/contact-layout/templates/{template_id} [delete]
func (h *ContactLayoutHandler) Delete(c echo.Context) error {
	templateID, err := contactLayoutTemplateID(c)
	if err != nil {
		return response.BadRequest(c, "err.invalid_template_id", nil)
	}
	if err := h.service.Delete(c.Param("vault_id"), templateID); err != nil {
		return contactLayoutError(c, err)
	}
	return response.NoContent(c)
}

func contactLayoutTemplateID(c echo.Context) (uint, error) {
	id, err := strconv.ParseUint(c.Param("template_id"), 10, 64)
	return uint(id), err
}

func contactLayoutError(c echo.Context, err error) error {
	switch {
	case errors.Is(err, services.ErrContactLayoutNotFound), errors.Is(err, services.ErrVaultNotFound):
		return response.NotFound(c, "err.contact_layout_not_found")
	case errors.Is(err, services.ErrContactLayoutConflict):
		return response.Conflict(c, "err.contact_layout_conflict")
	case errors.Is(err, services.ErrContactLayoutInvalid):
		return response.BadRequest(c, "err.invalid_contact_layout", nil)
	case errors.Is(err, services.ErrContactLayoutInUse):
		return response.BadRequest(c, "err.contact_layout_in_use", nil)
	case errors.Is(err, services.ErrContactLayoutIsDefault):
		return response.BadRequest(c, "err.contact_layout_is_default", nil)
	case errors.Is(err, services.ErrContactLayoutNameExists):
		return response.BadRequest(c, "err.contact_layout_name_exists", nil)
	default:
		return response.InternalError(c, "err.failed_to_update_contact_layout")
	}
}
