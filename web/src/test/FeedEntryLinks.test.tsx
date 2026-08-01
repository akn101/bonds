import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { App as AntApp, ConfigProvider } from "antd";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FeedModule from "@/pages/contact/modules/FeedModule";
import VaultFeed from "@/pages/vault/VaultFeed";

const apiMocks = vi.hoisted(() => ({
  contactsFeedList: vi.fn(),
  feedList: vi.fn(),
}));

vi.mock("@/api", () => ({
  api: {
    feed: {
      contactsFeedList: apiMocks.contactsFeedList,
      feedList: apiMocks.feedList,
    },
  },
}));

const feedItems = [
  {
    id: 1,
    action: "note_updated",
    description: "Updated note",
    contact_id: "contact-1",
    contact_linkable: true,
    contact_name: "Alice Linkable",
    created_at: "2026-01-15T10:30:00Z",
    source: {
      available: true,
      id: 17,
      kind: "Note",
      module: "notes",
    },
  },
  {
    id: 2,
    action: "note_deleted",
    description: "Deleted note",
    contact_id: "contact-2",
    contact_linkable: true,
    contact_name: "Bob Available Contact",
    created_at: "2026-01-15T10:30:00Z",
    source: {
      available: false,
      id: 18,
      kind: "Note",
      module: "notes",
    },
  },
  {
    id: 3,
    action: "note_orphaned",
    description: "Orphaned note",
    contact_id: "contact-3",
    contact_linkable: false,
    contact_name: "Carol Orphaned",
    created_at: "2026-01-15T10:30:00Z",
    source: {
      available: true,
      id: 19,
      kind: "Note",
      module: "notes",
    },
  },
] as const;

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function renderVaultFeed() {
  return render(
    <ConfigProvider>
      <AntApp>
        <QueryClientProvider client={createQueryClient()}>
          <MemoryRouter initialEntries={["/vaults/vault-1/feed"]}>
            <Routes>
              <Route path="/vaults/:id/feed" element={<VaultFeed />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>,
  );
}

function renderContactFeed() {
  return render(
    <ConfigProvider>
      <AntApp>
        <QueryClientProvider client={createQueryClient()}>
          <MemoryRouter initialEntries={["/vaults/vault-1/contacts/contact-1"]}>
            <FeedModule vaultId="vault-1" contactId="contact-1" />
          </MemoryRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>,
  );
}

async function expectFeedEntryLinks() {
  const sourcePath =
    "/vaults/vault-1/contacts/contact-1?focus=notes&source=Note:17";

  expect(
    await screen.findByRole("link", { name: "Alice Linkable" }),
  ).toHaveAttribute("href", "/vaults/vault-1/contacts/contact-1");
  expect(screen.getByRole("link", { name: "note_updated" })).toHaveAttribute(
    "href",
    sourcePath,
  );
  expect(screen.getByRole("link", { name: "Updated note" })).toHaveAttribute(
    "href",
    sourcePath,
  );

  expect(
    screen.getByRole("link", { name: "Bob Available Contact" }),
  ).toHaveAttribute("href", "/vaults/vault-1/contacts/contact-2");
  expect(screen.getByText("note_deleted")).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "note_deleted" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Deleted note")).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Deleted note" }),
  ).not.toBeInTheDocument();

  expect(screen.getByText("Carol Orphaned")).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Carol Orphaned" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "note_orphaned" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Orphaned note" }),
  ).not.toBeInTheDocument();
}

describe("Feed entry links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const response = {
      data: feedItems,
      meta: { page: 1, total_pages: 1 },
    };
    apiMocks.feedList.mockResolvedValue(response);
    apiMocks.contactsFeedList.mockResolvedValue(response);
  });

  it("renders precise and fallback link semantics in VaultFeed", async () => {
    // When
    renderVaultFeed();

    // Then
    await expectFeedEntryLinks();
  });

  it("renders precise and fallback link semantics in FeedModule", async () => {
    // When
    renderContactFeed();

    // Then
    await expectFeedEntryLinks();
  });
});
