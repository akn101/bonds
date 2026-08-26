package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v5"
	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/testutil"
)

const jwtDatabaseAuthorityTestSecret = "database-authority-test-secret"

type jwtAdministratorPrivilegeScenario struct {
	name                 string
	initialDatabaseValue bool
	tokenClaim           bool
	currentDatabaseValue bool
	wantAllowed          bool
}

type jwtAdministratorPrivilegeContract struct {
	databaseColumn    string
	contextKey        string
	setUserPrivilege  func(*models.User, bool)
	setTokenPrivilege func(*JWTClaims, bool)
	requirePrivilege  func(*AuthMiddleware, echo.HandlerFunc) echo.HandlerFunc
}

func TestJWTAuthenticationUsesCurrentDatabaseAccountAdministratorPrivilege(t *testing.T) {
	runJWTAdministratorPrivilegeContract(t, jwtAdministratorPrivilegeContract{
		databaseColumn: "is_account_administrator",
		contextKey:     "is_admin",
		setUserPrivilege: func(user *models.User, value bool) {
			user.IsAccountAdministrator = value
		},
		setTokenPrivilege: func(claims *JWTClaims, value bool) {
			claims.IsAdmin = value
		},
		requirePrivilege: func(auth *AuthMiddleware, next echo.HandlerFunc) echo.HandlerFunc {
			return auth.RequireAdmin(next)
		},
	})
}

func TestJWTAuthenticationUsesCurrentDatabaseInstanceAdministratorPrivilege(t *testing.T) {
	runJWTAdministratorPrivilegeContract(t, jwtAdministratorPrivilegeContract{
		databaseColumn: "is_instance_administrator",
		contextKey:     "is_instance_admin",
		setUserPrivilege: func(user *models.User, value bool) {
			user.IsInstanceAdministrator = value
		},
		setTokenPrivilege: func(claims *JWTClaims, value bool) {
			claims.IsInstanceAdmin = value
		},
		requirePrivilege: func(auth *AuthMiddleware, next echo.HandlerFunc) echo.HandlerFunc {
			return auth.RequireInstanceAdmin(next)
		},
	})
}

func runJWTAdministratorPrivilegeContract(t *testing.T, contract jwtAdministratorPrivilegeContract) {
	t.Helper()
	scenarios := []jwtAdministratorPrivilegeScenario{
		{
			name:                 "denies claim true when database false",
			initialDatabaseValue: false,
			tokenClaim:           true,
			currentDatabaseValue: false,
			wantAllowed:          false,
		},
		{
			name:                 "allows claim false when database true",
			initialDatabaseValue: true,
			tokenClaim:           false,
			currentDatabaseValue: true,
			wantAllowed:          true,
		},
		{
			name:                 "denies immediately after database revocation",
			initialDatabaseValue: true,
			tokenClaim:           true,
			currentDatabaseValue: false,
			wantAllowed:          false,
		},
		{
			name:                 "allows immediately after database promotion",
			initialDatabaseValue: false,
			tokenClaim:           false,
			currentDatabaseValue: true,
			wantAllowed:          true,
		},
	}

	for _, scenario := range scenarios {
		t.Run(scenario.name, func(t *testing.T) {
			// Given
			db := testutil.SetupTestDB(t)
			account := models.Account{}
			if err := db.Create(&account).Error; err != nil {
				t.Fatalf("create account: %v", err)
			}
			user := models.User{
				AccountID: account.ID,
				Email:     "jwt-database-authority@example.com",
			}
			contract.setUserPrivilege(&user, scenario.initialDatabaseValue)
			if err := db.Create(&user).Error; err != nil {
				t.Fatalf("create user: %v", err)
			}

			claims := &JWTClaims{
				UserID:    user.ID,
				AccountID: account.ID,
				Email:     user.Email,
				RegisteredClaims: jwt.RegisteredClaims{
					ExpiresAt: jwt.NewNumericDate(time.Now().Add(5 * time.Minute)),
					IssuedAt:  jwt.NewNumericDate(time.Now()),
				},
			}
			contract.setTokenPrivilege(claims, scenario.tokenClaim)
			token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
			signedToken, err := token.SignedString([]byte(jwtDatabaseAuthorityTestSecret))
			if err != nil {
				t.Fatalf("sign JWT: %v", err)
			}

			if scenario.currentDatabaseValue != scenario.initialDatabaseValue {
				if err := db.Model(&models.User{}).
					Where("id = ?", user.ID).
					Update(contract.databaseColumn, scenario.currentDatabaseValue).Error; err != nil {
					t.Fatalf("update current database privilege: %v", err)
				}
			}

			e := echo.New()
			req := httptest.NewRequest(http.MethodGet, "/protected", nil)
			req.Header.Set("Authorization", "Bearer "+signedToken)
			rec := httptest.NewRecorder()
			context := e.NewContext(req, rec)
			auth := NewAuthMiddleware(jwtDatabaseAuthorityTestSecret, db)
			nextCalled := false
			handler := auth.Authenticate(contract.requirePrivilege(auth, func(c *echo.Context) error {
				nextCalled = true
				return c.NoContent(http.StatusNoContent)
			}))

			// When
			if err := handler(context); err != nil {
				t.Fatalf("middleware returned error: %v", err)
			}

			// Then
			wantStatus := http.StatusForbidden
			if scenario.wantAllowed {
				wantStatus = http.StatusNoContent
			}
			if rec.Code != wantStatus {
				t.Fatalf("response status = %d, want %d; body=%s", rec.Code, wantStatus, rec.Body.String())
			}
			if nextCalled != scenario.wantAllowed {
				t.Fatalf("next handler called = %t, want %t", nextCalled, scenario.wantAllowed)
			}
			currentPrivilege, ok := context.Get(contract.contextKey).(bool)
			if !ok {
				t.Fatalf("context %q is not a bool", contract.contextKey)
			}
			if currentPrivilege != scenario.currentDatabaseValue {
				t.Fatalf("context %q = %t, want current database value %t", contract.contextKey, currentPrivilege, scenario.currentDatabaseValue)
			}
		})
	}
}
