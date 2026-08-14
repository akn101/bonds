import { App as AntApp, ConfigProvider } from "antd";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Layout from "@/components/Layout";

const mockUseQuery = vi.fn();
const authState = vi.hoisted(() => ({ isAdmin: false }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/stores/auth", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      first_name: "Ada",
      last_name: "Lovelace",
      is_admin: authState.isAdmin,
      is_instance_administrator: false,
    },
    logout: vi.fn(),
  }),
}));

vi.mock("@/stores/theme", () => ({
  useTheme: () => ({
    themeMode: "light",
    resolvedTheme: "light",
    setThemeMode: vi.fn(),
    applyThemeMode: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePreferencesSync", () => ({
  usePreferencesSync: vi.fn(),
}));

vi.mock("@/utils/nameFormat", () => ({
  formatContactName: () => "Ada Lovelace",
  formatContactInitials: () => "AL",
  useNameOrder: () => "%first_name% %last_name%",
}));

vi.mock("@/components/SearchBar", () => ({
  default: () => <div data-testid="search-bar" />,
}));

vi.mock("@/components/LanguageSwitcher", () => ({
  default: () => <button type="button">Language</button>,
}));

vi.mock("@/api", () => ({
  api: {
    vaults: {
      vaultsDetail: vi.fn(),
    },
  },
  httpClient: {
    instance: {
      get: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    },
  },
}));

function renderLayout() {
  return render(
    <ConfigProvider>
      <AntApp>
        <MemoryRouter initialEntries={["/vaults/vault-1"]}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/vaults/:id" element={<div>Vault content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AntApp>
    </ConfigProvider>,
  );
}

describe("Layout vault navigation visibility", () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
    authState.isAdmin = false;
  });

  it("hides configurable navigation entries when vault visibility is explicitly false", () => {
    // Given: the vault detail query returns a mixed visibility configuration.
    mockUseQuery.mockReturnValue({
      data: {
        id: "vault-1",
        name: "Personal",
        show_journal_tab: true,
        show_group_tab: false,
        show_calendar_tab: true,
        show_tasks_tab: false,
        show_reports_tab: true,
        show_files_tab: false,
        current_user_permission: 100,
      },
      isLoading: false,
    });

    // When: Layout renders inside the configured vault route.
    renderLayout();

    // Then: enabled and fixed entries remain, while explicitly disabled entries are absent.
    const navigation = screen.getByRole("navigation");
    for (const label of [
      "Dashboard",
      "Contacts",
      "Journal",
      "Calendar",
      "Reports",
      "Reminders",
      "DAV Sync",
      "Settings",
    ]) {
      expect(within(navigation).getByText(label)).toBeInTheDocument();
    }
    for (const label of ["Groups", "Tasks", "Files"]) {
      expect(within(navigation).queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("keeps shared configuration hidden until Manager permission is known", () => {
    // Given: the vault detail query is still loading and has no data.
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: true });

    // When: Layout renders inside the configured vault route.
    renderLayout();

    // Then: every existing navigation entry remains available until visibility is known.
    const navigation = screen.getByRole("navigation");
    for (const label of [
      "Dashboard",
      "Contacts",
      "Journal",
      "Groups",
      "Calendar",
      "Tasks",
      "Reports",
      "Files",
      "Reminders",
    ]) {
      expect(within(navigation).getByText(label)).toBeInTheDocument();
    }
    for (const label of ["DAV Sync", "Settings"]) {
      expect(within(navigation).queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("hides Vault configuration and DAV integration from Editors", () => {
    mockUseQuery.mockReturnValue({
      data: {
        id: "vault-1",
        current_user_permission: 200,
      },
      isLoading: false,
    });

    renderLayout();

    const navigation = screen.getByRole("navigation");
    expect(within(navigation).queryByText("DAV Sync")).not.toBeInTheDocument();
    expect(within(navigation).queryByText("Settings")).not.toBeInTheDocument();
  });

  it("shows shared account data management only to account administrators", async () => {
    const user = userEvent.setup();
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: false });
    const nonAdmin = renderLayout();
    await user.hover(screen.getByRole("img", { name: "user" }));
    await screen.findByText("Account");
    expect(screen.queryByText("Shared account data")).not.toBeInTheDocument();

    nonAdmin.unmount();
    authState.isAdmin = true;
    renderLayout();
    await user.hover(screen.getByRole("img", { name: "user" }));
    expect(await screen.findByText("Shared account data")).toBeInTheDocument();
  });
});
