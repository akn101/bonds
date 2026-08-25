package handlers

import (
	"errors"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/middleware"
	"github.com/naiba/bonds/internal/services"
	"github.com/naiba/bonds/pkg/response"
)

type RelationshipHandler struct {
	relationshipService *services.RelationshipService
}

func NewRelationshipHandler(relationshipService *services.RelationshipService) *RelationshipHandler {
	return &RelationshipHandler{relationshipService: relationshipService}
}

// List godoc
//
//	@Summary		List relationships for a contact
//	@Description	Return all relationships belonging to a contact
//	@Tags			relationships
//	@Produce		json
//	@Security		BearerAuth
//	@Param			vault_id	path		string	true	"Vault ID"
//	@Param			contact_id	path		string	true	"Contact ID"
//	@Success		200			{object}	response.APIResponse{data=[]dto.RelationshipResponse}
//	@Failure		401			{object}	response.APIResponse
//	@Failure		404			{object}	response.APIResponse
//	@Failure		500			{object}	response.APIResponse
//	@Router			/vaults/{vault_id}/contacts/{contact_id}/relationships [get]
func (h *RelationshipHandler) List(c echo.Context) error {
	contactID := c.Param("contact_id")
	vaultID := c.Param("vault_id")
	userID := middleware.GetUserID(c)
	relationships, err := h.relationshipService.List(contactID, vaultID, userID)
	if err != nil {
		if errors.Is(err, services.ErrContactNotFound) {
			return response.NotFound(c, "err.contact_not_found")
		}
		return response.InternalError(c, "err.failed_to_list_relationships")
	}
	return response.OK(c, relationships)
}

// Create godoc
//
//	@Summary		Create a relationship
//	@Description	Create a new relationship for a contact
//	@Tags			relationships
//	@Accept			json
//	@Produce		json
//	@Security		BearerAuth
//	@Param			vault_id	path		string							true	"Vault ID"
//	@Param			contact_id	path		string							true	"Contact ID"
//	@Param			request		body		dto.CreateRelationshipRequest	true	"Relationship details"
//	@Success		201			{object}	response.APIResponse{data=dto.RelationshipResponse}
//	@Failure		400			{object}	response.APIResponse
//	@Failure		401			{object}	response.APIResponse
//	@Failure		404			{object}	response.APIResponse
//	@Failure		422			{object}	response.APIResponse
//	@Failure		500			{object}	response.APIResponse
//	@Router			/vaults/{vault_id}/contacts/{contact_id}/relationships [post]
func (h *RelationshipHandler) Create(c echo.Context) error {
	contactID := c.Param("contact_id")
	vaultID := c.Param("vault_id")
	userID := middleware.GetUserID(c)

	var req dto.CreateRelationshipRequest
	if err := c.Bind(&req); err != nil {
		return response.BadRequest(c, "err.invalid_request_body", nil)
	}
	if err := validateRequest(req); err != nil {
		return response.ValidationError(c, map[string]string{"validation": err.Error()})
	}

	relationship, err := h.relationshipService.Create(contactID, vaultID, userID, req)
	if err != nil {
		if errors.Is(err, services.ErrRelationshipRelatedContactInvalid) {
			return response.ValidationError(c, map[string]string{"related_contact_id": err.Error()})
		}
		if errors.Is(err, services.ErrContactNotFound) {
			return response.NotFound(c, "err.contact_not_found")
		}
		return response.InternalError(c, "err.failed_to_create_relationship")
	}
	return response.Created(c, relationship)
}

// Update godoc
//
//	@Summary		Update a relationship
//	@Description	Update an existing relationship
//	@Tags			relationships
//	@Accept			json
//	@Produce		json
//	@Security		BearerAuth
//	@Param			vault_id	path		string							true	"Vault ID"
//	@Param			contact_id	path		string							true	"Contact ID"
//	@Param			id			path		integer							true	"Relationship ID"
//	@Param			request		body		dto.UpdateRelationshipRequest	true	"Relationship details"
//	@Success		200			{object}	response.APIResponse{data=dto.RelationshipResponse}
//	@Failure		400			{object}	response.APIResponse
//	@Failure		401			{object}	response.APIResponse
//	@Failure		404			{object}	response.APIResponse
//	@Failure		422			{object}	response.APIResponse
//	@Failure		500			{object}	response.APIResponse
//	@Router			/vaults/{vault_id}/contacts/{contact_id}/relationships/{id} [put]
func (h *RelationshipHandler) Update(c echo.Context) error {
	contactID := c.Param("contact_id")
	vaultID := c.Param("vault_id")
	userID := middleware.GetUserID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		return response.BadRequest(c, "err.invalid_relationship_id", nil)
	}

	var req dto.UpdateRelationshipRequest
	if err := c.Bind(&req); err != nil {
		return response.BadRequest(c, "err.invalid_request_body", nil)
	}
	if err := validateRequest(req); err != nil {
		return response.ValidationError(c, map[string]string{"validation": err.Error()})
	}

	relationship, err := h.relationshipService.Update(uint(id), contactID, vaultID, req, userID)
	if err != nil {
		if errors.Is(err, services.ErrContactNotFound) {
			return response.NotFound(c, "err.contact_not_found")
		}
		if errors.Is(err, services.ErrRelationshipNotFound) {
			return response.NotFound(c, "err.relationship_not_found")
		}
		return response.InternalError(c, "err.failed_to_update_relationship")
	}
	return response.OK(c, relationship)
}

