import { useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { api } from "@/api";
import type { LoginRequest, User } from "@/api";
import { AuthProvider, useAuth } from "@/stores/auth";
import { terminateCurrentAuthenticationSubject } from "@/utils/authenticationSubjectRevision";

vi.mock("@/api", () => ({
  api: {
    auth: {
      getAuth: vi.fn(),
      loginCreate: vi.fn(),
      "2FaVerifyCreate": vi.fn(),
    },
  },
}));

const OLD_TOKEN = "old-account-token";
const NEW_TOKEN = "replacement-account-token";
const OLD_USER = { id: "old-user-id" } satisfies User;
const NEW_USER = { id: "new-user-id" } satisfies User;
const OLD_USER_RESPONSE = {
  data: OLD_USER,
} satisfies Awaited<ReturnType<typeof api.auth.getAuth>>;
const NEW_USER_RESPONSE = {
  data: NEW_USER,
} satisfies Awaited<ReturnType<typeof api.auth.getAuth>>;
const ACTIVE_QUERY_KEY = ["vaults", "list"] as const;
const INACTIVE_QUERY_KEY = ["preferences", "current"] as const;
const OLD_ACTIVE_DATA = {
  ownerId: OLD_USER.id,
  vaultId: "old-vault-id",
} as const;
const OLD_INACTIVE_DATA = { ownerId: OLD_USER.id, locale: "en" } as const;
const NEW_ACTIVE_DATA = {
  ownerId: NEW_USER.id,
  vaultId: "new-vault-id",
} as const;
const ACCOUNT_A_TEMP_TOKEN = "account-a-pending-token";
const ACCOUNT_A_FULL_TOKEN = "account-a-full-token";
const VERIFY_CODE = "123456";
const ACCOUNT_A_LOGIN = {
  email: "account-a@example.com",
  password: "account-a-password",
} satisfies LoginRequest;
const ACCOUNT_B_LOGIN = {
  email: "account-b@example.com",
  password: "account-b-password",
} satisfies LoginRequest;
const ACCOUNT_A_PENDING_RESPONSE = {
  data: {
    requires_two_factor: true,
    temp_token: ACCOUNT_A_TEMP_TOKEN,
    user: OLD_USER,
  },
} satisfies Awaited<ReturnType<typeof api.auth.loginCreate>>;
const ACCOUNT_B_LOGIN_RESPONSE = {
  data: {
    requires_two_factor: false,
    token: NEW_TOKEN,
    user: NEW_USER,
  },
} satisfies Awaited<ReturnType<typeof api.auth.loginCreate>>;
const ACCOUNT_A_VERIFY_RESPONSE = {
  data: { token: ACCOUNT_A_FULL_TOKEN, user: OLD_USER },
} satisfies Awaited<ReturnType<(typeof api.auth)["2FaVerifyCreate"]>>;

type Deferred<Value> = {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
};

function createDeferred<Value>(): Deferred<Value> {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  if (resolvePromise === undefined) {
    throw new Error("deferred promise did not expose its resolver");
  }
  return { promise, resolve: resolvePromise };
}

function AuthBoundaryConsumer() {
  const {
    user,
    token,
    isLoading,
    twoFactorPending,
    login,
    logout,
    setExternalToken,
    verifyTwoFactor,
  } = useAuth();
  const [verificationResult, setVerificationResult] = useState<
    "idle" | "pending" | "resolved" | "rejected"
  >("idle");

  const verifyPendingChallenge = () => {
    setVerificationResult("pending");
    void verifyTwoFactor(VERIFY_CODE).then(
      () => setVerificationResult("resolved"),
      () => setVerificationResult("rejected"),
    );
  };

  return (
    <>
      <output data-testid="auth-user-id">{user?.id ?? "none"}</output>
      <output data-testid="auth-token">{token ?? "none"}</output>
      <output data-testid="auth-loading">{String(isLoading)}</output>
      <output data-testid="two-factor-pending">
        {String(twoFactorPending)}
      </output>
      <output data-testid="verification-result">{verificationResult}</output>
      <button type="button" onClick={logout}>
        Log out
      </button>
      <button type="button" onClick={() => setExternalToken(NEW_TOKEN)}>
        Replace account
      </button>
      <button type="button" onClick={() => setExternalToken(OLD_TOKEN)}>
        Reapply current token
      </button>
      <button type="button" onClick={() => void login(ACCOUNT_A_LOGIN)}>
        Start account A challenge
      </button>
      <button type="button" onClick={() => void login(ACCOUNT_B_LOGIN)}>
        Log in account B
      </button>
      <button type="button" onClick={verifyPendingChallenge}>
        Verify pending challenge
      </button>
    </>
  );
}

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
}

