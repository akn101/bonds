import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api";
import { AuthProvider, useAuth } from "@/stores/auth";
import { createDeferred } from "@/test/authCompletionTestSupport";
import {
  ACCOUNT_A_TOKEN,
  ACCOUNT_A_USER,
  ACCOUNT_B_LOGIN,
  ACCOUNT_B_TOKEN,
  ACCOUNT_B_USER,
  createAuthRaceQueryClient,
  expectAuthenticationState,
  seedSubjectCache,
} from "@/test/authProviderRaceHarness";

vi.mock("@/api", () => ({
  api: {
    auth: {
      getAuth: vi.fn(),
      loginCreate: vi.fn(),
      registerCreate: vi.fn(),
      "2FaVerifyCreate": vi.fn(),
    },
  },
}));

const ACCOUNT_B_LOGIN_RESPONSE = {
  data: {
    requires_two_factor: false,
    token: ACCOUNT_B_TOKEN,
    user: ACCOUNT_B_USER,
  },
} satisfies Awaited<ReturnType<typeof api.auth.loginCreate>>;
const ACCOUNT_B_USER_RESPONSE = {
  data: ACCOUNT_B_USER,
} satisfies Awaited<ReturnType<typeof api.auth.getAuth>>;

type WebAuthnAuthentication = {
  readonly token: string;
  readonly user: typeof ACCOUNT_A_USER;
};

function WebAuthnRaceConsumer({
  authentication,
}: {
  readonly authentication: Promise<WebAuthnAuthentication>;
}) {
  const { login, loginWithWebAuthn, tempToken, token, twoFactorPending, user } =
    useAuth();
  const [completion, setCompletion] = useState("idle");

  const startWebAuthn = (): void => {
    setCompletion("pending");
    void loginWithWebAuthn(() => authentication).then((result) =>
      setCompletion(result.status),
    );
  };

  return (
    <>
      <output data-testid="auth-user-id">{user?.id ?? "none"}</output>
      <output data-testid="auth-token">{token ?? "none"}</output>
      <output data-testid="two-factor-pending">
        {String(twoFactorPending)}
      </output>
      <output data-testid="temp-token">{tempToken ?? "none"}</output>
      <output data-testid="webauthn-completion">{completion}</output>
      <button type="button" onClick={startWebAuthn}>
        Start WebAuthn A
      </button>
      <button type="button" onClick={() => void login(ACCOUNT_B_LOGIN)}>
        Start login B
      </button>
    </>
  );
}

describe("WebAuthn authentication ownership", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    vi.mocked(api.auth.getAuth).mockResolvedValue(ACCOUNT_B_USER_RESPONSE);
  });

  it("keeps login B when the older WebAuthn authentication completes last", async () => {
    // Given
    const webAuthnAuthentication = createDeferred<WebAuthnAuthentication>();
    vi.mocked(api.auth.loginCreate).mockResolvedValue(
      ACCOUNT_B_LOGIN_RESPONSE,
    );
    const queryClient = createAuthRaceQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <WebAuthnRaceConsumer
            authentication={webAuthnAuthentication.promise}
          />
        </AuthProvider>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Start WebAuthn A" }));
    expect(screen.getByTestId("webauthn-completion")).toHaveTextContent(
      "pending",
    );

    // When
    await user.click(screen.getByRole("button", { name: "Start login B" }));
    await waitFor(() =>
      expect(screen.getByTestId("auth-user-id")).toHaveTextContent(
        ACCOUNT_B_USER.id,
      ),
    );
    seedSubjectCache(queryClient, ACCOUNT_B_USER.id);
    await act(async () => {
      webAuthnAuthentication.resolve({
        token: ACCOUNT_A_TOKEN,
        user: ACCOUNT_A_USER,
      });
      await webAuthnAuthentication.promise;
    });

    // Then
    await waitFor(() =>
      expect(screen.getByTestId("webauthn-completion")).toHaveTextContent(
        "stale",
      ),
    );
    expectAuthenticationState(queryClient, {
      userId: ACCOUNT_B_USER.id,
      token: ACCOUNT_B_TOKEN,
      twoFactorPending: false,
      tempToken: "none",
      cacheOwnerId: ACCOUNT_B_USER.id,
    });
  });
});
