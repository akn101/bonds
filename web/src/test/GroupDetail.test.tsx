import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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
    name: "Zephyr, Alice (Ace)",
    first_name: "Alice",
    last_name: "Zephyr",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Bob Yellow",
    first_name: "Bob",
    last_name: "Yellow",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Carol Xavier",
    first_name: "Carol",
    last_name: "Xavier",
  },
] as const;

const candidates = [
  members[0],
  {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Dave Winter",
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    name: "Erin Violet",
  },
] as const;

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

function renderGroupDetail() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

  render(
    <ConfigProvider>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/vaults/vault-1/groups/7"]}>
            <Routes>
              <Route
                path="/vaults/:id/groups/:groupId"
                element={
                  <>
                    <LocationProbe />
                    <GroupDetail />
                  </>
                }
              />
              <Route path="*" element={<LocationProbe />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>,
  );

  return { invalidateQueries };
}

async function openAddMembers() {
  await userEvent.click(
    await screen.findByRole("button", { name: /add members/i }),
  );
  return screen.findByRole("region", { name: /select contacts/i });
}

async function selectContact(name: string) {
  const panel = screen.getByRole("region", { name: /select contacts/i });
  await userEvent.click(
    await within(panel).findByRole("checkbox", {
      name: new RegExp(`select ${name}`, "i"),
    }),
  );
}

