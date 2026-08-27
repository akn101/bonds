package services

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

const suggestPayload = `[
  {
    "lat": "51.5034",
    "lon": "-0.1276",
    "display_name": "10, Downing Street, London, SW1A 2AA, United Kingdom",
    "address": {
      "house_number": "10",
      "road": "Downing Street",
      "city": "London",
      "state": "England",
      "postcode": "SW1A 2AA",
      "country": "United Kingdom"
    }
  },
  {
    "lat": "48.2082",
    "lon": "16.3738",
    "display_name": "Vienna, Austria",
    "address": {
      "town": "Vienna",
      "county": "Wien",
      "country": "Austria"
    }
  }
]`

func TestSuggestSplitsAddressIntoFormFields(t *testing.T) {
	var gotQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(suggestPayload))
	}))
	defer server.Close()

	suggestions, err := suggestFromURL(server.Client(), server.URL, "10 downing", "", 5, nil)
	if err != nil {
		t.Fatalf("suggestFromURL failed: %v", err)
	}
	if len(suggestions) != 2 {
		t.Fatalf("expected 2 suggestions, got %d", len(suggestions))
	}

	// Structured fields are what make autocomplete fill the whole form rather
	// than dumping a formatted string into line 1.
	if suggestions[0].Line1 != "10 Downing Street" {
		t.Fatalf("expected the house number folded into line 1, got %q", suggestions[0].Line1)
	}
	if suggestions[0].City != "London" || suggestions[0].Province != "England" {
		t.Fatalf("unexpected city/province: %q / %q", suggestions[0].City, suggestions[0].Province)
	}
	if suggestions[0].PostalCode != "SW1A 2AA" || suggestions[0].Country != "United Kingdom" {
		t.Fatalf("unexpected postcode/country: %q / %q", suggestions[0].PostalCode, suggestions[0].Country)
	}
	if suggestions[0].Latitude != 51.5034 || suggestions[0].Longitude != -0.1276 {
		t.Fatalf("unexpected coordinates: %v, %v", suggestions[0].Latitude, suggestions[0].Longitude)
	}

	// Which key holds the town and the region varies by country.
	if suggestions[1].City != "Vienna" || suggestions[1].Province != "Wien" {
		t.Fatalf("expected town/county to be used as city/province, got %q / %q", suggestions[1].City, suggestions[1].Province)
	}
	if suggestions[1].Line1 != "" {
		t.Fatalf("expected no street line for a city-level result, got %q", suggestions[1].Line1)
	}

	// addressdetails is what makes the provider return the breakdown at all.
	if !contains(gotQuery, "addressdetails=1") {
		t.Fatalf("expected addressdetails in the request, got %q", gotQuery)
	}
}

func TestSuggestSkipsEmptyQueryWithoutCallingProvider(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))
	defer server.Close()

	suggestions, err := suggestFromURL(server.Client(), server.URL, "   ", "", 5, nil)
	if err != nil {
		t.Fatalf("suggestFromURL failed: %v", err)
	}
	if len(suggestions) != 0 {
		t.Fatalf("expected no suggestions, got %d", len(suggestions))
	}
	if called {
		t.Fatal("a blank query must not reach the provider")
	}
}

func TestRateLimiterSpacesRequests(t *testing.T) {
	limiter := &rateLimiter{interval: 50 * time.Millisecond}

	// The first slot is free; the next two are booked behind it.
	if wait, ok := limiter.reserve(time.Second); !ok || wait != 0 {
		t.Fatalf("expected the first slot to be immediate, got wait=%v ok=%v", wait, ok)
	}
	second, ok := limiter.reserve(time.Second)
	if !ok || second <= 0 {
		t.Fatalf("expected the second caller to wait, got wait=%v ok=%v", second, ok)
	}
	third, ok := limiter.reserve(time.Second)
	if !ok || third <= second {
		t.Fatalf("expected each caller to queue behind the last, got %v then %v", second, third)
	}
}

func TestRateLimiterRefusesRatherThanQueueForever(t *testing.T) {
	limiter := &rateLimiter{interval: time.Second}
	if _, ok := limiter.reserve(time.Second); !ok {
		t.Fatal("expected the first slot to be granted")
	}
	// Waiting a full second for an autocomplete answer is worse than none.
	if _, ok := limiter.reserve(10 * time.Millisecond); ok {
		t.Fatal("expected the limiter to refuse a slot beyond the deadline")
	}
	if err := limiter.wait(10 * time.Millisecond); err != ErrGeocoderBusy {
		t.Fatalf("expected ErrGeocoderBusy, got %v", err)
	}
	// A refusal must not have consumed the slot it declined.
	if _, ok := limiter.reserve(2 * time.Second); !ok {
		t.Fatal("expected a later caller with a longer deadline to still be served")
	}
}

func TestNilRateLimiterIsUnlimited(t *testing.T) {
	var limiter *rateLimiter
	if err := limiter.wait(time.Millisecond); err != nil {
		t.Fatalf("a nil limiter must not block: %v", err)
	}
}

func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
