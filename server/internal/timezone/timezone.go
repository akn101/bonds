package timezone

import (
	"fmt"
	"strings"
	"time"
)

const Default = "UTC"

// Normalize validates a saved timezone and returns the canonical location
// name used by Go. Empty values use the application-wide UTC default.
func Normalize(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Default, nil
	}
	if name == "Local" {
		return "", fmt.Errorf("invalid timezone %q: process-local timezone is not deterministic", name)
	}
	location, err := time.LoadLocation(name)
	if err != nil {
		return "", fmt.Errorf("invalid timezone %q: %w", name, err)
	}
	return location.String(), nil
}

// Location resolves a persisted timezone. Legacy nil, empty, or invalid
// values all use UTC so backend jobs and frontend preferences share one
// deterministic fallback rather than inheriting the host process timezone.
func Location(name *string) *time.Location {
	if name == nil {
		return time.UTC
	}
	normalized, err := Normalize(*name)
	if err != nil {
		return time.UTC
	}
	location, err := time.LoadLocation(normalized)
	if err != nil {
		return time.UTC
	}
	return location
}
