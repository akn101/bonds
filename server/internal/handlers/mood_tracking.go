package handlers

import (
	"errors"

	"github.com/labstack/echo/v4"
	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/middleware"
	"github.com/naiba/bonds/internal/services"
	"github.com/naiba/bonds/pkg/response"
)

type MoodTrackingHandler struct {
	moodTrackingService *services.MoodTrackingService
}

func NewMoodTrackingHandler(moodTrackingService *services.MoodTrackingService) *MoodTrackingHandler {
	return &MoodTrackingHandler{moodTrackingService: moodTrackingService}
}

// Create godoc
//
//	@Summary		Create a mood tracking event
//	@Description	Record a new mood tracking event for the current user in a vault
//	@Tags			mood-tracking
//	@Accept			json
//	@Produce		json
//	@Security		BearerAuth
//	@Param			vault_id	path		string									true	"Vault ID"
//	@Param			request		body		dto.CreateMoodTrackingEventRequest		true	"Mood tracking event details"
//	@Success		201			{object}	response.APIResponse{data=dto.MoodTrackingEventResponse}
//	@Failure		400			{object}	response.APIResponse
//	@Failure		401			{object}	response.APIResponse
//	@Failure		404			{object}	response.APIResponse
//	@Failure		500			{object}	response.APIResponse
//	@Router			/vaults/{vault_id}/moodTrackingEvents [post]
func (h *MoodTrackingHandler) Create(c echo.Context) error {
	vaultID := c.Param("vault_id")
	userID := middleware.GetUserID(c)
	var req dto.CreateMoodTrackingEventRequest
	if err := c.Bind(&req); err != nil {
		return response.BadRequest(c, "err.invalid_request_body", nil)
	}
	event, err := h.moodTrackingService.Create(vaultID, userID, req)
	if err != nil {
		if errors.Is(err, services.ErrMoodParamNotFound) {
			return response.NotFound(c, "err.mood_tracking_parameter_not_found")
		}
		return response.InternalError(c, "err.failed_to_create_mood_tracking_event")
	}
	return response.Created(c, event)
}

// List godoc
//
//	@Summary		List mood tracking events
//	@Description	Return mood tracking events for the current user in a vault
//	@Tags			mood-tracking
//	@Produce		json
//	@Security		BearerAuth
//	@Param			vault_id	path		string	true	"Vault ID"
//	@Success		200			{object}	response.APIResponse{data=[]dto.MoodTrackingEventResponse}
//	@Failure		401			{object}	response.APIResponse
//	@Failure		404			{object}	response.APIResponse
//	@Failure		500			{object}	response.APIResponse
//	@Router			/vaults/{vault_id}/moodTrackingEvents [get]
func (h *MoodTrackingHandler) List(c echo.Context) error {
	vaultID := c.Param("vault_id")
	userID := middleware.GetUserID(c)
	events, err := h.moodTrackingService.List(vaultID, userID)
	if err != nil {
		return response.InternalError(c, "err.failed_to_list_mood_tracking_events")
	}
	return response.OK(c, events)
}
