import { httpClient } from "@/api";
import { ACCOUNT_A_TOKEN } from "@/test/authRaceFixtures";
import type { AxiosAdapter } from "axios";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type RequestCase = Readonly<{
  method: "GET" | "POST";
  url: string;
}>;

const PUBLIC_SUBJECT_ESTABLISHING_ATTEMPTS = [
  { method: "POST", url: "/auth/login" },
  { method: "POST", url: "/auth/register" },
  { method: "POST", url: "/auth/2fa/verify" },
  { method: "POST", url: "/auth/webauthn/login/begin" },
  {
    method: "POST",
    url: "/auth/webauthn/login/finish?email=account-b%40example.com",
  },
  { method: "POST", url: "/auth/oauth/link-register" },
] as const satisfies readonly RequestCase[];

const CURRENT_SESSION_REQUESTS = [
  { method: "GET", url: "/auth/me" },
  { method: "POST", url: "/auth/refresh" },
  { method: "POST", url: "/auth/resend-verification" },
  { method: "POST", url: "/auth/oauth/link" },
  { method: "POST", url: "/settings/webauthn/register/begin" },
  { method: "GET", url: "/vaults" },
] as const satisfies readonly RequestCase[];

async function captureAuthorization({ method, url }: RequestCase) {
  let authorization: unknown;
  const adapter: AxiosAdapter = async (config) => {
    authorization = config.headers.get("Authorization");
    return {
      config,
      data: {},
      headers: {},
      status: 200,
      statusText: "OK",
    };
  };
  httpClient.instance.defaults.adapter = adapter;
  await httpClient.instance.request({ method, url });
  return authorization;
}

describe("authentication request session classification", () => {
  const originalAdapter = httpClient.instance.defaults.adapter;

  beforeEach(() => {
    localStorage.setItem("token", ACCOUNT_A_TOKEN);
  });

  afterEach(() => {
    localStorage.clear();
    httpClient.instance.defaults.adapter = originalAdapter;
  });

  it.each(PUBLIC_SUBJECT_ESTABLISHING_ATTEMPTS)(
    "omits the current bearer from $url",
    async (request) => {
      // Given
      const expectedAuthorization = undefined;

      // When
      const authorization = await captureAuthorization(request);

      // Then
      expect(authorization).toBe(expectedAuthorization);
    },
  );

  it.each(CURRENT_SESSION_REQUESTS)(
    "preserves the current bearer for $url",
    async (request) => {
      // Given
      const expectedAuthorization = `Bearer ${ACCOUNT_A_TOKEN}`;

      // When
      const authorization = await captureAuthorization(request);

      // Then
      expect(authorization).toBe(expectedAuthorization);
    },
  );
});
