import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished } from "vitest";
import { AuthProvider } from "@/stores/auth";
import { AuthRaceConsumer } from "@/test/AuthRaceConsumer";
export * from "@/test/authRaceFixtures";

const SUBJECT_QUERY_KEY = ["authenticated-subject", "profile"] as const;

type ExpectedAuthenticationState = {
  readonly userId: string;
  readonly token: string;
  readonly isLoading?: boolean;
  readonly twoFactorPending: boolean;
  readonly tempToken: string;
  readonly cacheOwnerId: string | null;
};

export function createAuthRaceQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  onTestFinished(() => queryClient.clear());
  return queryClient;
}

export function renderAuthRaceHarness(queryClient: QueryClient) {
  render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(AuthProvider, null, createElement(AuthRaceConsumer)),
    ),
  );
  return userEvent.setup();
}

export function seedSubjectCache(
  queryClient: QueryClient,
  ownerId: string,
): void {
  queryClient.setQueryData(SUBJECT_QUERY_KEY, { ownerId });
  queryClient.getMutationCache().build(queryClient, {
    mutationKey: ["authenticated-subject", ownerId],
    mutationFn: async () => ownerId,
  });
}

export function expectAuthenticationState(
  queryClient: QueryClient,
  expected: ExpectedAuthenticationState,
): void {
  expect
    .soft(screen.getByTestId("auth-user-id"), "authenticated user")
    .toHaveTextContent(expected.userId);
  expect
    .soft(screen.getByTestId("auth-token"), "React authentication token")
    .toHaveTextContent(expected.token);
  expect
    .soft(localStorage.getItem("token"), "persisted authentication token")
    .toBe(expected.token === "none" ? null : expected.token);
  if (expected.isLoading !== undefined) {
    expect
      .soft(screen.getByTestId("auth-loading"), "authentication loading state")
      .toHaveTextContent(String(expected.isLoading));
  }
  expect
    .soft(screen.getByTestId("two-factor-pending"), "2FA pending state")
    .toHaveTextContent(String(expected.twoFactorPending));
  expect
    .soft(screen.getByTestId("temp-token"), "2FA temporary token")
    .toHaveTextContent(expected.tempToken);
  expect
    .soft(queryClient.getQueryData(SUBJECT_QUERY_KEY), "subject query cache")
    .toEqual(
      expected.cacheOwnerId === null
        ? undefined
        : { ownerId: expected.cacheOwnerId },
    );
  expect
    .soft(
      queryClient
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.options.mutationKey),
      "subject mutation cache",
    )
    .toEqual(
      expected.cacheOwnerId === null
        ? []
        : [["authenticated-subject", expected.cacheOwnerId]],
    );
}
