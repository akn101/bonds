import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider } from "antd";
import GroupDetail from "@/pages/vault/GroupDetail";

const apiMocks = vi.hoisted(() => ({
  groupsDetail: vi.fn(),
  groupsUpdate: vi.fn(),
  groupsMembersCreate: vi.fn(),
  groupsMembersDelete: vi.fn(),
  contactsSelectableList: vi.fn(),
  vaultsDetail: vi.fn(),
  preferencesList: vi.fn(),
}));

vi.mock("@/api", () => ({
  api: {
    groups: {
      groupsDetail: apiMocks.groupsDetail,
      groupsUpdate: apiMocks.groupsUpdate,
      groupsMembersCreate: apiMocks.groupsMembersCreate,
      groupsMembersDelete: apiMocks.groupsMembersDelete,
    },
    contacts: {
      contactsSelectableList: apiMocks.contactsSelectableList,
    },
    vaults: { vaultsDetail: apiMocks.vaultsDetail },
    preferences: { preferencesList: apiMocks.preferencesList },
  },
}));

vi.mock("@/components/ContactAvatar", () => ({
  default: () => <div data-testid="contact-avatar" />,
}));

const members = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Alice Zephyr",
    first_name: "Alice",
    last_name: "Zephyr",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Bob Yellow",
    first_name: "Bob",
    last_name: "Yellow",
  },
] as const;

const candidates = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Carol Xavier",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Dave Winter",
  },
] as const;

function renderGroupDetail() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  render(
    <ConfigProvider>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/vaults/vault-1/groups/7"]}>
            <Routes>
              <Route
                path="/vaults/:id/groups/:groupId"
                element={<GroupDetail />}
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>,
  );

  return queryClient;
}

async function addContacts(names: readonly string[]) {
  await userEvent.click(
    await screen.findByRole("button", { name: /add members/i }),
  );
  for (const name of names) {
    await userEvent.click(
      await screen.findByRole("checkbox", {
        name: new RegExp(`select ${name}`, "i"),
      }),
    );
  }
  await userEvent.click(screen.getByRole("button", { name: /add selected/i }));
}

describe("GroupDetail mutation feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.groupsDetail.mockResolvedValue({
      data: { id: 7, name: "Friends", contacts: members },
    });
    apiMocks.contactsSelectableList.mockResolvedValue({ data: candidates });
    apiMocks.vaultsDetail.mockResolvedValue({
      data: { effective_name_order: "%first_name% %last_name%" },
    });
    apiMocks.preferencesList.mockResolvedValue({
      data: { name_order: "%first_name% %last_name%" },
    });
    apiMocks.groupsUpdate.mockResolvedValue({ data: {} });
  });

  it("shows no-op feedback when adding affects no members", async () => {
    apiMocks.groupsMembersCreate.mockResolvedValue({
      data: { affected_count: 0 },
    });
    renderGroupDetail();

    await addContacts(["Carol Xavier"]);

    expect(await screen.findByText("No members added")).toBeVisible();
  });

  it("scopes selectable contact results to the current group", async () => {
    const queryClient = renderGroupDetail();

    await userEvent.click(
      await screen.findByRole("button", { name: /add members/i }),
    );

    await waitFor(() => {
      expect(
        queryClient.getQueryData([
          "vaults",
          "vault-1",
          "contacts",
          "selectable-for-group",
          7,
          "",
        ]),
      ).toBeDefined();
    });
  });

  it("shows the response count when adding affects multiple members", async () => {
    apiMocks.groupsMembersCreate.mockResolvedValue({
      data: { affected_count: 7 },
    });
    renderGroupDetail();

    await addContacts(["Carol Xavier", "Dave Winter"]);

    expect(await screen.findByText("7 members added")).toBeVisible();
  });

  it("shows no-op feedback when removing affects no members", async () => {
    apiMocks.groupsMembersDelete.mockResolvedValue({
      data: { affected_count: 0 },
    });
    renderGroupDetail();

    await userEvent.click(
      await screen.findByRole("button", { name: /remove alice zephyr/i }),
    );
    await userEvent.click(await screen.findByRole("button", { name: /ok/i }));

    expect(await screen.findByText("No members removed")).toBeVisible();
  });

  it("preserves unrelated selections after a per-row removal", async () => {
    apiMocks.groupsMembersDelete.mockResolvedValue({
      data: { affected_count: 1 },
    });
    renderGroupDetail();
    const bobCheckbox = await screen.findByRole("checkbox", {
      name: /select bob yellow/i,
    });
    await userEvent.click(bobCheckbox);

    await userEvent.click(
      screen.getByRole("button", { name: /remove alice zephyr/i }),
    );
    await userEvent.click(await screen.findByRole("button", { name: /ok/i }));

    await waitFor(() => {
      expect(apiMocks.groupsMembersDelete).toHaveBeenCalledWith("vault-1", 7, {
        contact_ids: [members[0].id],
      });
    });
    expect(bobCheckbox).toBeChecked();
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument();
  });
});
