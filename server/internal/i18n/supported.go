package i18n

import "strings"

const Default = "en"

// Supported lists the locale codes the embedded bundle actually loads.
// Adding a language means: drop a `<code>.json` next to en.json, add the
// code here, and add it to web/src/i18n.ts SUPPORTED_LANGUAGES so the
// frontend and backend agree.
//
// This is the single source of truth consulted by:
//   - middleware/locale.go (Accept-Language parsing)
//   - services/preferences.go (defensive check on the service layer)
//   - services/personalize.go (shared translation sync validation)
//
// Keeping these three in sync prevents the trap where a user persists an
// unsupported locale (e.g. "ja") and the UI silently falls back to English.
var Supported = []string{"en", "zh", "es", "fr", "de", "pt-BR", "pt-PT"}

var regionFallbacks = map[string]string{
	"pt": "pt-PT",
}

// IsSupported reports whether lang exactly matches one of the loaded
// locale bundles. Callers that need to coerce region tags like "zh-CN"
// should do so before calling this.
func IsSupported(lang string) bool {
	for _, code := range Supported {
		if code == lang {
			return true
		}
	}
	return false
}

// Match resolves a BCP-47 language tag to a supported bundle without turning
// an unsupported language into a valid preference. Callers can therefore use
// the bool to reject persisted values while request middleware may fall back
// to Default. Matching is case-insensitive and preserves supported regional
// variants such as pt-BR and pt-PT.
func Match(lang string) (string, bool) {
	lang = strings.TrimSpace(lang)
	if lang == "" {
		return "", false
	}
	lower := strings.ToLower(lang)
	for _, code := range Supported {
		if strings.ToLower(code) == lower {
			return code, true
		}
	}
	primary := strings.SplitN(lower, "-", 2)[0]
	for _, code := range Supported {
		if strings.ToLower(code) == primary {
			return code, true
		}
	}
	if fallback, ok := regionFallbacks[primary]; ok && IsSupported(fallback) {
		return fallback, true
	}
	return "", false
}

// Resolve returns the supported locale for a request tag, defaulting to
// English when the client does not send a supported language.
func Resolve(lang string) string {
	if matched, ok := Match(lang); ok {
		return matched
	}
	return Default
}
