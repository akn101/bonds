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

var (
	_ dto.DemographicsReportResponse
	_ dto.MapReportResponse
	_ dto.InteractionsReportResponse
)

// Demographics godoc
//
//	@Summary		Get demographics report
//	@Description	Return contact counts grouped by gender, pronoun, religion, age band, label and group
//	@Tags			reports
//	@Produce		json
//	@Security		BearerAuth
//	@Param			vault_id	path		string	true	"Vault ID"
//	@Success		200			{object}	response.APIResponse{data=dto.DemographicsReportResponse}
//	@Failure		500			{object}	response.APIResponse
//	@Router			/vaults/{vault_id}/reports/demographics [get]
func (h *ReportHandler) Demographics(c *echo.Context) error {
	vaultID := c.Param("vault_id")
	data, err := h.reportService.DemographicsReport(vaultID, middleware.GetLocale(c))
	if err != nil {
		return response.InternalError(c, "err.failed_to_get_demographics_report")
	}
	return response.OK(c, data)
}

// Map godoc
//
//	@Summary		Get map report
//	@Description	Return geocoded address points and per-country address counts for a vault
//	@Tags			reports
//	@Produce		json
//	@Security		BearerAuth
//	@Param			vault_id	path		string	true	"Vault ID"
//	@Success		200			{object}	response.APIResponse{data=dto.MapReportResponse}
//	@Failure		500			{object}	response.APIResponse
//	@Router			/vaults/{vault_id}/reports/map [get]
func (h *ReportHandler) Map(c *echo.Context) error {
	vaultID := c.Param("vault_id")
	data, err := h.reportService.MapReport(vaultID, middleware.GetUserID(c))
	if err != nil {
		return response.InternalError(c, "err.failed_to_get_map_report")
	}
	return response.OK(c, data)
}

// Interactions godoc
//
//	@Summary		Get interactions report
//	@Description	Return how often the vault owner is in touch with people, by month, channel and contact
//	@Tags			reports
//	@Produce		json
//	@Security		BearerAuth
//	@Param			vault_id	path		string	true	"Vault ID"
//	@Param			months		query		int		false	"Months of history in the time series (default 24, max 120)"
//	@Success		200			{object}	response.APIResponse{data=dto.InteractionsReportResponse}
//	@Failure		500			{object}	response.APIResponse
//	@Router			/vaults/{vault_id}/reports/interactions [get]
func (h *ReportHandler) Interactions(c *echo.Context) error {
	vaultID := c.Param("vault_id")
	// An unparseable months value falls back to the default rather than
	// rejecting the request; the series is a view preference, not an assertion.
	months, _ := strconv.Atoi(c.QueryParam("months"))
	data, err := h.reportService.InteractionsReport(vaultID, middleware.GetLocale(c), middleware.GetUserID(c), months)
	if err != nil {
		return response.InternalError(c, "err.failed_to_get_interactions_report")
	}
	return response.OK(c, data)
}

// Suggest godoc
//
//	@Summary		Suggest addresses
//	@Description	Look up candidate addresses for a partial query, for address autocomplete
//	@Tags			addresses
//	@Produce		json
//	@Security		BearerAuth
//	@Param			vault_id	path		string	true	"Vault ID"
//	@Param			q			query		string	true	"Partial address"
//	@Success		200			{object}	response.APIResponse{data=dto.AddressSuggestionsResponse}
//	@Failure		429			{object}	response.APIResponse
//	@Failure		500			{object}	response.APIResponse
//	@Router			/vaults/{vault_id}/addresses/suggest [get]
func (h *AddressHandler) Suggest(c *echo.Context) error {
	suggestions, enabled, err := h.addressService.Suggest(c.QueryParam("q"), 0)
	if err != nil {
		if errors.Is(err, services.ErrGeocoderBusy) {
			// The provider's rate limit, not a failure — the caller should slow
			// down and try again rather than treat lookup as broken.
			return response.TooManyRequests(c, "err.address_lookup_busy")
		}
		return response.InternalError(c, "err.failed_to_suggest_addresses")
	}
	return response.OK(c, dto.AddressSuggestionsResponse{Enabled: enabled, Suggestions: suggestions})
}
