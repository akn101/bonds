import { useAuth } from "@/stores/auth";
import type { AuthenticationCompletion } from "@/stores/auth";
import {
  ACCOUNT_A_TOKEN,
  ACCOUNT_A_USER,
  ACCOUNT_B_LOGIN,
  createAuthRaceQueryClient,
  expectAuthenticationState,
  seedSubjectCache,
} from "@/test/authProviderRaceHarness";
import {
  captureAuthenticationSubjectRevision,
  isAuthenticationSubjectRevisionCurrent,
} from "@/utils/authenticationSubjectRevision";
import { httpClient } from "@/api";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import type {
  AxiosAdapter,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthProvider } from "@/stores/auth";

const BUSINESS_API_ERROR = {
  code: "INVALID_CREDENTIALS",
  message: "Invalid authentication attempt",
} as const;

type AuthenticationAttemptConsumerProps = Readonly<{
  onLoginAttempt: (attempt: Promise<AuthenticationCompletion>) => void;
}>;

function AuthenticationAttemptConsumer({
  onLoginAttempt,
}: AuthenticationAttemptConsumerProps) {
  const {
    user,
    token,
    isLoading,
    twoFactorPending,
    tempToken,
    login,
  } = useAuth();

  return (
    <>
      <output data-testid="auth-user-id">{user?.id ?? "none"}</output>
      <output data-testid="auth-token">{token ?? "none"}</output>
      <output data-testid="auth-loading">{String(isLoading)}</output>
      <output data-testid="two-factor-pending">
        {String(twoFactorPending)}
      </output>
      <output data-testid="temp-token">{tempToken ?? "none"}</output>
      <button
        type="button"
        onClick={() => onLoginAttempt(login(ACCOUNT_B_LOGIN))}
      >
        Attempt password login
      </button>
    </>
  );
}

function createResponse<Data>(
  config: InternalAxiosRequestConfig,
  data: Data,
  status = 200,
): AxiosResponse<Data> {
  return {
    config,
    data,
    headers: {},
    status,
    statusText: status === 200 ? "OK" : "Unauthorized",
  };
}

function createBusinessUnauthorizedError(
  config: InternalAxiosRequestConfig,
): AxiosError {
  return new AxiosError(
    "Request failed with status code 401",
    AxiosError.ERR_BAD_REQUEST,
    config,
    undefined,
    createResponse(config, { error: BUSINESS_API_ERROR }, 401),
  );
}

function installBusinessUnauthorizedAdapter(attemptURL: string) {
  let attemptAuthorization: unknown;
  let refreshRequestCount = 0;
  const adapter: AxiosAdapter = async (config) => {
    if (config.url === "/auth/me") {
      return createResponse(config, { data: ACCOUNT_A_USER });
    }
    if (config.url === "/auth/refresh") {
      refreshRequestCount += 1;
      throw createBusinessUnauthorizedError(config);
    }
    if (config.url === attemptURL) {
      attemptAuthorization = config.headers.get("Authorization");
      throw createBusinessUnauthorizedError(config);
    }
    return createResponse(config, { data: {} });
  };
  httpClient.instance.defaults.adapter = adapter;
  return {
    getAttemptAuthorization: () => attemptAuthorization,
    getRefreshRequestCount: () => refreshRequestCount,
  };
}

async function renderCurrentAccount(
  onLoginAttempt: AuthenticationAttemptConsumerProps["onLoginAttempt"],
) {
  localStorage.setItem("token", ACCOUNT_A_TOKEN);
  const queryClient = createAuthRaceQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthenticationAttemptConsumer onLoginAttempt={onLoginAttempt} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId("auth-user-id")).toHaveTextContent(
      ACCOUNT_A_USER.id,
    ),
  );
  seedSubjectCache(queryClient, ACCOUNT_A_USER.id);
  return queryClient;
}

function expectCurrentAccountPreserved(
  queryClient: ReturnType<typeof createAuthRaceQueryClient>,
): void {
  expect(screen.getByTestId("auth-loading")).toHaveTextContent("false");
  expectAuthenticationState(queryClient, {
    userId: ACCOUNT_A_USER.id,
    token: ACCOUNT_A_TOKEN,
    twoFactorPending: false,
    tempToken: "none",
    cacheOwnerId: ACCOUNT_A_USER.id,
  });
}

describe("public authentication attempt ownership", () => {
  const originalAdapter = httpClient.instance.defaults.adapter;

  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(
      {},
      "",
      "/vaults/account-a?view=current#subject",
    );
  });

  afterEach(() => {
    httpClient.instance.defaults.adapter = originalAdapter;
  });

  it("propagates a password login business 401 without terminating the current subject", async () => {
    // Given
    const requests = installBusinessUnauthorizedAdapter("/auth/login");
    let loginAttempt: Promise<AuthenticationCompletion> | null = null;
    const queryClient = await renderCurrentAccount((attempt) => {
      loginAttempt = attempt;
      void attempt.catch(() => undefined);
    });
    const subjectRevision = captureAuthenticationSubjectRevision();
    const currentLocation = window.location.href;

    // When
    await userEvent.click(
      screen.getByRole("button", { name: "Attempt password login" }),
    );

    // Then
    if (loginAttempt === null) {
      throw new Error("expected the login attempt to start");
    }
    await expect(loginAttempt).rejects.toEqual(BUSINESS_API_ERROR);
    expect(requests.getRefreshRequestCount()).toBe(0);
    expect(requests.getAttemptAuthorization()).toBeUndefined();
    expect(isAuthenticationSubjectRevisionCurrent(subjectRevision)).toBe(true);
    expectCurrentAccountPreserved(queryClient);
    expect(window.location.href).toBe(currentLocation);
  });

  it.each([
    {
      name: "2FA login verification",
      url: "/auth/2fa/verify",
    },
    {
      name: "WebAuthn login finish with a query string",
      url: "/auth/webauthn/login/finish?email=account-b%40example.com",
    },
  ])(
    "propagates a $name business 401 without terminating the current subject",
    async ({ url }) => {
      // Given
      const requests = installBusinessUnauthorizedAdapter(url);
      const queryClient = await renderCurrentAccount(() => undefined);
      const subjectRevision = captureAuthenticationSubjectRevision();
      const currentLocation = window.location.href;

      // When
      const attempt = httpClient.instance.post(url, {});

      // Then
      await expect(attempt).rejects.toEqual(BUSINESS_API_ERROR);
      expect(requests.getRefreshRequestCount()).toBe(0);
      expect(requests.getAttemptAuthorization()).toBeUndefined();
      expect(isAuthenticationSubjectRevisionCurrent(subjectRevision)).toBe(true);
      expectCurrentAccountPreserved(queryClient);
      expect(window.location.href).toBe(currentLocation);
    },
  );
});
