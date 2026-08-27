package middleware

import (
	"strings"

	"github.com/labstack/echo/v5"

	"github.com/naiba/bonds/internal/i18n"
)

// Locale parses the Accept-Language header and stores the matched code in the
// echo context. The whitelist comes from i18n.Supported so adding a language
// is a one-line change there. Tags are first tried as-is (e.g. "pt-BR"), then
// the primary subtag (e.g. "zh-CN" → "zh"), then regionFallbacks (e.g. "pt" →
// "pt-PT"), so region-qualified codes for languages with region-specific
// bundles (pt-BR/pt-PT) resolve correctly. Anything not in the bundle defaults
// to "en".
func Locale() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			accept := c.Request().Header.Get("Accept-Language")
			tag := strings.SplitN(accept, ",", 2)[0]
			tag = strings.SplitN(tag, ";", 2)[0]
			lang := i18n.Resolve(tag)
			c.Set("locale", lang)
			return next(c)
		}
	}
}

// GetLocale returns the locale stored in the echo context, defaulting to "en".
func GetLocale(c *echo.Context) string {
	if locale, ok := c.Get("locale").(string); ok && locale != "" {
		return locale
	}
	return i18n.Default
}
