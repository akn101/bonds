import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api";
import { createDeferred } from "@/test/authCompletionTestSupport";
import {
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

const ACCOUNT_A_USER_RESPONSE = {
  data: ACCOUNT_A_USER,
} satisfies Awaited<ReturnType<typeof api.auth.getAuth>>;
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

describe("initial authentication validation ownership", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
  });

  it.each([
    {
      name: "success",
      settle: async (
        validation: ReturnType<
          typeof createDeferred<typeof ACCOUNT_A_USER_RESPONSE>
        >,
      ) => {
        validation.resolve(ACCOUNT_A_USER_RESPONSE);
        await validation.promise;
      },
    },
    {
      name: "rejection",
      settle: async (
        validation: ReturnType<
          typeof createDeferred<typeof ACCOUNT_A_USER_RESPONSE>
        >,
      ) => {
        validation.reject(new Error("old token rejected"));
        await validation.promise.catch(() => undefined);
      },
    },
  ])(
    "keeps login B when the stale initial validation finishes with $name",
    async ({ settle }) => {
      // Given
      localStorage.setItem("token", ACCOUNT_A_TOKEN);
      const initialValidation =
        createDeferred<typeof ACCOUNT_A_USER_RESPONSE>();
      vi.mocked(api.auth.getAuth)
        .mockReturnValueOnce(initialValidation.promise)
        .mockResolvedValueOnce(ACCOUNT_B_USER_RESPONSE);
      vi.mocked(api.auth.loginCreate).mockResolvedValue(
        ACCOUNT_B_LOGIN_RESPONSE,
      );
      const queryClient = createAuthRaceQueryClient();
      const user = renderAuthRaceHarness(queryClient);
      await waitFor(() => expect(api.auth.getAuth).toHaveBeenCalledTimes(1));

      // When
      await user.click(screen.getByRole("button", { name: "Start login B" }));
      expect(api.auth.loginCreate).toHaveBeenCalledWith(ACCOUNT_B_LOGIN);
      await waitFor(() =>
        expect(screen.getByTestId("auth-user-id")).toHaveTextContent(
          ACCOUNT_B_USER.id,
        ),
      );
      seedSubjectCache(queryClient, ACCOUNT_B_USER.id);
      await act(async () => {
        await settle(initialValidation);
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
    },
  );
});
