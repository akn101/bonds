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

type LifeEventHandler struct{ lifeEventService *services.LifeEventService }

func NewLifeEventHandler(service *services.LifeEventService) *LifeEventHandler {
	return &LifeEventHandler{lifeEventService: service}
}

// List godoc
//
//	@Summary List life events
//	@Tags life-events
//	@Produce json
//	@Security BearerAuth
//	@Param vault_id path string true "Vault ID"
//	@Param contact_id query string false "Contact ID"
//	@Param page query integer false "Page"
//	@Param per_page query integer false "Items per page"
//	@Success 200 {object} response.APIResponse{data=[]dto.LifeEventResponse}
//	@Router /vaults/{vault_id}/lifeEvents [get]
func (h *LifeEventHandler) List(c echo.Context) error {
	page, _ := strconv.Atoi(c.QueryParam("page"))
	perPage, _ := strconv.Atoi(c.QueryParam("per_page"))
	items, meta, err := h.lifeEventService.ListForUser(c.Param("vault_id"), middleware.GetUserID(c), c.QueryParam("contact_id"), page, perPage)
	if err != nil {
		if errors.Is(err, services.ErrContactNotFound) {
			return response.NotFound(c, "err.contact_not_found")
		}
		return response.InternalError(c, "err.failed_to_list_life_events")
	}
	return response.Paginated(c, items, meta)
}

// Create godoc
//
//	@Summary Create a life event
//	@Tags life-events
//	@Accept json
//	@Produce json
//	@Security BearerAuth
//	@Param vault_id path string true "Vault ID"
//	@Param request body dto.LifeEventUpsertRequest true "Life event"
//	@Success 201 {object} response.APIResponse{data=dto.LifeEventResponse}
//	@Router /vaults/{vault_id}/lifeEvents [post]
func (h *LifeEventHandler) Create(c echo.Context) error {
	var req dto.LifeEventUpsertRequest
	if err := c.Bind(&req); err != nil {
		return response.BadRequest(c, "err.invalid_request_body", nil)
	}
	item, err := h.lifeEventService.CreateForUser(c.Param("vault_id"), middleware.GetUserID(c), req)
	if err != nil {
		return lifeEventError(c, err, "err.failed_to_create_life_event")
	}
	return response.Created(c, item)
}

// Update godoc
//
//	@Summary Update a life event
//	@Tags life-events
//	@Accept json
//	@Produce json
//	@Security BearerAuth
//	@Param vault_id path string true "Vault ID"
//	@Param id path integer true "Life event ID"
//	@Param request body dto.LifeEventUpsertRequest true "Life event"
//	@Success 200 {object} response.APIResponse{data=dto.LifeEventResponse}
//	@Router /vaults/{vault_id}/lifeEvents/{id} [put]
func (h *LifeEventHandler) Update(c echo.Context) error {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		return response.BadRequest(c, "err.invalid_life_event_id", nil)
	}
	var req dto.LifeEventUpsertRequest
	if err := c.Bind(&req); err != nil {
		return response.BadRequest(c, "err.invalid_request_body", nil)
	}
	item, err := h.lifeEventService.UpdateForUser(c.Param("vault_id"), middleware.GetUserID(c), uint(id), req)
	if err != nil {
		return lifeEventError(c, err, "err.failed_to_update_life_event")
	}
	return response.OK(c, item)
}

// Delete godoc
//
//	@Summary Delete a life event
//	@Tags life-events
//	@Produce json
//	@Security BearerAuth
//	@Param vault_id path string true "Vault ID"
//	@Param id path integer true "Life event ID"
//	@Success 204
//	@Router /vaults/{vault_id}/lifeEvents/{id} [delete]
func (h *LifeEventHandler) Delete(c echo.Context) error {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		return response.BadRequest(c, "err.invalid_life_event_id", nil)
	}
	if err := h.lifeEventService.Delete(c.Param("vault_id"), uint(id)); err != nil {
		return lifeEventError(c, err, "err.failed_to_delete_life_event")
	}
	return response.NoContent(c)
}

func lifeEventError(c echo.Context, err error, fallback string) error {
	switch {
	case errors.Is(err, services.ErrLifeEventNotFound):
		return response.NotFound(c, "err.life_event_not_found")
	case errors.Is(err, services.ErrContactNotFound):
		return response.NotFound(c, "err.contact_not_found")
	case errors.Is(err, services.ErrInvalidLifeEventTime):
		return response.BadRequest(c, "err.invalid_life_event_time", nil)
	case errors.Is(err, services.ErrInvalidLifeEventInput):
		return response.BadRequest(c, "err.invalid_request_body", nil)
	default:
		return response.InternalError(c, fallback)
	}
}
