import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App as AntApp, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Login from "@/pages/auth/Login";
import { api } from "@/api";
import type { LoginRequest } from "@/api";
import {
  createDeferred,
  type AuthenticationCompletion,
} from "@/test/authCompletionTestSupport";
import { RouteLocationProbe } from "@/test/authCompletionRouteProbe";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";

const mockLogin =
  vi.fn<(data: LoginRequest) => Promise<AuthenticationCompletion>>();

vi.mock("@/api", () => ({
  api: {
    webauthn: { webauthnLoginBeginCreate: vi.fn() },
    instance: { infoList: vi.fn() },
    preferences: { preferencesLocaleCreate: vi.fn() },
  },
  httpClient: {
    instance: {
      get: vi.fn(),
      post: vi.fn(),
    },
  },
}));

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: vi.fn(),
  startAuthentication: vi.fn(),
}));

vi.mock("@/stores/auth", () => ({
  useAuth: () => ({
    login: mockLogin,
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: false,
    register: vi.fn(),
    logout: vi.fn(),
    setExternalToken: vi.fn(),
    verifyTwoFactor: vi.fn(),
    twoFactorPending: false,
    tempToken: null,
  }),
}));

vi.mock("@/stores/theme", () => ({
  useTheme: () => ({
    themeMode: "system" as const,
    resolvedTheme: "light" as const,
    setThemeMode: vi.fn(),
  }),
}));

function renderLogin(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <ConfigProvider>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/login"]}>
            <RouteLocationProbe />
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                path="/vaults"
                element={<div data-testid="vaults-page" />}
              />
              <Route
                path="/login/2fa"
                element={<div data-testid="two-factor-page" />}
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>,
  );
}

describe("Login stale completion contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(false);
    vi.mocked(api.instance.infoList).mockResolvedValue({
      data: {
        password_auth_enabled: true,
        registration_enabled: true,
        webauthn_enabled: false,
        oauth_providers: [],
      },
    } satisfies Awaited<ReturnType<typeof api.instance.infoList>>);
  });

  it("does not navigate or report an error for a stale login completion", async () => {
    // Given
    const completion = createDeferred<AuthenticationCompletion>();
    mockLogin.mockReturnValue(completion.promise);
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByPlaceholderText("Email"), "stale@example.com");
    await user.type(screen.getByPlaceholderText("Password"), "password");
    const submitButton = screen.getByRole("button", { name: /sign in/i });
    await user.click(submitButton);
    expect(mockLogin).toHaveBeenCalledWith({
      email: "stale@example.com",
      password: "password",
    });
    await waitFor(() => expect(submitButton).toHaveClass("ant-btn-loading"));

    // When
    await act(async () => {
      completion.resolve({ status: "stale" });
      await completion.promise;
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(submitButton).not.toHaveClass("ant-btn-loading"),
    );

    // Then
    expect
      .soft(screen.getByTestId("route-location"))
      .toHaveTextContent(/^\/login$/);
    expect.soft(screen.queryByText("Login failed")).not.toBeInTheDocument();
  });
});
