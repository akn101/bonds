package i18n

import (
	"strings"
	"testing"
)

// TestSupportedMatchesEmbeddedBundles guards against the registry drifting
// from the //go:embed directive. If a *.json is added but Supported is not
// updated, Accept-Language for that locale silently falls back to "en".
// Conversely, if Supported lists a code with no JSON, load() panics at boot.
func TestSupportedMatchesEmbeddedBundles(t *testing.T) {
	entries, err := localeFS.ReadDir(".")
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	embedded := map[string]bool{}
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".json") {
			continue
		}
		embedded[strings.TrimSuffix(name, ".json")] = true
	}
	for _, code := range Supported {
		if !embedded[code] {
			t.Errorf("Supported lists %q but %s.json is not embedded", code, code)
		}
		delete(embedded, code)
	}
	for code := range embedded {
		t.Errorf("%s.json is embedded but %q is missing from Supported", code, code)
	}
}

func TestIsSupported(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"en", true},
		{"zh", true},
		{"es", true},
		{"fr", true},
		{"de", true},
		{"pt-BR", true},
		{"pt-PT", true},
		{"", false},
		{"zh-CN", false},
		{"pt-br", false},
		{"EN", false},
	}
	for _, tt := range tests {
		if got := IsSupported(tt.input); got != tt.want {
			t.Errorf("IsSupported(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestMatch(t *testing.T) {
	tests := []struct {
		input string
		want  string
		ok    bool
	}{
		{input: "zh-CN", want: "zh", ok: true},
		{input: "PT-br", want: "pt-BR", ok: true},
		{input: "pt", want: "pt-PT", ok: true},
		{input: "de-DE", want: "de", ok: true},
		{input: "ja", ok: false},
		{input: "", ok: false},
	}
	for _, test := range tests {
		got, ok := Match(test.input)
		if got != test.want || ok != test.ok {
			t.Errorf("Match(%q) = (%q, %t), want (%q, %t)", test.input, got, ok, test.want, test.ok)
		}
	}
}