// Delete godoc
//
//	@Summary		Delete a relationship
//	@Description	Delete a relationship from a contact
//	@Tags			relationships
//	@Produce		json
//	@Security		BearerAuth
//	@Param			vault_id	path		string	true	"Vault ID"
//	@Param			contact_id	path		string	true	"Contact ID"
//	@Param			id			path		integer	true	"Relationship ID"
//	@Success		204			{object}	nil
//	@Failure		400			{object}	response.APIResponse
//	@Failure		401			{object}	response.APIResponse
//	@Failure		404			{object}	response.APIResponse
//	@Failure		500			{object}	response.APIResponse
//	@Router			/vaults/{vault_id}/contacts/{contact_id}/relationships/{id} [delete]
func (h *RelationshipHandler) Delete(c echo.Context) error {
	contactID := c.Param("contact_id")
	vaultID := c.Param("vault_id")
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		return response.BadRequest(c, "err.invalid_relationship_id", nil)
	}

	if err := h.relationshipService.Delete(uint(id), contactID, vaultID); err != nil {
		if errors.Is(err, services.ErrContactNotFound) {
			return response.NotFound(c, "err.contact_not_found")
		}
		if errors.Is(err, services.ErrRelationshipNotFound) {
			return response.NotFound(c, "err.relationship_not_found")
		}
		return response.InternalError(c, "err.failed_to_delete_relationship")
	}
	return response.NoContent(c)
}

// GetContactGraph godoc
//
//	@Summary		Get contact relationship graph
//	@Description	Return the complete accessible relationship component, with reciprocal rows collapsed and family relationships inferred
//	@Tags			relationships
//	@Accept			json
//	@Produce		json
//	@Security		BearerAuth
//	@Param			vault_id	path		string	true	"Vault ID"
//	@Param			contact_id	path		string	true	"Contact ID"
//	@Success		200			{object}	response.APIResponse{data=dto.ContactGraphResponse}
//	@Failure		401			{object}	response.APIResponse
//	@Failure		404			{object}	response.APIResponse
//	@Failure		500			{object}	response.APIResponse
//	@Router			/vaults/{vault_id}/contacts/{contact_id}/relationships/graph [get]
func (h *RelationshipHandler) GetContactGraph(c echo.Context) error {
	contactID := c.Param("contact_id")
	vaultID := c.Param("vault_id")
	userID := middleware.GetUserID(c)
	graph, err := h.relationshipService.GetContactGraph(contactID, vaultID, userID, middleware.GetLocale(c))
	if err != nil {
		if errors.Is(err, services.ErrContactNotFound) {
			return response.NotFound(c, "err.contact_not_found")
		}
		return response.InternalError(c, "err.failed_to_get_graph")
	}
	return response.OK(c, graph)
}

// vaultGraphFilterFromQuery reads the facet selections off the query string.
// Each facet may be repeated (?label=1&label=2) or comma-separated
// (?label=1,2); both are accepted because these URLs get written by hand as
// often as they get built.
func vaultGraphFilterFromQuery(c echo.Context) services.VaultGraphFilter {
	params := c.QueryParams()
	filter := services.VaultGraphFilter{}
	for _, key := range services.VaultGraphFacetKeys() {
		values := make([]string, 0, len(params[key]))
		for _, raw := range params[key] {
			for _, value := range strings.Split(raw, ",") {
				if trimmed := strings.TrimSpace(value); trimmed != "" {
					values = append(values, trimmed)
				}
			}
		}
		if len(values) > 0 {
			filter[key] = values
		}
	}
	return filter
}