describe("GroupDetail batch member management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.groupsDetail.mockResolvedValue({
      data: { id: 7, name: "Friends", contacts: members },
    });
    apiMocks.contactsSelectableList.mockImplementation(
      (_vaultId: string, query?: { search?: string }) => {
        const search = query?.search?.toLowerCase() ?? "";
        return Promise.resolve({
          data: candidates.filter((contact) =>
            contact.name.toLowerCase().includes(search),
          ),
        });
      },
    );
    apiMocks.vaultsDetail.mockResolvedValue({
      data: { effective_name_order: "%first_name% %last_name%" },
    });
    apiMocks.preferencesList.mockResolvedValue({
      data: { name_order: "%first_name% %last_name%" },
    });
    apiMocks.groupsMembersCreate.mockResolvedValue({
      data: { affected_count: 2 },
    });
    apiMocks.groupsMembersDelete.mockResolvedValue({
      data: { affected_count: 2 },
    });
    apiMocks.groupsUpdate.mockResolvedValue({ data: {} });
  });

  it("excludes current members from remotely searched add candidates", async () => {
    renderGroupDetail();
    const panel = await openAddMembers();

    expect(
      within(panel).queryByRole("checkbox", {
        name: /select zephyr, alice/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      await within(panel).findByRole("checkbox", {
        name: /select dave winter/i,
      }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("list", { name: /select contacts/i }),
    ).toBeInTheDocument();
    expect(apiMocks.contactsSelectableList).toHaveBeenCalledWith("vault-1", {
      search: "",
    });
  });

  it("adds multiple contacts in one request and resets only add state", async () => {
    const { invalidateQueries } = renderGroupDetail();
    const panel = await openAddMembers();
    await selectContact("Dave Winter");

    const search = within(panel).getByRole("searchbox", {
      name: /search contacts/i,
    });
    await userEvent.type(search, "Erin");
    await selectContact("Erin Violet");
    expect(within(panel).getByText(/2 selected/i)).toBeInTheDocument();

    await userEvent.click(
      within(panel).getByRole("button", { name: /add selected/i }),
    );

    await waitFor(() => {
      expect(apiMocks.groupsMembersCreate).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.groupsMembersCreate).toHaveBeenCalledWith("vault-1", 7, {
      contact_ids: [candidates[1].id, candidates[2].id],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["vaults", "vault-1", "groups", "7"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["vaults", "vault-1", "groups"],
    });
    expect(
      await screen.findByRole("button", { name: /add members/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: /select contacts/i }),
    ).not.toBeInTheDocument();
  });

  it("merges add-panel select-all-visible with hidden selected contacts", async () => {
    renderGroupDetail();
    const panel = await openAddMembers();
    await selectContact("Dave Winter");

    const search = within(panel).getByRole("searchbox", {
      name: /search contacts/i,
    });
    await userEvent.type(search, "Erin");
    await userEvent.click(
      await within(panel).findByRole("checkbox", {
        name: /select all visible/i,
      }),
    );

    expect(within(panel).getByText(/2 selected/i)).toBeInTheDocument();
    await userEvent.clear(search);
    expect(
      await within(panel).findByRole("checkbox", {
        name: /select dave winter/i,
      }),
    ).toBeChecked();
    expect(
      within(panel).getByRole("checkbox", { name: /select erin violet/i }),
    ).toBeChecked();
  });

  it("merges select-all-visible with hidden selected members", async () => {
    renderGroupDetail();
    const aliceCheckbox = await screen.findByRole("checkbox", {
      name: /select zephyr, alice/i,
    });
    await userEvent.click(aliceCheckbox);

    const search = screen.getByRole("searchbox", { name: /search members/i });
    await userEvent.type(search, "Bob");
    await userEvent.click(
      screen.getByRole("checkbox", { name: /select all visible/i }),
    );

    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();
    await userEvent.clear(search);
    expect(aliceCheckbox).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /select bob yellow/i }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /select carol xavier/i }),
    ).not.toBeChecked();
  });

  it("removes selected members in one batch request and keeps the search", async () => {
    const { invalidateQueries } = renderGroupDetail();
    const search = await screen.findByRole("searchbox", {
      name: /search members/i,
    });
    await userEvent.type(search, "Bob");
    await userEvent.click(
      screen.getByRole("checkbox", { name: /select all visible/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /remove selected/i }),
    );
    await userEvent.click(await screen.findByRole("button", { name: /ok/i }));

    await waitFor(() => {
      expect(apiMocks.groupsMembersDelete).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.groupsMembersDelete).toHaveBeenCalledWith("vault-1", 7, {
      contact_ids: [members[1].id],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["vaults", "vault-1", "groups", "7"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["vaults", "vault-1", "groups"],
    });
    expect(search).toHaveValue("Bob");
    expect(screen.getByText(/0 selected/i)).toBeInTheDocument();
  });

  it("uses the batch endpoint with one string ID for per-row removal", async () => {
    renderGroupDetail();
    await userEvent.click(
      await screen.findByRole("button", { name: /remove zephyr, alice/i }),
    );
    await userEvent.click(await screen.findByRole("button", { name: /ok/i }));

    await waitFor(() => {
      expect(apiMocks.groupsMembersDelete).toHaveBeenCalledWith("vault-1", 7, {
        contact_ids: [members[0].id],
      });
    });
  });

  it("disables empty submissions and sends no request", async () => {
    renderGroupDetail();
    const panel = await openAddMembers();

    expect(
      within(panel).getByRole("button", { name: /add selected/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /remove selected/i }),
    ).toBeDisabled();
    expect(apiMocks.groupsMembersCreate).not.toHaveBeenCalled();
    expect(apiMocks.groupsMembersDelete).not.toHaveBeenCalled();
  });

  it("shows the add-panel loading state", async () => {
    apiMocks.contactsSelectableList.mockReturnValueOnce(new Promise(() => {}));
    renderGroupDetail();
    const loadingPanel = await openAddMembers();
    expect(
      within(loadingPanel).getByRole("status", { name: /loading/i }),
    ).toBeInTheDocument();
  });

  it("distinguishes empty and filtered-empty add-panel states", async () => {
    apiMocks.contactsSelectableList.mockImplementation(
      (_vaultId: string, query?: { search?: string }) =>
        Promise.resolve({
          data: query?.search === "Nobody" ? [] : [members[0]],
        }),
    );
    renderGroupDetail();
    const emptyPanel = await openAddMembers();
    expect(
      await within(emptyPanel).findByText(/no contacts yet/i),
    ).toBeVisible();

    const search = within(emptyPanel).getByRole("searchbox", {
      name: /search contacts/i,
    });
    await userEvent.type(search, "Nobody");
    expect(
      await within(emptyPanel).findByText(/no contacts match your search/i),
    ).toBeVisible();
  });

  it("preserves hidden add selections when remote search fails", async () => {
    renderGroupDetail();
    const panel = await openAddMembers();
    await selectContact("Dave Winter");
    apiMocks.contactsSelectableList.mockRejectedValue({
      message: "Unable to search contacts",
    });

    await userEvent.type(
      within(panel).getByRole("searchbox", { name: /search contacts/i }),
      "Unavailable",
    );

    await waitFor(() => {
      expect(apiMocks.contactsSelectableList).toHaveBeenCalledWith("vault-1", {
        search: "Unavailable",
      });
    });
    expect(await within(panel).findByText(/^error$/i)).toBeVisible();
    expect(within(panel).getByText(/1 selected/i)).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: /add selected/i }),
    ).toBeEnabled();
  });

  it("cancels add selection without submitting", async () => {
    renderGroupDetail();
    const panel = await openAddMembers();
    await selectContact("Dave Winter");

    await userEvent.click(
      within(panel).getByRole("button", { name: /cancel/i }),
    );

    expect(apiMocks.groupsMembersCreate).not.toHaveBeenCalled();
    const reopenedPanel = await openAddMembers();
    expect(within(reopenedPanel).getByText(/0 selected/i)).toBeInTheDocument();
    expect(
      within(reopenedPanel).getByRole("button", { name: /add selected/i }),
    ).toBeDisabled();
  });

  it("preserves add selection and skips invalidation on API error", async () => {
    apiMocks.groupsMembersCreate.mockRejectedValueOnce({
      message: "Unable to add members",
    });
    const { invalidateQueries } = renderGroupDetail();
    const panel = await openAddMembers();
    await selectContact("Dave Winter");
    await userEvent.click(
      within(panel).getByRole("button", { name: /add selected/i }),
    );

    await waitFor(() => {
      expect(apiMocks.groupsMembersCreate).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Unable to add members")).toBeVisible();
    expect(
      within(panel).getByRole("checkbox", { name: /select dave winter/i }),
    ).toBeChecked();
    expect(within(panel).getByText(/1 selected/i)).toBeInTheDocument();
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("preserves remove selection and skips invalidation on API error", async () => {
    apiMocks.groupsMembersDelete.mockRejectedValueOnce({
      message: "Unable to remove members",
    });
    const { invalidateQueries } = renderGroupDetail();
    await userEvent.click(
      await screen.findByRole("checkbox", { name: /select bob yellow/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /remove selected/i }),
    );
    await userEvent.click(await screen.findByRole("button", { name: /ok/i }));

    await waitFor(() => {
      expect(apiMocks.groupsMembersDelete).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Unable to remove members")).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: /select bob yellow/i }),
    ).toBeChecked();
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument();
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("keeps checkbox and remove clicks on the page while member names navigate", async () => {
    renderGroupDetail();
    const location = screen.getByTestId("location-probe");

    await userEvent.click(
      await screen.findByRole("checkbox", { name: /select zephyr, alice/i }),
    );
    expect(location).toHaveTextContent("/vaults/vault-1/groups/7");

    await userEvent.click(
      screen.getByRole("button", { name: /remove zephyr, alice/i }),
    );
    expect(location).toHaveTextContent("/vaults/vault-1/groups/7");
    await userEvent.keyboard("{Escape}");

    const memberLink = screen.getByRole("link", {
      name: "Zephyr, Alice (Ace)",
    });
    expect(within(memberLink).getByText("Zephyr, Alice (Ace)")).toBeVisible();
    await userEvent.click(memberLink);
    expect(location).toHaveTextContent(
      `/vaults/vault-1/contacts/${members[0].id}`,
    );
  });

  it("supports keyboard add selection without navigation", async () => {
    renderGroupDetail();
    const location = screen.getByTestId("location-probe");
    const panel = await openAddMembers();
    const checkbox = await within(panel).findByRole("checkbox", {
      name: /select dave winter/i,
    });

    checkbox.focus();
    await userEvent.keyboard(" ");

    expect(checkbox).toBeChecked();
    expect(location).toHaveTextContent("/vaults/vault-1/groups/7");
  });

  it("prefers backend-formatted member names", async () => {
    renderGroupDetail();

    expect(await screen.findByText("Zephyr, Alice (Ace)")).toBeInTheDocument();
    expect(screen.queryByText("Alice Zephyr")).not.toBeInTheDocument();
  });
});
