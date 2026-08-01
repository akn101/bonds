import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App as AntApp, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Register from "@/pages/auth/Register";
import { api } from "@/api";
import type { RegisterRequest } from "@/api";
import {
  createDeferred,
  type AuthenticationCompletion,
} from "@/test/authCompletionTestSupport";
import { RouteLocationProbe } from "@/test/authCompletionRouteProbe";

const mockRegister =
  vi.fn<(data: RegisterRequest) => Promise<AuthenticationCompletion>>();

vi.mock("@/api", () => ({
  api: {
    instance: { infoList: vi.fn() },
    preferences: { preferencesLocaleCreate: vi.fn() },
  },
}));

vi.mock("@/stores/auth", () => ({
  useAuth: () => ({
    register: mockRegister,
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: false,
    login: vi.fn(),
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

function renderRegister() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <ConfigProvider>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/register"]}>
            <RouteLocationProbe />
            <Routes>
              <Route path="/register" element={<Register />} />
              <Route
                path="/vaults"
                element={<div data-testid="vaults-page" />}
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>,
  );
}

async function fillRegistrationForm(): Promise<void> {
  const user = userEvent.setup();
  await user.type(await screen.findByPlaceholderText("First name"), "Account");
  await user.type(screen.getByPlaceholderText("Last name"), "A");
  await user.type(
    screen.getByPlaceholderText("Email"),
    "account-a@example.com",
  );
  await user.type(
    screen.getByPlaceholderText("Password (min 8 characters)"),
    "password",
  );
}

describe("Register authentication completion contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.instance.infoList).mockResolvedValue({
      data: { registration_enabled: true },
    } satisfies Awaited<ReturnType<typeof api.instance.infoList>>);
  });

  it("does not navigate or report an error for a stale registration completion", async () => {
    // Given
    const completion = createDeferred<AuthenticationCompletion>();
    mockRegister.mockReturnValue(completion.promise);
    renderRegister();
    await fillRegistrationForm();
    const submitButton = screen.getByRole("button", {
      name: /create account/i,
    });
    await userEvent.setup().click(submitButton);
    expect(mockRegister).toHaveBeenCalledWith({
      first_name: "Account",
      last_name: "A",
      email: "account-a@example.com",
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
      .toHaveTextContent("/register");
    expect
      .soft(screen.queryByText("Registration failed"))
      .not.toBeInTheDocument();
  });

  it("preserves authenticated registration navigation", async () => {
    // Given
    mockRegister.mockResolvedValue({ status: "authenticated" });
    renderRegister();
    await fillRegistrationForm();

    // When
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /create account/i }));

    // Then
    await waitFor(() =>
      expect(screen.getByTestId("route-location")).toHaveTextContent("/vaults"),
    );
  });
});
