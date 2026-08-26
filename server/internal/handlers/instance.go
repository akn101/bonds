package handlers

import (
	"github.com/labstack/echo/v5"
	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/services"
	"github.com/naiba/bonds/pkg/response"
)

var _ dto.InstanceInfoResponse

type InstanceHandler struct {
	settingService  *services.SystemSettingService
	oauthService    *services.OAuthService
	webauthnService *services.WebAuthnService
	version         string
	versionChecker  services.VersionChecker
}

func NewInstanceHandler(
	settingService *services.SystemSettingService,
	oauthService *services.OAuthService,
	webauthnService *services.WebAuthnService,
	version string,
) *InstanceHandler {
	return &InstanceHandler{
		settingService:  settingService,
		oauthService:    oauthService,
		webauthnService: webauthnService,
		version:         version,
		versionChecker:  services.NewGitHubVersionChecker(),
	}
}

// GetInfo godoc
//
//	@Summary		Get instance info
//	@Description	Get public instance information (version, enabled auth methods)
//	@Tags			instance
//	@Produce		json
//	@Success		200	{object}	response.APIResponse{data=dto.InstanceInfoResponse}
//	@Router			/instance/info [get]
func (h *InstanceHandler) GetInfo(c *echo.Context) error {
	registrationEnabled := h.settingService.GetBool("registration.enabled", true)
	passwordAuthEnabled := h.settingService.GetBool("auth.password.enabled", true)
	requireEmailVerification := h.settingService.GetBool("auth.require_email_verification", false)
	smtpConfigured := h.settingService.GetWithDefault("smtp.host", "") != ""
	emailVerificationActive := requireEmailVerification && smtpConfigured
	appName := h.settingService.GetWithDefault("app.name", "Bonds")

	providers := h.oauthService.ListAvailableProviders()
	oauthNames := make([]string, len(providers))
	oauthDetails := make([]dto.OAuthProviderInfo, len(providers))
	for i, p := range providers {
		name := p["name"]
		displayName := p["display_name"]
		if displayName == "" {
			displayName = name
		}
		oauthNames[i] = name
		oauthDetails[i] = dto.OAuthProviderInfo{Name: name, DisplayName: displayName}
	}

	webauthnEnabled := h.webauthnService.IsEnabled()

	info := dto.InstanceInfoResponse{
		Version:                  h.version,
		RegistrationEnabled:      registrationEnabled,
		PasswordAuthEnabled:      passwordAuthEnabled,
		OAuthProviders:           oauthNames,
		OAuthProviderDetails:     oauthDetails,
		WebAuthnEnabled:          webauthnEnabled,
		AppName:                  appName,
		RequireEmailVerification: emailVerificationActive,
	}
	if update := h.versionChecker.Check(h.version); update != nil {
		info.UpdateAvailable = true
		info.LatestVersion = update.Version
		info.LatestVersionURL = update.URL
	}

	return response.OK(c, info)
}
