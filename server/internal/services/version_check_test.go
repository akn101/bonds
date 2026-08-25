package services

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type versionCheckRoundTripper struct {
	calls int
	body  string
}

func (t *versionCheckRoundTripper) RoundTrip(*http.Request) (*http.Response, error) {
	t.calls++
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(t.body)),
	}, nil
}

func TestGitHubVersionCheckerFindsAndCachesUpdate(t *testing.T) {
	transport := &versionCheckRoundTripper{body: `{"tag_name":"v0.23.0","html_url":"https://github.com/naiba/bonds/releases/tag/v0.23.0"}`}
	checker := &GitHubVersionChecker{client: &http.Client{Transport: transport, Timeout: time.Second}}

	update := checker.Check("v0.22.4")
	if update == nil || update.Version != "v0.23.0" {
		t.Fatalf("expected v0.23.0 update, got %+v", update)
	}
	if cached := checker.Check("v0.22.4"); cached == nil || transport.calls != 1 {
		t.Fatalf("expected cached update after one request, calls=%d update=%+v", transport.calls, cached)
	}
}

func TestGitHubVersionCheckerSkipsDevelopmentAndPrereleaseVersions(t *testing.T) {
	transport := &versionCheckRoundTripper{body: `{}`}
	checker := &GitHubVersionChecker{client: &http.Client{Transport: transport}}

	if checker.Check("dev") != nil || checker.Check("v0.23.0-rc.1") != nil {
		t.Fatal("development and prerelease versions must not check for updates")
	}
	if transport.calls != 0 {
		t.Fatalf("expected no GitHub requests, got %d", transport.calls)
	}
}
