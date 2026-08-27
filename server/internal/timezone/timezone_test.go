package timezone

import (
	"testing"
	"time"
)

func TestNormalize(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		want      string
		wantError bool
	}{
		{name: "default", input: "", want: Default},
		{name: "trimmed UTC", input: " UTC ", want: Default},
		{name: "IANA zone", input: "Australia/Sydney", want: "Australia/Sydney"},
		{name: "process local", input: "Local", wantError: true},
		{name: "invalid", input: "Mars/Olympus_Mons", wantError: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := Normalize(test.input)
			if test.wantError {
				if err == nil {
					t.Fatalf("Normalize(%q) succeeded, want error", test.input)
				}
				return
			}
			if err != nil {
				t.Fatalf("Normalize(%q): %v", test.input, err)
			}
			if got != test.want {
				t.Fatalf("Normalize(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}

func TestLocationFallsBackToUTC(t *testing.T) {
	invalid := "Mars/Olympus_Mons"
	for _, value := range []*string{nil, &invalid} {
		if got := Location(value); got != time.UTC {
			t.Fatalf("Location(%v) = %s, want UTC", value, got)
		}
	}
}
