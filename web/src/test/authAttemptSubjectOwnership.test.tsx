import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api";
import { createDeferred } from "@/test/authCompletionTestSupport";
import {
  ACCOUNT_A_TEMP_TOKEN,
  ACCOUNT_A_TOKEN,
  ACCOUNT_A_USER,
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

const ACCOUNT_B_USER_RESPONSE = {
  data: ACCOUNT_B_USER,
} satisfies Awaited<ReturnType<typeof api.auth.getAuth>>;
const ACCOUNT_A_PENDING_RESPONSE = {
  data: {
    requires_two_factor: true,
    temp_token: ACCOUNT_A_TEMP_TOKEN,
    user: ACCOUNT_A_USER,
  },
} satisfies Awaited<ReturnType<typeof api.auth.loginCreate>>;

async function renderCommittedAccountB() {
  localStorage.setItem("token", ACCOUNT_B_TOKEN);
  vi.mocked(api.auth.getAuth).mockResolvedValue(ACCOUNT_B_USER_RESPONSE);
  const queryClient = createAuthRaceQueryClient();
  const user = renderAuthRaceHarness(queryClient);
  await waitFor(() =>
    expect(screen.getByTestId("auth-user-id")).toHaveTextContent(
      ACCOUNT_B_USER.id,
    ),
  );
  seedSubjectCache(queryClient, ACCOUNT_B_USER.id);
  return { queryClient, user };
}

describe("authentication attempt ownership", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
  });

  it.each([
    {
      name: "login",
      buttonName: "Start login A",
      installFailure: () => {
        const completion = createDeferred<
          Awaited<ReturnType<typeof api.auth.loginCreate>>
        >();
        vi.mocked(api.auth.loginCreate).mockReturnValue(completion.promise);
        return completion;
      },
    },
    {
      name: "registration",
      buttonName: "Start registration A",
      installFailure: () => {
        const completion = createDeferred<
          Awaited<ReturnType<typeof api.auth.registerCreate>>
        >();
        vi.mocked(api.auth.registerCreate).mockReturnValue(completion.promise);
        return completion;
      },
    },
  ])(
    "keeps the committed subject revision and cache when the current $name attempt fails",
    async ({ buttonName, installFailure }) => {
      // Given
      const failure = installFailure();
      const { queryClient, user } = await renderCommittedAccountB();
      const committedRevision = captureAuthenticationSubjectRevision();
      await user.click(screen.getByRole("button", { name: buttonName }));

      // When
      await act(async () => {
        failure.reject(new Error("authentication rejected"));
        await failure.promise.catch(() => undefined);
      });
      await waitFor(() =>
        expect(screen.getByTestId("auth-operation-result")).toHaveTextContent(
          "rejected",
        ),
      );

      // Then
      expect(isAuthenticationSubjectRevisionCurrent(committedRevision)).toBe(
        true,
      );
      expectAuthenticationState(queryClient, {
        userId: ACCOUNT_B_USER.id,
        token: ACCOUNT_B_TOKEN,
        twoFactorPending: false,
        tempToken: "none",
        cacheOwnerId: ACCOUNT_B_USER.id,
      });
    },
  );

  it("keeps the pending challenge subject revision and cache when current 2FA verification fails", async () => {
    // Given
    vi.mocked(api.auth.loginCreate).mockResolvedValue(
      ACCOUNT_A_PENDING_RESPONSE,
    );
    const verification = createDeferred<
      Awaited<ReturnType<(typeof api.auth)["2FaVerifyCreate"]>>
    >();
    vi.mocked(api.auth["2FaVerifyCreate"]).mockReturnValue(
      verification.promise,
    );
    const queryClient = createAuthRaceQueryClient();
    const user = renderAuthRaceHarness(queryClient);
    await user.click(screen.getByRole("button", { name: "Start login A" }));
    await waitFor(() =>
      expect(screen.getByTestId("two-factor-pending")).toHaveTextContent("true"),
    );
    seedSubjectCache(queryClient, ACCOUNT_A_USER.id);
    const challengeRevision = captureAuthenticationSubjectRevision();
    await user.click(screen.getByRole("button", { name: "Verify account A" }));

    // When
    await act(async () => {
      verification.reject(new Error("verification rejected"));
      await verification.promise.catch(() => undefined);
    });
    await waitFor(() =>
      expect(screen.getByTestId("auth-operation-result")).toHaveTextContent(
        "rejected",
      ),
    );

    // Then
    expect(isAuthenticationSubjectRevisionCurrent(challengeRevision)).toBe(true);
    expectAuthenticationState(queryClient, {
      userId: ACCOUNT_A_USER.id,
      token: "none",
      twoFactorPending: true,
      tempToken: ACCOUNT_A_TEMP_TOKEN,
      cacheOwnerId: ACCOUNT_A_USER.id,
    });
    expect(localStorage.getItem("token")).not.toBe(ACCOUNT_A_TOKEN);
  });
});
