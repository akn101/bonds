import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { httpClient } from "@/api";
import { createDeferred } from "@/test/authCompletionTestSupport";
import {
  createAxiosResponse,
  createUnauthorizedAxiosError,
} from "@/test/authRefreshTestSupport";
import {
  captureAuthenticationSubjectRevision,
  isAuthenticationSubjectRevisionCurrent,
  subscribeAuthenticationSubjectTermination,
} from "@/utils/authenticationSubjectRevision";

const STARTING_TOKEN = "refresh-starting-token";
const ROTATED_TOKEN = "refresh-rotated-token";

describe("authentication refresh concurrency", () => {
  const originalAdapter = httpClient.instance.defaults.adapter;

  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/login");
  });

  afterEach(() => {
    httpClient.instance.defaults.adapter = originalAdapter;
  });

  it("deduplicates concurrent current-subject refresh and retries both requests with the rotated token", async () => {
    // Given
    localStorage.setItem("token", STARTING_TOKEN);
    const subjectRevision = captureAuthenticationSubjectRevision();
    const refreshStarted = createDeferred<void>();
    const refreshCompletion = createDeferred<void>();
    let refreshRequestCount = 0;
    const refreshRequestConfig = createDeferred<InternalAxiosRequestConfig>();
    const protectedRequestCounts = new Map<string, number>();
    const retryAuthorizations: unknown[] = [];
    const adapter: AxiosAdapter = async (config) => {
      if (config.url === "/auth/refresh") {
        refreshRequestCount += 1;
        refreshRequestConfig.resolve(config);
        refreshStarted.resolve(undefined);
        await refreshCompletion.promise;
        return createAxiosResponse(config, {
          data: { token: ROTATED_TOKEN },
        });
      }
      const url = config.url ?? "";
      const requestCount = (protectedRequestCounts.get(url) ?? 0) + 1;
      protectedRequestCounts.set(url, requestCount);
      if (requestCount === 1) {
        throw createUnauthorizedAxiosError(config);
      }
      retryAuthorizations.push(config.headers.get("Authorization"));
      return createAxiosResponse(config, { owner: url });
    };
    httpClient.instance.defaults.adapter = adapter;
    const firstRequest = httpClient.instance.get<{ owner: string }>(
      "/protected/first",
    );
    const secondRequest = httpClient.instance.get<{ owner: string }>(
      "/protected/second",
    );
    await refreshStarted.promise;

    // When
    refreshCompletion.resolve(undefined);
    const [firstResponse, secondResponse] = await Promise.all([
      firstRequest,
      secondRequest,
    ]);

    // Then
    expect(refreshRequestCount).toBe(1);
    expect(
      (await refreshRequestConfig.promise).headers.get("Authorization"),
    ).toBe(`Bearer ${STARTING_TOKEN}`);
    expect(firstResponse.data).toEqual({ owner: "/protected/first" });
    expect(secondResponse.data).toEqual({ owner: "/protected/second" });
    expect(retryAuthorizations).toEqual([
      `Bearer ${ROTATED_TOKEN}`,
      `Bearer ${ROTATED_TOKEN}`,
    ]);
    expect(localStorage.getItem("token")).toBe(ROTATED_TOKEN);
    expect(isAuthenticationSubjectRevisionCurrent(subjectRevision)).toBe(true);
  });

  it("retries a late old-token 401 once with the current rotated token", async () => {
    // Given
    localStorage.setItem("token", STARTING_TOKEN);
    const subjectRevision = captureAuthenticationSubjectRevision();
    const heldRequestStarted = createDeferred<void>();
    const releaseHeldUnauthorizedResponse = createDeferred<void>();
    const protectedRequestCounts = new Map<string, number>();
    const authorizationSequence: Readonly<{
      url: string;
      authorization: unknown;
    }>[] = [];
    let refreshRequestCount = 0;
    let terminationCount = 0;
    const unsubscribeTermination = subscribeAuthenticationSubjectTermination(
      () => {
        terminationCount += 1;
      },
    );
    const adapter: AxiosAdapter = async (config) => {
      const url = config.url ?? "";
      authorizationSequence.push({
        url,
        authorization: config.headers.get("Authorization"),
      });
      if (url === "/auth/refresh") {
        refreshRequestCount += 1;
        return createAxiosResponse(config, {
          data: { token: ROTATED_TOKEN },
        });
      }
      const requestCount = (protectedRequestCounts.get(url) ?? 0) + 1;
      protectedRequestCounts.set(url, requestCount);
      if (url === "/protected/held" && requestCount === 1) {
        heldRequestStarted.resolve(undefined);
        await releaseHeldUnauthorizedResponse.promise;
        throw createUnauthorizedAxiosError(config);
      }
      if (requestCount === 1) {
        throw createUnauthorizedAxiosError(config);
      }
      return createAxiosResponse(config, { owner: url });
    };
    httpClient.instance.defaults.adapter = adapter;
    try {
      const heldRequest = httpClient.instance.get<{ owner: string }>(
        "/protected/held",
      );
      await heldRequestStarted.promise;
      const rotatingResponse = await httpClient.instance.get<{
        owner: string;
      }>("/protected/rotating");

      // When
      releaseHeldUnauthorizedResponse.resolve(undefined);
      const heldResponse = await heldRequest;

      // Then
      expect(rotatingResponse.data).toEqual({ owner: "/protected/rotating" });
      expect(heldResponse.data).toEqual({ owner: "/protected/held" });
      expect(refreshRequestCount).toBe(1);
      expect(protectedRequestCounts.get("/protected/held")).toBe(2);
      expect(protectedRequestCounts.get("/protected/rotating")).toBe(2);
      expect(authorizationSequence).toEqual([
        {
          url: "/protected/held",
          authorization: `Bearer ${STARTING_TOKEN}`,
        },
        {
          url: "/protected/rotating",
          authorization: `Bearer ${STARTING_TOKEN}`,
        },
        {
          url: "/auth/refresh",
          authorization: `Bearer ${STARTING_TOKEN}`,
        },
        {
          url: "/protected/rotating",
          authorization: `Bearer ${ROTATED_TOKEN}`,
        },
        {
          url: "/protected/held",
          authorization: `Bearer ${ROTATED_TOKEN}`,
        },
      ]);
      expect(terminationCount).toBe(0);
      expect(localStorage.getItem("token")).toBe(ROTATED_TOKEN);
      expect(isAuthenticationSubjectRevisionCurrent(subjectRevision)).toBe(
        true,
      );
    } finally {
      releaseHeldUnauthorizedResponse.resolve(undefined);
      unsubscribeTermination();
    }
  });

  it("deduplicates concurrent terminal refresh failure and terminates the subject once", async () => {
    // Given
    localStorage.setItem("token", STARTING_TOKEN);
    const subjectRevision = captureAuthenticationSubjectRevision();
    const refreshStarted = createDeferred<void>();
    const refreshFailure = createDeferred<void>();
    let refreshRequestCount = 0;
    let protectedRequestCount = 0;
    let terminationCount = 0;
    const unsubscribeTermination = subscribeAuthenticationSubjectTermination(
      () => {
        terminationCount += 1;
      },
    );
    const adapter: AxiosAdapter = async (config) => {
      if (config.url === "/auth/refresh") {
        refreshRequestCount += 1;
        refreshStarted.resolve(undefined);
        await refreshFailure.promise;
      }
      protectedRequestCount += 1;
      throw createUnauthorizedAxiosError(config);
    };
    httpClient.instance.defaults.adapter = adapter;
    try {
      const firstRequest = httpClient.instance
        .get("/protected/first")
        .catch(() => undefined);
      const secondRequest = httpClient.instance
        .get("/protected/second")
        .catch(() => undefined);
      await refreshStarted.promise;

      // When
      refreshFailure.resolve(undefined);
      await Promise.all([firstRequest, secondRequest]);

      // Then
      expect(refreshRequestCount).toBe(1);
      expect(protectedRequestCount).toBe(3);
      expect(terminationCount).toBe(1);
      expect(localStorage.getItem("token")).toBeNull();
      expect(isAuthenticationSubjectRevisionCurrent(subjectRevision)).toBe(
        false,
      );
    } finally {
      refreshFailure.resolve(undefined);
      unsubscribeTermination();
    }
  });
});