// GetVaultGraph godoc
//
//	@Summary		Get vault relationship graph
//	@Description	Return the relationship graph of a whole vault, with reciprocal rows collapsed and family relationships inferred. Contacts unrelated to anyone else in the vault, and relationships pointing outside it, are counted rather than drawn.
//	@Tags			relationships
//	@Accept			json
//	@Produce		json
//	@Security		BearerAuth
//	@Param			vault_id	path		string	true	"Vault ID"
//	@Param			limit		query		integer	false	"Maximum nodes to draw (default 1000)"
//	@Param			gender		query		[]string	false	"Only draw contacts with one of these gender ids"	collectionFormat(multi)
//	@Param			pronoun		query		[]string	false	"Only draw contacts with one of these pronoun ids"	collectionFormat(multi)
//	@Param			religion	query		[]string	false	"Only draw contacts with one of these religion ids"	collectionFormat(multi)
//	@Param			company		query		[]string	false	"Only draw contacts with one of these company ids"	collectionFormat(multi)
//	@Param			label		query		[]string	false	"Only draw contacts carrying one of these label ids"	collectionFormat(multi)
//	@Param			group		query		[]string	false	"Only draw contacts belonging to one of these group ids"	collectionFormat(multi)
//	@Success		200			{object}	response.APIResponse{data=dto.VaultGraphResponse}
//	@Failure		401			{object}	response.APIResponse
//	@Failure		404			{object}	response.APIResponse
//	@Failure		500			{object}	response.APIResponse
//	@Router			/vaults/{vault_id}/relationships/graph [get]
func (h *RelationshipHandler) GetVaultGraph(c echo.Context) error {
	vaultID := c.Param("vault_id")
	userID := middleware.GetUserID(c)
	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	graph, err := h.relationshipService.GetVaultGraph(vaultID, userID, middleware.GetLocale(c), limit, vaultGraphFilterFromQuery(c))
	if err != nil {
		if errors.Is(err, services.ErrVaultNotFound) {
			return response.NotFound(c, "err.vault_not_found")
		}
		return response.InternalError(c, "err.failed_to_get_graph")
	}
	return response.OK(c, graph)
}

// CalculateKinship godoc
//
//	@Summary		Calculate kinship degree between two contacts
//	@Description	Compute the shortest kinship path between two contacts using Dijkstra's algorithm
//	@Tags			relationships
//	@Accept			json
//	@Produce		json
//	@Security		BearerAuth
//	@Param			vault_id			path		string	true	"Vault ID"
//	@Param			contact_id			path		string	true	"Contact ID"
//	@Param			related_contact_id	path		string	true	"Related Contact ID"
//	@Success		200					{object}	response.APIResponse{data=dto.KinshipResponse}
//	@Failure		401					{object}	response.APIResponse
//	@Failure		404					{object}	response.APIResponse
//	@Failure		500					{object}	response.APIResponse
//	@Router			/vaults/{vault_id}/contacts/{contact_id}/relationships/kinship/{related_contact_id} [get]
func (h *RelationshipHandler) CalculateKinship(c echo.Context) error {
	contactID := c.Param("contact_id")
	vaultID := c.Param("vault_id")
	userID := middleware.GetUserID(c)
	relatedContactID := c.Param("related_contact_id")
	kinship, err := h.relationshipService.CalculateKinship(contactID, relatedContactID, vaultID, userID)
	if err != nil {
		if errors.Is(err, services.ErrContactNotFound) {
			return response.NotFound(c, "err.contact_not_found")
		}
		return response.InternalError(c, "err.failed_to_calculate_kinship")
	}
	return response.OK(c, kinship)
}

// ListContactsAcrossVaults godoc
//
//	@Summary		List contacts across all accessible vaults
//	@Description	Return all contacts the user can see, grouped by vault with Editor permission flags.
//	@Description	Used by the relationship selector to support cross-vault relationship creation.
//	@Tags			relationships
//	@Produce		json
//	@Security		BearerAuth
//	@Success		200	{object}	response.APIResponse{data=[]dto.CrossVaultContactItem}
//	@Failure		401	{object}	response.APIResponse
//	@Failure		500	{object}	response.APIResponse
//	@Router			/relationships/contacts [get]
func (h *RelationshipHandler) ListContactsAcrossVaults(c echo.Context) error {
	userID := middleware.GetUserID(c)
	contacts, err := h.relationshipService.ListContactsAcrossVaults(userID)
	if err != nil {
		return response.InternalError(c, "err.failed_to_list_contacts")
	}
	return response.OK(c, contacts)
}