function seedOldAccountCache(queryClient: QueryClient): () => void {
  queryClient.setQueryData(ACTIVE_QUERY_KEY, OLD_ACTIVE_DATA);
  queryClient.setQueryData(INACTIVE_QUERY_KEY, OLD_INACTIVE_DATA);
  const activeObserver = new QueryObserver(queryClient, {
    queryKey: ACTIVE_QUERY_KEY,
    queryFn: async () => OLD_ACTIVE_DATA,
    staleTime: Infinity,
  });
  const unsubscribe = activeObserver.subscribe(() => undefined);
  queryClient.getMutationCache().build(queryClient, {
    mutationKey: ["contacts", "create"],
    mutationFn: async () => "old-account-mutation",
  });

  expect(activeObserver.getCurrentResult().data).toEqual(OLD_ACTIVE_DATA);
  expect(queryClient.getQueryCache().getAll()).toHaveLength(2);
  expect(queryClient.getMutationCache().getAll()).toHaveLength(1);
  return unsubscribe;
}

function renderAuthProvider(queryClient: QueryClient): void {
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthBoundaryConsumer />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function expectAccountCacheRemoved(queryClient: QueryClient): void {
  expect
    .soft(
      queryClient.getQueryCache().getAll(),
      "authentication boundary must remove every old-account query",
    )
    .toHaveLength(0);
  expect
    .soft(
      queryClient.getMutationCache().getAll(),
      "authentication boundary must remove every old-account mutation",
    )
    .toHaveLength(0);

  const replacementObserver = new QueryObserver(queryClient, {
    queryKey: ACTIVE_QUERY_KEY,
    queryFn: async () => NEW_ACTIVE_DATA,
    staleTime: Infinity,
  });
  const unsubscribe = replacementObserver.subscribe(() => undefined);
  expect
    .soft(
      replacementObserver.getCurrentResult().data,
      "a new subject observer must not receive the previous subject's data",
    )
    .toBeUndefined();
  unsubscribe();
}

describe("AuthProvider account-boundary query cache isolation", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
  });

  it("removes old-account queries and mutations when manual logout terminates the subject", async () => {
    // Given
    localStorage.setItem("token", OLD_TOKEN);
    vi.mocked(api.auth.getAuth).mockResolvedValue(OLD_USER_RESPONSE);
    const queryClient = createTestQueryClient();
    const clearAuthenticationCache = vi.spyOn(queryClient, "clear");
    onTestFinished(seedOldAccountCache(queryClient));
    const user = userEvent.setup();
    renderAuthProvider(queryClient);
    await waitFor(() =>
      expect(screen.getByTestId("auth-user-id")).toHaveTextContent(OLD_USER.id),
    );

    // When
    await user.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => {
      expect(screen.getByTestId("auth-user-id")).toHaveTextContent("none");
      expect(screen.getByTestId("auth-token")).toHaveTextContent("none");
    });

    // Then
    expect(localStorage.getItem("token")).toBeNull();
    expect(clearAuthenticationCache).toHaveBeenCalledTimes(1);
    expectAccountCacheRemoved(queryClient);
  });

  it("removes old-account queries and mutations when initial token validation rejects", async () => {
    // Given
    localStorage.setItem("token", OLD_TOKEN);
    vi.mocked(api.auth.getAuth).mockRejectedValue(new Error("token rejected"));
    const queryClient = createTestQueryClient();
    onTestFinished(seedOldAccountCache(queryClient));

    // When
    renderAuthProvider(queryClient);
    await waitFor(() => {
      expect(screen.getByTestId("auth-loading")).toHaveTextContent("false");
      expect(screen.getByTestId("auth-token")).toHaveTextContent("none");
    });

    // Then
    expect(screen.getByTestId("auth-user-id")).toHaveTextContent("none");
    expect(localStorage.getItem("token")).toBeNull();
    expectAccountCacheRemoved(queryClient);
  });

  it("removes old-account queries and mutations when the current token is terminally invalidated", async () => {
    // Given
    localStorage.setItem("token", OLD_TOKEN);
    vi.mocked(api.auth.getAuth).mockResolvedValue(OLD_USER_RESPONSE);
    const queryClient = createTestQueryClient();
    onTestFinished(seedOldAccountCache(queryClient));
    renderAuthProvider(queryClient);
    await waitFor(() =>
      expect(screen.getByTestId("auth-user-id")).toHaveTextContent(OLD_USER.id),
    );

    // When
    act(() => terminateCurrentAuthenticationSubject());

    // Then
    await waitFor(() => {
      expect(screen.getByTestId("auth-user-id")).toHaveTextContent("none");
      expect(screen.getByTestId("auth-token")).toHaveTextContent("none");
    });
    expect(localStorage.getItem("token")).toBeNull();
    expectAccountCacheRemoved(queryClient);
  });

  it("retires the old subject and cache while an external replacement token validates", async () => {
    // Given
    localStorage.setItem("token", OLD_TOKEN);
    const replacementValidation =
      createDeferred<Awaited<ReturnType<typeof api.auth.getAuth>>>();
    vi.mocked(api.auth.getAuth)
      .mockResolvedValueOnce(OLD_USER_RESPONSE)
      .mockReturnValueOnce(replacementValidation.promise);
    const queryClient = createTestQueryClient();
    onTestFinished(seedOldAccountCache(queryClient));
    const user = userEvent.setup();
    renderAuthProvider(queryClient);
    await waitFor(() =>
      expect(screen.getByTestId("auth-user-id")).toHaveTextContent(OLD_USER.id),
    );

    // When
    await user.click(screen.getByRole("button", { name: "Replace account" }));
    await waitFor(() => {
      expect(api.auth.getAuth).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("auth-token")).toHaveTextContent(NEW_TOKEN);
      expect(screen.getByTestId("auth-loading")).toHaveTextContent("true");
    });

    // Then
    expect(localStorage.getItem("token")).toBe(NEW_TOKEN);
    expect
      .soft(
        screen.getByTestId("auth-user-id"),
        "the old authenticated subject must disappear before replacement validation completes",
      )
      .not.toHaveTextContent(OLD_USER.id);
    expectAccountCacheRemoved(queryClient);

    await act(async () => {
      replacementValidation.resolve(NEW_USER_RESPONSE);
      await replacementValidation.promise;
    });
    await waitFor(() =>
      expect(screen.getByTestId("auth-user-id")).toHaveTextContent(NEW_USER.id),
    );
  });

  it("retires account A's pending 2FA challenge when account B completes a normal login", async () => {
    // Given
    vi.mocked(api.auth.loginCreate)
      .mockResolvedValueOnce(ACCOUNT_A_PENDING_RESPONSE)
      .mockResolvedValueOnce(ACCOUNT_B_LOGIN_RESPONSE);
    vi.mocked(api.auth.getAuth).mockResolvedValue(NEW_USER_RESPONSE);
    vi.mocked(api.auth["2FaVerifyCreate"]).mockResolvedValue(
      ACCOUNT_A_VERIFY_RESPONSE,
    );
    const queryClient = createTestQueryClient();
    onTestFinished(() => queryClient.clear());
    const user = userEvent.setup();
    renderAuthProvider(queryClient);
    await user.click(
      screen.getByRole("button", { name: "Start account A challenge" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("auth-user-id")).toHaveTextContent(OLD_USER.id);
      expect(screen.getByTestId("two-factor-pending")).toHaveTextContent(
        "true",
      );
    });

    // When
    await user.click(screen.getByRole("button", { name: "Log in account B" }));
    await waitFor(() => {
      expect(screen.getByTestId("auth-user-id")).toHaveTextContent(NEW_USER.id);
      expect(screen.getByTestId("auth-token")).toHaveTextContent(NEW_TOKEN);
    });

    // Then
    expect
      .soft(screen.getByTestId("two-factor-pending"))
      .toHaveTextContent("false");
    await user.click(
      screen.getByRole("button", { name: "Verify pending challenge" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("verification-result")).not.toHaveTextContent(
        "pending",
      ),
    );
    expect
      .soft(screen.getByTestId("verification-result"))
      .toHaveTextContent("rejected");
    expect.soft(api.auth["2FaVerifyCreate"]).not.toHaveBeenCalledWith({
      code: VERIFY_CODE,
      temp_token: ACCOUNT_A_TEMP_TOKEN,
    });
    expect
      .soft(screen.getByTestId("auth-user-id"))
      .toHaveTextContent(NEW_USER.id);
    expect.soft(screen.getByTestId("auth-token")).toHaveTextContent(NEW_TOKEN);
  });

  it("preserves the current subject and cache when the external token matches the active token", async () => {
    // Given
    localStorage.setItem("token", OLD_TOKEN);
    vi.mocked(api.auth.getAuth).mockResolvedValue(OLD_USER_RESPONSE);
    const queryClient = createTestQueryClient();
    onTestFinished(seedOldAccountCache(queryClient));
    const user = userEvent.setup();
    renderAuthProvider(queryClient);
    await waitFor(() => {
      expect(screen.getByTestId("auth-user-id")).toHaveTextContent(OLD_USER.id);
      expect(screen.getByTestId("auth-loading")).toHaveTextContent("false");
    });
    expect(api.auth.getAuth).toHaveBeenCalledTimes(1);

    // When
    await user.click(
      screen.getByRole("button", { name: "Reapply current token" }),
    );

    // Then
    expect.soft(api.auth.getAuth).toHaveBeenCalledTimes(1);
    expect
      .soft(screen.getByTestId("auth-user-id"))
      .toHaveTextContent(OLD_USER.id);
    expect.soft(screen.getByTestId("auth-token")).toHaveTextContent(OLD_TOKEN);
    expect.soft(screen.getByTestId("auth-loading")).toHaveTextContent("false");
    expect
      .soft(queryClient.getQueryData(ACTIVE_QUERY_KEY))
      .toEqual(OLD_ACTIVE_DATA);
    expect
      .soft(queryClient.getQueryData(INACTIVE_QUERY_KEY))
      .toEqual(OLD_INACTIVE_DATA);
    expect.soft(queryClient.getQueryCache().getAll()).toHaveLength(2);
    expect.soft(queryClient.getMutationCache().getAll()).toHaveLength(1);
  });
});
