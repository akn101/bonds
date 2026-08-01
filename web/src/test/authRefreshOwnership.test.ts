import { AuthenticationRequestOwnership } from "@/api/authenticationRequestOwnership";
import type {
  AxiosAdapter,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { httpClient } from "@/api";
import { createDeferred } from "@/test/authCompletionTestSupport";
import {
  createAuthRaceQueryClient,
  renderAuthRaceHarness,
} from "@/test/authProviderRaceHarness";
import { ACCOUNT_B_TOKEN } from "@/test/authRaceFixtures";
import {
  advanceAuthenticationSubjectRevision,
  captureAuthenticationSubjectRevision,
  isAuthenticationSubjectRevisionCurrent,
} from "@/utils/authenticationSubjectRevision";
import {
  createAxiosResponse,
  createUnauthorizedAxiosError,
} from "@/test/authRefreshTestSupport";

const STARTING_TOKEN = "refresh-starting-token";
const ROTATED_TOKEN = "refresh-rotated-token";
const NEW_SUBJECT_TOKEN = "new-subject-token";

function installRefreshAdapter() {
  const refreshStarted = createDeferred<void>();
  const refreshCompletion =
    createDeferred<AxiosResponse<{ data: { token: string } }>>();
  let refreshRequestConfig: InternalAxiosRequestConfig | null = null;
  let protectedRequestCount = 0;
  const protectedRequestAuthorizations: unknown[] = [];
  const protectedRequestOwnerships: InternalAxiosRequestConfig["authenticationOwnership"][] =
    [];
  const adapter: AxiosAdapter = async (config) => {
    if (config.url === "/auth/refresh") {
      refreshRequestConfig = config;
      refreshStarted.resolve(undefined);
      return refreshCompletion.promise;
    }
    protectedRequestCount += 1;
    protectedRequestAuthorizations.push(config.headers.get("Authorization"));
    protectedRequestOwnerships.push(config.authenticationOwnership);
    if (protectedRequestCount === 1) {
      throw createUnauthorizedAxiosError(config);
    }
    return createAxiosResponse(config, { owner: "current-subject" });
  };
  httpClient.instance.defaults.adapter = adapter;
  return {
    refreshStarted,
    resolveRefresh: (token: string) => {
      if (refreshRequestConfig === null) {
        throw new Error("expected the refresh request to start");
      }
      refreshCompletion.resolve(
        createAxiosResponse(refreshRequestConfig, { data: { token } }),
      );
    },
    rejectRefresh: () => {
      if (refreshRequestConfig === null) {
        throw new Error("expected the refresh request to start");
      }
      refreshCompletion.reject(
        createUnauthorizedAxiosError(refreshRequestConfig),
      );
    },
    getProtectedRequestAuthorizations: () => protectedRequestAuthorizations,
    getProtectedRequestOwnerships: () => protectedRequestOwnerships,
  };
}

describe("authentication refresh ownership", () => {
  const originalAdapter = httpClient.instance.defaults.adapter;

  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/login");
  });

  afterEach(() => {
    httpClient.instance.defaults.adapter = originalAdapter;
  });

  it("keeps a newer subject token when an older refresh succeeds last", async () => {
    // Given
    localStorage.setItem("token", STARTING_TOKEN);
    const { refreshStarted, resolveRefresh } = installRefreshAdapter();
    const request = httpClient.instance.get("/protected");
    await refreshStarted.promise;
    const user = renderAuthRaceHarness(createAuthRaceQueryClient());
    await user.click(
      screen.getByRole("button", { name: "Install external account B" }),
    );

    // When
    resolveRefresh(ROTATED_TOKEN);
    await request.catch(() => undefined);

    // Then
    expect(localStorage.getItem("token")).toBe(ACCOUNT_B_TOKEN);
    expect(screen.getByTestId("auth-token")).toHaveTextContent(ACCOUNT_B_TOKEN);
  });

  it("keeps a newer subject token when an older refresh fails last", async () => {
    // Given
    localStorage.setItem("token", STARTING_TOKEN);
    const { refreshStarted, rejectRefresh } = installRefreshAdapter();
    const request = httpClient.instance.get("/protected");
    await refreshStarted.promise;
    advanceAuthenticationSubjectRevision();
    localStorage.setItem("token", NEW_SUBJECT_TOKEN);

    // When
    rejectRefresh();
    await request.catch(() => undefined);

    // Then
    expect(localStorage.getItem("token")).toBe(NEW_SUBJECT_TOKEN);
  });

  it("rotates the current token without advancing its subject revision", async () => {
    // Given
    localStorage.setItem("token", STARTING_TOKEN);
    const revision = captureAuthenticationSubjectRevision();
    const {
      refreshStarted,
      resolveRefresh,
      getProtectedRequestAuthorizations,
      getProtectedRequestOwnerships,
    } = installRefreshAdapter();
    const request = httpClient.instance.get<{ owner: string }>("/protected");
    await refreshStarted.promise;

    // When
    resolveRefresh(ROTATED_TOKEN);
    const response = await request;

    // Then
    expect(response.data).toEqual({ owner: "current-subject" });
    expect(localStorage.getItem("token")).toBe(ROTATED_TOKEN);
    expect(isAuthenticationSubjectRevisionCurrent(revision)).toBe(true);
    expect(getProtectedRequestAuthorizations()).toEqual([
      `Bearer ${STARTING_TOKEN}`,
      `Bearer ${ROTATED_TOKEN}`,
    ]);
    const retryOwnership = getProtectedRequestOwnerships().at(1);
    expect(retryOwnership).toEqual({
      subjectRevision: revision,
      originalToken: STARTING_TOKEN,
      retryToken: ROTATED_TOKEN,
    });
    if (retryOwnership === undefined) {
      throw new Error("expected retry ownership metadata");
    }
    expect(retryOwnership).toBeInstanceOf(AuthenticationRequestOwnership);
    expect(Object.isFrozen(retryOwnership)).toBe(true);
    expect(Object.isFrozen(retryOwnership.subjectRevision)).toBe(true);
  });

  it("updates the provider token when the current subject refresh succeeds", async () => {
    // Given
    localStorage.setItem("token", STARTING_TOKEN);
    const revision = captureAuthenticationSubjectRevision();
    const { refreshStarted, resolveRefresh } = installRefreshAdapter();
    renderAuthRaceHarness(createAuthRaceQueryClient());
    await refreshStarted.promise;

    // When
    resolveRefresh(ROTATED_TOKEN);

    // Then
    await waitFor(() =>
      expect(screen.getByTestId("auth-token")).toHaveTextContent(ROTATED_TOKEN),
    );
    expect(localStorage.getItem("token")).toBe(ROTATED_TOKEN);
    expect(isAuthenticationSubjectRevisionCurrent(revision)).toBe(true);
  });

  it("terminates the current subject when its refresh fails", async () => {
    // Given
    localStorage.setItem("token", STARTING_TOKEN);
    const revision = captureAuthenticationSubjectRevision();
    const { refreshStarted, rejectRefresh } = installRefreshAdapter();
    const request = httpClient.instance.get("/protected");
    await refreshStarted.promise;

    // When
    rejectRefresh();
    await request.catch(() => undefined);

    // Then
    expect(localStorage.getItem("token")).toBeNull();
    expect(isAuthenticationSubjectRevisionCurrent(revision)).toBe(false);
  });

  it("does not refresh a newer subject for an older request that returns 401 late", async () => {
    // Given
    localStorage.setItem("token", STARTING_TOKEN);
    const protectedRequestStarted = createDeferred<void>();
    const protectedRequestFailure = createDeferred<AxiosResponse>();
    let protectedRequestConfig: InternalAxiosRequestConfig | null = null;
    let refreshRequestCount = 0;
    const adapter: AxiosAdapter = async (config) => {
      if (config.url === "/auth/refresh") {
        refreshRequestCount += 1;
        return createAxiosResponse(config, {
          data: { token: ROTATED_TOKEN },
        });
      }
      protectedRequestConfig = config;
      protectedRequestStarted.resolve(undefined);
      return protectedRequestFailure.promise;
    };
    httpClient.instance.defaults.adapter = adapter;
    const request = httpClient.instance.get("/protected");
    await protectedRequestStarted.promise;
    advanceAuthenticationSubjectRevision();
    localStorage.setItem("token", NEW_SUBJECT_TOKEN);

    // When
    if (protectedRequestConfig === null) {
      throw new Error("expected the protected request to start");
    }
    protectedRequestFailure.reject(
      createUnauthorizedAxiosError(protectedRequestConfig),
    );
    await request.catch(() => undefined);

    // Then
    expect(refreshRequestCount).toBe(0);
    expect(localStorage.getItem("token")).toBe(NEW_SUBJECT_TOKEN);
  });

  it("keeps a newer subject when an unauthenticated request returns 401 late", async () => {
    // Given
    const requestStarted = createDeferred<void>();
    const requestFailure = createDeferred<AxiosResponse>();
    let requestConfig: InternalAxiosRequestConfig | null = null;
    const adapter: AxiosAdapter = async (config) => {
      requestConfig = config;
      requestStarted.resolve(undefined);
      return requestFailure.promise;
    };
    httpClient.instance.defaults.adapter = adapter;
    const request = httpClient.instance.get("/public-probe");
    await requestStarted.promise;
    advanceAuthenticationSubjectRevision();
    localStorage.setItem("token", NEW_SUBJECT_TOKEN);

    // When
    if (requestConfig === null) {
      throw new Error("expected the unauthenticated request to start");
    }
    requestFailure.reject(createUnauthorizedAxiosError(requestConfig));
    await request.catch(() => undefined);

    // Then
    expect(localStorage.getItem("token")).toBe(NEW_SUBJECT_TOKEN);
  });

  it("does not advance the subject revision for a current unauthenticated 401", async () => {
    // Given
    const revision = captureAuthenticationSubjectRevision();
    const adapter: AxiosAdapter = async (config) => {
      throw createUnauthorizedAxiosError(config);
    };
    httpClient.instance.defaults.adapter = adapter;

    // When
    await httpClient.instance.get("/public-probe").catch(() => undefined);

    // Then
    expect(isAuthenticationSubjectRevisionCurrent(revision)).toBe(true);
    expect(localStorage.getItem("token")).toBeNull();
  });
});
