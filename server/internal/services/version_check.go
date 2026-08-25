package services

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"golang.org/x/mod/semver"
)

const latestReleaseURL = "https://api.github.com/repos/naiba/bonds/releases/latest"

type VersionUpdate struct {
	Version string
	URL     string
}

type VersionChecker interface {
	Check(currentVersion string) *VersionUpdate
}

type GitHubVersionChecker struct {
	client    *http.Client
	mu        sync.Mutex
	checkedAt time.Time
	update    *VersionUpdate
}

func NewGitHubVersionChecker() *GitHubVersionChecker {
	return &GitHubVersionChecker{client: &http.Client{Timeout: 5 * time.Second}}
}

func (c *GitHubVersionChecker) Check(currentVersion string) *VersionUpdate {
	if !semver.IsValid(currentVersion) || semver.Prerelease(currentVersion) != "" {
		return nil
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Since(c.checkedAt) < 6*time.Hour {
		return c.update
	}
	c.checkedAt = time.Now()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, latestReleaseURL, nil)
	if err != nil {
		return c.update
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Bonds/"+currentVersion)
	resp, err := c.client.Do(req)
	if err != nil {
		return c.update
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return c.update
	}
	var release struct {
		TagName string `json:"tag_name"`
		HTMLURL string `json:"html_url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil ||
		!semver.IsValid(release.TagName) || release.HTMLURL == "" {
		return c.update
	}
	if semver.Compare(release.TagName, currentVersion) > 0 {
		c.update = &VersionUpdate{Version: release.TagName, URL: release.HTMLURL}
	} else {
		c.update = nil
	}
	return c.update
}
