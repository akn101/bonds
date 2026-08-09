import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App as AntApp, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LifeEventsModule from "@/pages/contact/modules/LifeEventsModule";

const mockLifeEventsList = vi.fn();

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
      preferencesList: vi.fn().mockResolvedValue({ data: {} }),
    },
    vaults: {
      vaultsDetail: vi.fn().mockResolvedValue({
        data: { effective_name_order: "%first_name% %last_name%" },
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
          <LifeEventsModule
            vaultId="vault-1"
            initiallyOpen={initiallyOpen}
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
});
