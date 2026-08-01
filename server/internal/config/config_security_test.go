package config

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDockerComposeJWTSecretRequiresExplicitValue(t *testing.T) {
	// Given
	composePath := filepath.Join("..", "..", "..", "docker-compose.yml")
	composeFile, err := os.ReadFile(composePath)
	if err != nil {
		t.Fatalf("read docker-compose.yml: %v", err)
	}
	compose := string(composeFile)
	requiredInterpolation := "${JWT_SECRET:?JWT_SECRET must be set to a strong random value before running docker compose}"

	// When
	activeSQLiteSetting := strings.Contains(compose, "- JWT_SECRET="+requiredInterpolation)
	postgresExampleSetting := strings.Contains(compose, "#     - JWT_SECRET="+requiredInterpolation)
	usesFallback := strings.Contains(compose, "${JWT_SECRET:-")

	// Then
	if !activeSQLiteSetting || !postgresExampleSetting || usesFallback {
		t.Fatalf("docker-compose.yml must require JWT_SECRET without a fallback; active=%t postgres_example=%t fallback=%t", activeSQLiteSetting, postgresExampleSetting, usesFallback)
	}
}

func TestConfigValidateJWTSecretUsesProductionSafetyContract(t *testing.T) {
	tests := []struct {
		name    string
		env     string
		secret  string
		wantErr error
	}{
		{
			name:    "rejects empty production secret",
			env:     "production",
			secret:  "",
			wantErr: ErrUnsafeJWTSecret,
		},
		{
			name:    "rejects whitespace production secret",
			env:     "production",
			secret:  " \t\n ",
			wantErr: ErrUnsafeJWTSecret,
		},
		{
			name:    "rejects public production placeholder",
			env:     "production",
			secret:  "change-me-in-production",
			wantErr: ErrUnsafeJWTSecret,
		},
		{
			name:    "rejects one byte production secret",
			env:     "production",
			secret:  "a",
			wantErr: ErrUnsafeJWTSecret,
		},
		{
			name:    "rejects 31 byte production secret after trimming",
			env:     "production",
			secret:  " " + strings.Repeat("a", 31) + " ",
			wantErr: ErrUnsafeJWTSecret,
		},
		{
			name:    "rejects documented public placeholder",
			env:     "production",
			secret:  "your-secret-key-here",
			wantErr: ErrUnsafeJWTSecret,
		},
		{
			name:    "rejects documented random string placeholder",
			env:     "production",
			secret:  "change-me-to-a-random-string",
			wantErr: ErrUnsafeJWTSecret,
		},
		{
			name:    "rejects normalized historical public placeholder",
			env:     "production",
			secret:  " CHANGE-ME-TO-ANOTHER-RANDOM-STRING ",
			wantErr: ErrUnsafeJWTSecret,
		},
		{
			name:    "rejects localized public placeholder",
			env:     "production",
			secret:  "sua-chave-secreta-aqui",
			wantErr: ErrUnsafeJWTSecret,
		},
		{
			name:    "normalizes production environment and placeholder",
			env:     " Production ",
			secret:  " CHANGE-ME-IN-PRODUCTION ",
			wantErr: ErrUnsafeJWTSecret,
		},
		{
			name:   "accepts 32 byte production secret after trimming",
			env:    "production",
			secret: "\t" + strings.Repeat("a", 32) + "\n",
		},
		{
			name:   "accepts production secret above minimum",
			env:    "production",
			secret: strings.Repeat("a", 33),
		},
		{
			name:   "accepts strong production secret",
			env:    "production",
			secret: "bonds-production-jwt-secret-9f28b6b7a4d143389ee369dc4073570e",
		},
		{
			name:   "accepts blank development secret",
			env:    "development",
			secret: "",
		},
		{
			name:   "accepts placeholder test secret",
			env:    "test",
			secret: "change-me-in-production",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			// Given
			configuration := &Config{
				App: AppConfig{Env: test.env},
				JWT: JWTConfig{Secret: test.secret},
			}

			// When
			err := configuration.Validate()

			// Then
			if test.wantErr != nil {
				if !errors.Is(err, test.wantErr) {
					t.Fatalf("Validate() error = %v, want errors.Is(_, %v)", err, test.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("Validate() returned unexpected error: %v", err)
			}
		})
	}
}

func TestProductionDeploymentDocsGenerateJWTSecretBeforeStartup(t *testing.T) {
	quickStartPaths := []string{
		"README.md",
		"README_zh.md",
		"README_pt-BR.md",
		"README_pt-PT.md",
		"doc/guide/getting-started.md",
		"doc/zh/guide/getting-started.md",
		"doc/pt-BR/guide/getting-started.md",
		"doc/pt-PT/guide/getting-started.md",
	}
	configurationPaths := []string{
		"doc/guide/configuration.md",
		"doc/zh/guide/configuration.md",
		"doc/pt-BR/guide/configuration.md",
		"doc/pt-PT/guide/configuration.md",
	}
	forbiddenPlaceholders := []string{
		"your-secret-key-here",
		"change-me-to-a-random-string",
		"change-me-to-another-random-string",
		"sua-chave-secreta-aqui",
		"修改为随机字符串",
		"另一个随机字符串",
		"你的密钥",
	}
	repositoryRoot := filepath.Join("..", "..", "..")
	secretGenerationCommand := `export JWT_SECRET="$(openssl rand -hex 32)"`

	for _, path := range quickStartPaths {
		t.Run(path, func(t *testing.T) {
			// Given
			contents, err := os.ReadFile(filepath.Join(repositoryRoot, path))
			if err != nil {
				t.Fatalf("read %s: %v", path, err)
			}
			document := string(contents)

			// When
			generationIndex := strings.Index(document, secretGenerationCommand)
			startupIndex := firstStartupCommandIndex(document)

			// Then
			if generationIndex < 0 || startupIndex < 0 || generationIndex > startupIndex {
				t.Fatalf("%s must generate JWT_SECRET before its first production startup command", path)
			}
			assertNoJWTSecretPlaceholders(t, path, document, forbiddenPlaceholders)
		})
	}

	for _, path := range configurationPaths {
		t.Run(path, func(t *testing.T) {
			// Given
			contents, err := os.ReadFile(filepath.Join(repositoryRoot, path))
			if err != nil {
				t.Fatalf("read %s: %v", path, err)
			}
			document := string(contents)

			// When / Then
			assertNoJWTSecretPlaceholders(t, path, document, forbiddenPlaceholders)
		})
	}
}

func firstStartupCommandIndex(document string) int {
	startupCommands := []string{
		"docker compose up",
		"./bonds-server",
		"./server/bin/bonds-server",
	}
	firstIndex := -1
	for _, command := range startupCommands {
		index := strings.Index(document, command)
		if index >= 0 && (firstIndex < 0 || index < firstIndex) {
			firstIndex = index
		}
	}
	return firstIndex
}

func assertNoJWTSecretPlaceholders(t *testing.T, path, document string, placeholders []string) {
	t.Helper()
	for _, placeholder := range placeholders {
		if strings.Contains(document, placeholder) {
			t.Fatalf("%s contains forbidden JWT_SECRET placeholder %q", path, placeholder)
		}
	}
}
