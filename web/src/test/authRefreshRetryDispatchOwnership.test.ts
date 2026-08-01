import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";
import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { httpClient } from "@/api";
import { createDeferred } from "@/test/authCompletionTestSupport";
import {
  createAuthRaceQueryClient,
  expectAuthenticationState,
  renderAuthRaceHarness,
  seedSubjectCache,
} from "@/test/authProviderRaceHarness";
import {
  ACCOUNT_A_USER,
  ACCOUNT_B_TOKEN,
  ACCOUNT_B_USER,
} from "@/test/authRaceFixtures";
import {
  createAxiosResponse,
  createUnauthorizedAxiosError,
} from "@/test/authRefreshTestSupport";
import {
  captureAuthenticationSubjectRevision,
  isAuthenticationSubjectRevisionCurrent,
} from "@/utils/authenticationSubjectRevision";

const STARTING_TOKEN = "refresh-starting-token";
const ROTATED_TOKEN = "refresh-rotated-token";

describe("authentication refresh retry dispatch ownership", () => {
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

  it("does not rebind a refreshed retry when the subject changes before adapter dispatch", async () => {
    // Given
    localStorage.setItem("token", STARTING_TOKEN);
    const retryInterceptorStarted = createDeferred<void>();
    const releaseRetryInterceptor = createDeferred<void>();
    const refreshRequestStarted = createDeferred<InternalAxiosRequestConfig>();
    let refreshRequestCount = 0;
    let protectedRequestInterceptorCount = 0;
    let protectedRequestCount = 0;
    let protectedRetryAdapterCallCount = 0;
    const adapter: AxiosAdapter = async (config) => {
      if (config.url === "/auth/me") {
        const token = config.headers.get("Authorization");
        return createAxiosResponse(config, {
          data:
            token === `Bearer ${ACCOUNT_B_TOKEN}`
              ? ACCOUNT_B_USER
              : ACCOUNT_A_USER,
        });
      }
      if (config.url === "/auth/refresh") {
        refreshRequestCount += 1;
        refreshRequestStarted.resolve(config);
        return createAxiosResponse(config, {
          data: { token: ROTATED_TOKEN },
        });
      }
      protectedRequestCount += 1;
      if (protectedRequestCount === 1) {
        throw createUnauthorizedAxiosError(config);
      }
      protectedRetryAdapterCallCount += 1;
      throw createUnauthorizedAxiosError(config);
    };
    httpClient.instance.defaults.adapter = adapter;
    const retryInterceptorId = httpClient.instance.interceptors.request.use(
      async (config) => {
        if (config.url === "/protected") {
          protectedRequestInterceptorCount += 1;
        }
        if (
          config.url === "/protected" &&
          protectedRequestInterceptorCount === 2
        ) {
          retryInterceptorStarted.resolve(undefined);
          await releaseRetryInterceptor.promise;
        }
        return config;
      },
    );
    try {
      const queryClient = createAuthRaceQueryClient();
      const user = renderAuthRaceHarness(queryClient);
      await waitFor(() =>
        expect(screen.getByTestId("auth-user-id")).toHaveTextContent(
          ACCOUNT_A_USER.id,
        ),
      );
      const request = httpClient.instance.get("/protected");
      const settledRequest = request.catch(() => undefined);
      await retryInterceptorStarted.promise;
      const refreshRequestConfig = await refreshRequestStarted.promise;
      expect(refreshRequestConfig.headers.get("Authorization")).toBe(
        `Bearer ${STARTING_TOKEN}`,
      );
      await user.click(
        screen.getByRole("button", { name: "Install external account B" }),
      );
      await waitFor(() => {
        expect(screen.getByTestId("auth-user-id")).toHaveTextContent(
          ACCOUNT_B_USER.id,
        );
        expect(screen.getByTestId("auth-loading")).toHaveTextContent("false");
      });
      seedSubjectCache(queryClient, ACCOUNT_B_USER.id);
      const accountBRevision = captureAuthenticationSubjectRevision();
      const accountBLocation = window.location.href;

      // When
      await act(async () => {
        releaseRetryInterceptor.resolve(undefined);
        await settledRequest;
      });

      // Then
      expect(protectedRetryAdapterCallCount).toBe(0);
      expect(refreshRequestCount).toBe(1);
      expect(isAuthenticationSubjectRevisionCurrent(accountBRevision)).toBe(
        true,
      );
      expectAuthenticationState(queryClient, {
        userId: ACCOUNT_B_USER.id,
        token: ACCOUNT_B_TOKEN,
        isLoading: false,
        twoFactorPending: false,
        tempToken: "none",
        cacheOwnerId: ACCOUNT_B_USER.id,
      });
      expect(window.location.href).toBe(accountBLocation);
    } finally {
      act(() => releaseRetryInterceptor.resolve(undefined));
      httpClient.instance.interceptors.request.eject(retryInterceptorId);
    }
  });
});
