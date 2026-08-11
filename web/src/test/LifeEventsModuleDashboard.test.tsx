import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { App as AntApp, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LifeEventsModule from "@/pages/contact/modules/LifeEventsModule";

const mockLifeEventsList = vi.fn();
const mockPreferencesList = vi.fn().mockResolvedValue({ data: {} });

vi.mock("@/api", () => ({
  api: {
    lifeEvents: {
      lifeEventsList: (...args: unknown[]) => mockLifeEventsList(...args),
    },
    contacts: {
      contactsList: vi.fn().mockResolvedValue({ data: [] }),
      contactsSelectableList: vi.fn().mockResolvedValue({ data: [] }),
    },
    vaultSettings: {
      settingsLifeEventCategoriesList: vi.fn().mockResolvedValue({ data: [] }),
    },
    preferences: {
      preferencesList: (...args: unknown[]) => mockPreferencesList(...args),
    },
    vaults: {
      vaultsDetail: vi.fn().mockResolvedValue({
        data: { effective_name_order: "%first_name% %last_name%" },
      }),
    },
  },
}));

function renderModule(
  initiallyOpen = false,
  initialCreateKind: "activity" | "life_event" = "life_event",
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConfigProvider>
        <AntApp>
          <LifeEventsModule
            vaultId="vault-1"
            initiallyOpen={initiallyOpen}
            initialCreateKind={initialCreateKind}
          />
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>,
  );
}

describe("LifeEventsModule on the vault dashboard", () => {
  it("lists all vault events without filtering by the default participant", async () => {
    mockLifeEventsList.mockResolvedValue({
      data: [],
      meta: { page: 1, total_pages: 1 },
    });

    renderModule();

    await waitFor(() =>
      expect(mockLifeEventsList).toHaveBeenCalledWith("vault-1", {
        contact_id: undefined,
        page: 1,
        per_page: 15,
      }),
    );
  });

  it("renders the current system-user subject as You", async () => {
    mockLifeEventsList.mockResolvedValue({
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
    mockLifeEventsList.mockResolvedValue({
      data: [],
      meta: { page: 1, total_pages: 1 },
    });
    mockPreferencesList.mockResolvedValueOnce({
      data: { enable_alternative_calendar: false },
    });

    renderModule(true, "activity");

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Add activity")).toBeInTheDocument();
    expect(within(dialog).getByText("Title")).toBeInTheDocument();
    expect(within(dialog).queryByText("Gregorian")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Chinese Lunar")).not.toBeInTheDocument();
  });

  it("shows the calendar selector only when alternative calendars are enabled", async () => {
    mockLifeEventsList.mockResolvedValue({
      data: [],
      meta: { page: 1, total_pages: 1 },
    });
    mockPreferencesList.mockResolvedValueOnce({
      data: { enable_alternative_calendar: true },
    });

    renderModule(true, "activity");

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Gregorian")).toBeInTheDocument();
    expect(within(dialog).getByText("Chinese Lunar")).toBeInTheDocument();
  });
});
