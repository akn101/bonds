import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api";
import { createDeferred } from "@/test/authCompletionTestSupport";
import {
  ACCOUNT_A_LOGIN,
  ACCOUNT_A_TOKEN,
  ACCOUNT_A_USER,
  ACCOUNT_B_LOGIN,
  ACCOUNT_B_TOKEN,
  ACCOUNT_B_USER,
  createAuthRaceQueryClient,
  expectAuthenticationState,
  renderAuthRaceHarness,
  seedSubjectCache,
} from "@/test/authProviderRaceHarness";
import {
  captureAuthenticationSubjectRevision,
  isAuthenticationSubjectRevisionCurrent,
} from "@/utils/authenticationSubjectRevision";

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

const ACCOUNT_A_LOGIN_RESPONSE = {
  data: {
    requires_two_factor: false,
    token: ACCOUNT_A_TOKEN,
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

describe("AuthProvider stale login completions", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    mockCurrentTokenValidation();
  });

  it("keeps login B when the older login A completes last", async () => {
    // Given
    const loginA = createDeferred<typeof ACCOUNT_A_LOGIN_RESPONSE>();
    const loginB = createDeferred<typeof ACCOUNT_B_LOGIN_RESPONSE>();
    vi.mocked(api.auth.loginCreate).mockImplementation((request) =>
      request.email === ACCOUNT_A_LOGIN.email ? loginA.promise : loginB.promise,
    );
    const queryClient = createAuthRaceQueryClient();
    const user = renderAuthRaceHarness(queryClient);

    // When
    await user.click(screen.getByRole("button", { name: "Start login A" }));
    await user.click(screen.getByRole("button", { name: "Start login B" }));
    expect(api.auth.loginCreate).toHaveBeenNthCalledWith(1, ACCOUNT_A_LOGIN);
    expect(api.auth.loginCreate).toHaveBeenNthCalledWith(2, ACCOUNT_B_LOGIN);
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
      loginA.resolve(ACCOUNT_A_LOGIN_RESPONSE);
      await loginA.promise;
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

  it("invalidates old-subject work when login B installs its subject", async () => {
    // Given
    localStorage.setItem("token", ACCOUNT_A_TOKEN);
    const loginB = createDeferred<typeof ACCOUNT_B_LOGIN_RESPONSE>();
    vi.mocked(api.auth.loginCreate).mockReturnValue(loginB.promise);
    const queryClient = createAuthRaceQueryClient();
    const user = renderAuthRaceHarness(queryClient);
    await waitFor(() =>
      expect(screen.getByTestId("auth-user-id")).toHaveTextContent(
        ACCOUNT_A_USER.id,
      ),
    );
    await user.click(screen.getByRole("button", { name: "Start login B" }));
    expect(api.auth.loginCreate).toHaveBeenCalledWith(ACCOUNT_B_LOGIN);
    const oldSubjectWorkRevision = captureAuthenticationSubjectRevision();

    // When
    await act(async () => {
      loginB.resolve(ACCOUNT_B_LOGIN_RESPONSE);
      await loginB.promise;
      await Promise.resolve();
    });

    // Then
    await waitFor(() =>
      expect(screen.getByTestId("auth-user-id")).toHaveTextContent(
        ACCOUNT_B_USER.id,
      ),
    );
    expect(isAuthenticationSubjectRevisionCurrent(oldSubjectWorkRevision)).toBe(
      false,
    );
  });

  it("does not restore login A after logout completes the newer boundary", async () => {
    // Given
    localStorage.setItem("token", ACCOUNT_B_TOKEN);
    const loginA = createDeferred<typeof ACCOUNT_A_LOGIN_RESPONSE>();
    vi.mocked(api.auth.loginCreate).mockReturnValue(loginA.promise);
    const queryClient = createAuthRaceQueryClient();
    const user = renderAuthRaceHarness(queryClient);
    await waitFor(() =>
      expect(screen.getByTestId("auth-user-id")).toHaveTextContent(
        ACCOUNT_B_USER.id,
      ),
    );
    seedSubjectCache(queryClient, ACCOUNT_B_USER.id);
    await user.click(screen.getByRole("button", { name: "Start login A" }));
    expect(api.auth.loginCreate).toHaveBeenCalledWith(ACCOUNT_A_LOGIN);

    // When
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expectAuthenticationState(queryClient, {
      userId: "none",
      token: "none",
      twoFactorPending: false,
      tempToken: "none",
      cacheOwnerId: null,
    });
    await act(async () => {
      loginA.resolve(ACCOUNT_A_LOGIN_RESPONSE);
      await loginA.promise;
      await Promise.resolve();
    });

    // Then
    expectAuthenticationState(queryClient, {
      userId: "none",
      token: "none",
      twoFactorPending: false,
      tempToken: "none",
      cacheOwnerId: null,
    });
  });

  it("keeps externally validated account B when login A completes last", async () => {
    // Given
    const loginA = createDeferred<typeof ACCOUNT_A_LOGIN_RESPONSE>();
    const externalValidation = createDeferred<typeof ACCOUNT_B_USER_RESPONSE>();
    vi.mocked(api.auth.loginCreate).mockReturnValue(loginA.promise);
    vi.mocked(api.auth.getAuth).mockReturnValue(externalValidation.promise);
    const queryClient = createAuthRaceQueryClient();
    const user = renderAuthRaceHarness(queryClient);
    await user.click(screen.getByRole("button", { name: "Start login A" }));
    expect(api.auth.loginCreate).toHaveBeenCalledWith(ACCOUNT_A_LOGIN);

    // When
    await user.click(
      screen.getByRole("button", { name: "Install external account B" }),
    );
    expect(localStorage.getItem("token")).toBe(ACCOUNT_B_TOKEN);
    expect(api.auth.getAuth).toHaveBeenCalledTimes(1);
    await act(async () => {
      externalValidation.resolve(ACCOUNT_B_USER_RESPONSE);
      await externalValidation.promise;
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("auth-user-id")).toHaveTextContent(
        ACCOUNT_B_USER.id,
      ),
    );
    seedSubjectCache(queryClient, ACCOUNT_B_USER.id);
    await act(async () => {
      loginA.resolve(ACCOUNT_A_LOGIN_RESPONSE);
      await loginA.promise;
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
