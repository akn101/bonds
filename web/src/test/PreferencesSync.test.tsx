import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import dayjs from "dayjs";
import i18n, { applyDayjsWeekStart } from "@/i18n";
import { usePreferencesSync } from "@/hooks/usePreferencesSync";

const applyThemeMode = vi.hoisted(() => vi.fn());

// Mock the API surface — the hook gates the query on user being present,
// so we also need to mock the auth store. The test focuses purely on whether
// loading prefs triggers i18n.changeLanguage when the persisted locale
// differs from the active one.
vi.mock("@/api", () => ({
  api: {
    preferences: {
      preferencesList: vi.fn(),
    },
  },
}));

vi.mock("@/stores/auth", () => ({
  useAuth: () => ({ user: { id: "u1" }, isAuthenticated: true }),
}));

vi.mock("@/stores/theme", () => ({
  useTheme: () => ({
    themeMode: "system",
    resolvedTheme: "light",
    setThemeMode: vi.fn(),
    applyThemeMode,
  }),
}));

import { api } from "@/api";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("usePreferencesSync", () => {
  beforeEach(async () => {
    applyDayjsWeekStart("sunday");
    await i18n.changeLanguage("en");
    applyThemeMode.mockReset();
    vi.mocked(api.preferences.preferencesList).mockReset();
  });
  afterEach(async () => {
    applyDayjsWeekStart("sunday");
    await i18n.changeLanguage("en");
  });

  it("applies the saved locale to i18next when it differs from the active language", async () => {
    vi.mocked(api.preferences.preferencesList).mockResolvedValue({
      data: { locale: "zh" },
    } as never);

    renderHook(() => usePreferencesSync(), { wrapper });

    await waitFor(() => {
      expect(i18n.language).toBe("zh");
    });
  });

  it("normalizes region-qualified codes from the backend (zh-CN → zh)", async () => {
    vi.mocked(api.preferences.preferencesList).mockResolvedValue({
      data: { locale: "zh-CN" },
    } as never);

    renderHook(() => usePreferencesSync(), { wrapper });

    await waitFor(() => {
      expect(i18n.language).toBe("zh");
    });
  });

  it("does not call changeLanguage when locale already matches", async () => {
    vi.mocked(api.preferences.preferencesList).mockResolvedValue({
      data: { locale: "en" },
    } as never);
    const spy = vi.spyOn(i18n, "changeLanguage");

    renderHook(() => usePreferencesSync(), { wrapper });

    await waitFor(() => {
      expect(api.preferences.preferencesList).toHaveBeenCalled();
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("does nothing for an unsupported locale (falls back to en, which matches)", async () => {
    vi.mocked(api.preferences.preferencesList).mockResolvedValue({
      data: { locale: "ja" },
    } as never);

    renderHook(() => usePreferencesSync(), { wrapper });

    await waitFor(() => {
      expect(api.preferences.preferencesList).toHaveBeenCalled();
    });
    // normalizeLanguageCode collapses "ja" → "en"; since i18n was already
    // "en" no language change should fire.
    expect(i18n.language).toBe("en");
  });

  it("applies the saved week start preference to dayjs", async () => {
    vi.mocked(api.preferences.preferencesList).mockResolvedValue({
      data: { locale: "en", week_start: "monday" },
    } as never);

    renderHook(() => usePreferencesSync(), { wrapper });

    await waitFor(() => {
      expect(dayjs("2026-01-15").startOf("week").format("YYYY-MM-DD")).toBe("2026-01-12");
    });
  });

  it("applies the saved personal theme without writing it back", async () => {
    vi.mocked(api.preferences.preferencesList).mockResolvedValue({
      data: { locale: "en", theme: "dark" },
    } as never);

    renderHook(() => usePreferencesSync(), { wrapper });

    await waitFor(() => {
      expect(applyThemeMode).toHaveBeenCalledWith("dark");
    });
  });
});
