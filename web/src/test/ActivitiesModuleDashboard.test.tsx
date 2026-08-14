import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { App as AntApp, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ActivitiesModule from "@/pages/contact/modules/ActivitiesModule";

const mockActivitiesList = vi.fn();
const mockPreferencesList = vi.fn().mockResolvedValue({ data: {} });

vi.mock("@/api", () => ({
  api: {
    activities: {
      activitiesList: (...args: unknown[]) => mockActivitiesList(...args),
    },
    contacts: {
      contactsList: vi.fn().mockResolvedValue({ data: [] }),
      contactsSelectableList: vi.fn().mockResolvedValue({ data: [] }),
    },
    vaultSettings: {
      settingsActivityCategoriesList: vi.fn().mockResolvedValue({ data: [] }),
    },
    preferences: {
      preferencesList: (...args: unknown[]) => mockPreferencesList(...args),
    },
    vaults: {
      vaultsDetail: vi.fn().mockResolvedValue({
        data: {},
      }),
    },
  },
}));

function renderModule(initiallyOpen = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConfigProvider>
        <AntApp>
          <ActivitiesModule vaultId="vault-1" initiallyOpen={initiallyOpen} />
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>,
  );
}

describe("ActivitiesModule on the vault dashboard", () => {
  it("lists all vault activities without filtering by the default participant", async () => {
    mockActivitiesList.mockResolvedValue({
      data: [],
      meta: { page: 1, total_pages: 1 },
    });

    renderModule();

    await waitFor(() =>
      expect(mockActivitiesList).toHaveBeenCalledWith("vault-1", {
        contact_id: undefined,
        page: 1,
        per_page: 15,
      }),
    );
  });

  it("renders the current system-user subject as You", async () => {
    mockActivitiesList.mockResolvedValue({
      data: [
        {
          id: 1,
          title: "Started a new role",
          subject_user_id: "user-1",
          subject_user_name: "Alice Admin",
          subject_is_current_user: true,
          participants: [],
        },
      ],
      meta: { page: 1, total_pages: 1 },
    });

    renderModule();

    expect(await screen.findByText("You")).toBeInTheDocument();
    expect(screen.queryByText("user-1")).not.toBeInTheDocument();
  });

  it("uses activity wording and the Title field for the dashboard quick action", async () => {
    mockActivitiesList.mockResolvedValue({
      data: [],
      meta: { page: 1, total_pages: 1 },
    });
    mockPreferencesList.mockResolvedValueOnce({
      data: { enable_alternative_calendar: false },
    });

    renderModule(true);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Add activity")).toBeInTheDocument();
    expect(within(dialog).getByText("Title")).toBeInTheDocument();
    expect(within(dialog).queryByText("Gregorian")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Chinese Lunar")).not.toBeInTheDocument();
  });

  it("shows the calendar selector only when alternative calendars are enabled", async () => {
    mockActivitiesList.mockResolvedValue({
      data: [],
      meta: { page: 1, total_pages: 1 },
    });
    mockPreferencesList.mockResolvedValueOnce({
      data: { enable_alternative_calendar: true },
    });

    renderModule(true);

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Gregorian")).toBeInTheDocument();
    expect(within(dialog).getByText("Chinese Lunar")).toBeInTheDocument();
  });
});
