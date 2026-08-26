package handlers

import (
	"errors"
	"strconv"

	"github.com/labstack/echo/v5"
	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/services"
	"github.com/naiba/bonds/pkg/response"
)

// @Summary		Add members to group
// @Description	Add multiple contacts to a group atomically
// @Tags			groups
// @Accept			json
// @Produce		json
// @Security		BearerAuth
// @Param			vault_id	path	string					true	"Vault ID"
// @Param			id			path	integer					true	"Group ID"
// @Param			request		body	dto.GroupMembersRequest	true	"Group members request"
// @Success		200			{object}	response.APIResponse{data=dto.GroupMembersResponse}
// @Failure		400			{object}	response.APIResponse
// @Failure		404			{object}	response.APIResponse
// @Failure		500			{object}	response.APIResponse
// @Router			/vaults/{vault_id}/groups/{id}/members [post]
func (h *GroupHandler) AddMembers(c *echo.Context) error {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		return response.BadRequest(c, "err.invalid_group_id", nil)
	}
	var req dto.GroupMembersRequest
	if err := c.Bind(&req); err != nil {
		return response.BadRequest(c, "err.invalid_request_body", nil)
	}
	affectedCount, err := h.groupService.AddMembers(uint(id), c.Param("vault_id"), req)
	if err != nil {
		if errors.Is(err, services.ErrGroupNotFound) {
			return response.NotFound(c, "err.group_not_found")
		}
		if errors.Is(err, services.ErrContactNotFound) {
			return response.NotFound(c, "err.contact_not_found")
		}
		if errors.Is(err, services.ErrGroupMembersEmpty) ||
			errors.Is(err, services.ErrGroupMembersLimitExceeded) ||
			errors.Is(err, services.ErrContactIDInvalid) ||
			errors.Is(err, services.ErrContactIDsLimitExceeded) {
			return response.BadRequest(c, "err.invalid_request_body", nil)
		}
		return response.InternalError(c, "err.failed_to_add_contact_to_group")
	}
	return response.OK(c, dto.GroupMembersResponse{AffectedCount: affectedCount})
}

// @Summary		Remove members from group
// @Description	Remove multiple contacts from a group atomically
// @Tags			groups
// @Accept			json
// @Produce		json
// @Security		BearerAuth
// @Param			vault_id	path	string					true	"Vault ID"
// @Param			id			path	integer					true	"Group ID"
// @Param			request		body	dto.GroupMembersRequest	true	"Group members request"
// @Success		200			{object}	response.APIResponse{data=dto.GroupMembersResponse}
// @Failure		400			{object}	response.APIResponse
// @Failure		404			{object}	response.APIResponse
// @Failure		500			{object}	response.APIResponse
// @Router			/vaults/{vault_id}/groups/{id}/members [delete]
func (h *GroupHandler) RemoveMembers(c *echo.Context) error {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		return response.BadRequest(c, "err.invalid_group_id", nil)
	}
	var req dto.GroupMembersRequest
	if err := c.Bind(&req); err != nil {
		return response.BadRequest(c, "err.invalid_request_body", nil)
	}
	affectedCount, err := h.groupService.RemoveMembers(uint(id), c.Param("vault_id"), req)
	if err != nil {
		if errors.Is(err, services.ErrGroupNotFound) {
			return response.NotFound(c, "err.group_not_found")
		}
		if errors.Is(err, services.ErrContactNotFound) {
			return response.NotFound(c, "err.contact_not_found")
		}
		if errors.Is(err, services.ErrGroupMembersEmpty) ||
			errors.Is(err, services.ErrGroupMembersLimitExceeded) ||
			errors.Is(err, services.ErrContactIDInvalid) ||
			errors.Is(err, services.ErrContactIDsLimitExceeded) {
			return response.BadRequest(c, "err.invalid_request_body", nil)
		}
		return response.InternalError(c, "err.failed_to_remove_contact_from_group")
	}
	return response.OK(c, dto.GroupMembersResponse{AffectedCount: affectedCount})
}
