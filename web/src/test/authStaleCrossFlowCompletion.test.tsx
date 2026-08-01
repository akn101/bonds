import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api";
import { createDeferred } from "@/test/authCompletionTestSupport";
import {
  ACCOUNT_A_FULL_TOKEN,
  ACCOUNT_A_LOGIN,
  ACCOUNT_A_REGISTRATION,
  ACCOUNT_A_TEMP_TOKEN,
  ACCOUNT_A_TOKEN,
  ACCOUNT_A_USER,
  ACCOUNT_B_LOGIN,
  ACCOUNT_B_TOKEN,
  ACCOUNT_B_USER,
  VERIFY_CODE,
  createAuthRaceQueryClient,
  expectAuthenticationState,
  renderAuthRaceHarness,
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

const ACCOUNT_A_PENDING_RESPONSE = {
  data: {
    requires_two_factor: true,
    temp_token: ACCOUNT_A_TEMP_TOKEN,
    user: ACCOUNT_A_USER,
  },
} satisfies Awaited<ReturnType<typeof api.auth.loginCreate>>;
const ACCOUNT_B_LOGIN_RESPONSE = {
  data: {
    requires_two_factor: false,
    token: ACCOUNT_B_TOKEN,
    user: ACCOUNT_B_USER,
  },
} satisfies Awaited<ReturnType<typeof api.auth.loginCreate>>;
const ACCOUNT_A_VERIFY_RESPONSE = {
  data: { token: ACCOUNT_A_FULL_TOKEN, user: ACCOUNT_A_USER },
} satisfies Awaited<ReturnType<(typeof api.auth)["2FaVerifyCreate"]>>;
const ACCOUNT_A_REGISTRATION_RESPONSE = {
  data: { token: ACCOUNT_A_TOKEN, user: ACCOUNT_A_USER },
} satisfies Awaited<ReturnType<typeof api.auth.registerCreate>>;
const ACCOUNT_A_USER_RESPONSE = {
  data: ACCOUNT_A_USER,
} satisfies Awaited<ReturnType<typeof api.auth.getAuth>>;
const ACCOUNT_B_USER_RESPONSE = {
  data: ACCOUNT_B_USER,
} satisfies Awaited<ReturnType<typeof api.auth.getAuth>>;

function mockCurrentTokenValidation(): void {
  vi.mocked(api.auth.getAuth).mockImplementation(async () =>
    localStorage.getItem("token") === ACCOUNT_B_TOKEN
      ? ACCOUNT_B_USER_RESPONSE
      : ACCOUNT_A_USER_RESPONSE,
  );
}

describe("AuthProvider stale cross-flow completions", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    mockCurrentTokenValidation();
  });

  it("keeps login B when account A 2FA verification was already in flight", async () => {
    // Given
    const verificationA = createDeferred<typeof ACCOUNT_A_VERIFY_RESPONSE>();
    const loginB = createDeferred<typeof ACCOUNT_B_LOGIN_RESPONSE>();
    vi.mocked(api.auth.loginCreate).mockImplementation((request) =>
      request.email === ACCOUNT_A_LOGIN.email
        ? Promise.resolve(ACCOUNT_A_PENDING_RESPONSE)
        : loginB.promise,
    );
    vi.mocked(api.auth["2FaVerifyCreate"]).mockReturnValue(
      verificationA.promise,
    );
    const queryClient = createAuthRaceQueryClient();
    const user = renderAuthRaceHarness(queryClient);
    await user.click(screen.getByRole("button", { name: "Start login A" }));
    await waitFor(() => {
      expect(screen.getByTestId("two-factor-pending")).toHaveTextContent(
        "true",
      );
      expect(screen.getByTestId("temp-token")).toHaveTextContent(
        ACCOUNT_A_TEMP_TOKEN,
      );
    });
    await user.click(screen.getByRole("button", { name: "Verify account A" }));
    expect(api.auth["2FaVerifyCreate"]).toHaveBeenCalledWith({
      temp_token: ACCOUNT_A_TEMP_TOKEN,
      code: VERIFY_CODE,
    });

    // When
    await user.click(screen.getByRole("button", { name: "Start login B" }));
    expect(api.auth.loginCreate).toHaveBeenLastCalledWith(ACCOUNT_B_LOGIN);
    await act(async () => {
      loginB.resolve(ACCOUNT_B_LOGIN_RESPONSE);
      await loginB.promise;
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("auth-user-id")).toHaveTextContent(
        ACCOUNT_B_USER.id,
      ),
    );
    seedSubjectCache(queryClient, ACCOUNT_B_USER.id);
    await act(async () => {
      verificationA.resolve(ACCOUNT_A_VERIFY_RESPONSE);
      await verificationA.promise;
      await Promise.resolve();
    });

    // Then
    expectAuthenticationState(queryClient, {
      userId: ACCOUNT_B_USER.id,
      token: ACCOUNT_B_TOKEN,
      twoFactorPending: false,
      tempToken: "none",
      cacheOwnerId: ACCOUNT_B_USER.id,
    });
  });

  it("keeps login B when the older registration A completes last", async () => {
    // Given
    const registrationA =
      createDeferred<typeof ACCOUNT_A_REGISTRATION_RESPONSE>();
    const loginB = createDeferred<typeof ACCOUNT_B_LOGIN_RESPONSE>();
    vi.mocked(api.auth.registerCreate).mockReturnValue(registrationA.promise);
    vi.mocked(api.auth.loginCreate).mockReturnValue(loginB.promise);
    const queryClient = createAuthRaceQueryClient();
    const user = renderAuthRaceHarness(queryClient);
    await user.click(
      screen.getByRole("button", { name: "Start registration A" }),
    );
    expect(api.auth.registerCreate).toHaveBeenCalledWith(
      ACCOUNT_A_REGISTRATION,
    );
    await user.click(screen.getByRole("button", { name: "Start login B" }));
    expect(api.auth.loginCreate).toHaveBeenCalledWith(ACCOUNT_B_LOGIN);

    // When
    await act(async () => {
      loginB.resolve(ACCOUNT_B_LOGIN_RESPONSE);
      await loginB.promise;
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("auth-user-id")).toHaveTextContent(
        ACCOUNT_B_USER.id,
      ),
    );
    seedSubjectCache(queryClient, ACCOUNT_B_USER.id);
    await act(async () => {
      registrationA.resolve(ACCOUNT_A_REGISTRATION_RESPONSE);
      await registrationA.promise;
      await Promise.resolve();
    });

    // Then
    expectAuthenticationState(queryClient, {
      userId: ACCOUNT_B_USER.id,
      token: ACCOUNT_B_TOKEN,
      twoFactorPending: false,
      tempToken: "none",
      cacheOwnerId: ACCOUNT_B_USER.id,
    });
  });
});
