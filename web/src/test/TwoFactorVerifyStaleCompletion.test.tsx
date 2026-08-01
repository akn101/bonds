import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App as AntApp, ConfigProvider } from "antd";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TwoFactorVerify from "@/pages/auth/TwoFactorVerify";
import {
  createDeferred,
  type AuthenticationCompletion,
} from "@/test/authCompletionTestSupport";
import { RouteLocationProbe } from "@/test/authCompletionRouteProbe";

const mockVerifyTwoFactor =
  vi.fn<(code: string) => Promise<AuthenticationCompletion>>();

vi.mock("@/api", () => ({
  api: {},
  httpClient: {
    instance: { get: vi.fn() },
  },
}));

vi.mock("@/stores/auth", () => ({
  useAuth: () => ({
    twoFactorPending: true,
    tempToken: "account-a-temp-token",
    verifyTwoFactor: mockVerifyTwoFactor,
    logout: vi.fn(),
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: false,
    login: vi.fn(),
    register: vi.fn(),
    setExternalToken: vi.fn(),
  }),
}));

function renderTwoFactorVerify(): void {
  render(
    <ConfigProvider>
      <AntApp>
        <MemoryRouter initialEntries={["/login/2fa"]}>
          <RouteLocationProbe />
          <Routes>
            <Route path="/login/2fa" element={<TwoFactorVerify />} />
            <Route path="/login" element={<div data-testid="login-page" />} />
            <Route path="/vaults" element={<div data-testid="vaults-page" />} />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </ConfigProvider>,
  );
}

describe("TwoFactorVerify stale completion contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not navigate or report an error for a stale 2FA completion", async () => {
    // Given
    const completion = createDeferred<AuthenticationCompletion>();
    mockVerifyTwoFactor.mockReturnValue(completion.promise);
    const user = userEvent.setup();
    renderTwoFactorVerify();
    await user.type(screen.getByPlaceholderText(/code/i), "123456");
    const submitButton = screen.getByRole("button", { name: /verify|submit/i });
    await user.click(submitButton);
    expect(mockVerifyTwoFactor).toHaveBeenCalledWith("123456");
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
      .toHaveTextContent("/login/2fa");
    expect
      .soft(screen.queryByText("Verification failed"))
      .not.toBeInTheDocument();
  });
});
