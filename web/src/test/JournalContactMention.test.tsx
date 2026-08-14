import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App as AntApp, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ContactMentionText from "@/components/journal/ContactMentionText";

const CONTACT_ID = "550e8400-e29b-41d4-a716-446655440000";
const mockAvatarGet = vi.fn().mockResolvedValue({ data: new Blob([]) });
const mockPreferencesList = vi.fn();

vi.mock("@/api", () => ({
  api: {
    preferences: {
      preferencesList: (...args: unknown[]) => mockPreferencesList(...args),
    },
  },
  httpClient: {
    instance: { get: (...args: unknown[]) => mockAvatarGet(...args) },
  },
}));

type MentionContact = {
  readonly id: string;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly middle_name?: string;
  readonly nickname?: string;
  readonly maiden_name?: string;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly job_position?: string;
  readonly last_talked_to?: string;
};

function renderMentionText(
  parentClick: () => void,
  contacts: readonly MentionContact[] = [
    { id: CONTACT_ID, first_name: "Current", last_name: "Name" },
  ],
  content = `Hello @[Stale Name](contact:${CONTACT_ID}). Visit https://example.com. Malformed @[No Link](contact:not-a-uuid).`,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConfigProvider>
        <AntApp>
          <MemoryRouter>
            <div onClick={parentClick}>
              <ContactMentionText vaultId="v1" contacts={contacts}>
                {content}
              </ContactMentionText>
            </div>
          </MemoryRouter>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>,
  );
}

function renderUnassociatedMentionText(
  content = `Hello @[Saved Name](contact:${CONTACT_ID}).`,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConfigProvider>
        <AntApp>
          <MemoryRouter>
            <ContactMentionText vaultId="v1" contacts={[]}>
              {content}
            </ContactMentionText>
          </MemoryRouter>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>,
  );
}

describe("ContactMentionText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPreferencesList.mockResolvedValue({
      data: { name_order: "%first_name% %last_name%" },
    });
  });

  it("renders exact UUID mentions with the current custom-order contact name and preserves ordinary linkification", async () => {
    mockPreferencesList.mockResolvedValue({
      data: {
        name_order:
          "%last_name%, %first_name% {nickname? (%nickname%)}",
      },
    });
    renderMentionText(vi.fn(), [
      {
        id: CONTACT_ID,
        first_name: "Alice",
        last_name: "Zephyr",
        nickname: "Ace",
      },
    ]);

    const contactLink = await screen.findByRole("link", {
      name: "Zephyr, Alice (Ace)",
    });
    expect(contactLink).toHaveAttribute(
      "href",
      `/vaults/v1/contacts/${CONTACT_ID}`,
    );
    expect(screen.queryByText("Stale Name")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Malformed @\[No Link\]\(contact:not-a-uuid\)\./),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "https://example.com" }),
    ).toHaveAttribute("href", "https://example.com");
  });

  it("renders the current contact name for a marker with an encoded saved name", async () => {
    renderMentionText(
      vi.fn(),
      [{ id: CONTACT_ID, first_name: "Current", last_name: "Name" }],
      `Hello @[Stale \\] \\\\ Name](contact:${CONTACT_ID}).`,
    );

    expect(
      await screen.findByRole("link", { name: "Current Name" }),
    ).toHaveAttribute("href", `/vaults/v1/contacts/${CONTACT_ID}`);
    expect(screen.queryByText("Stale ] \\ Name")).not.toBeInTheDocument();
  });

  it("renders a nickname-only current name when generated contact fields provide it", async () => {
    mockPreferencesList.mockResolvedValue({
      data: { name_order: "%nickname%" },
    });
    renderMentionText(vi.fn(), [{ id: CONTACT_ID, nickname: "Ace" }]);

    expect(await screen.findByRole("link", { name: "Ace" })).toHaveAttribute(
      "href",
      `/vaults/v1/contacts/${CONTACT_ID}`,
    );
    expect(screen.queryByText("Stale Name")).not.toBeInTheDocument();
  });

  it("stops parent navigation and exposes the contact card on keyboard focus", async () => {
    const parentClick = vi.fn();
    renderMentionText(parentClick, [
      {
        id: CONTACT_ID,
        first_name: "Current",
        last_name: "Name",
        nickname: "Ace",
        job_position: "Designer",
        last_talked_to: "2026-08-01T10:00:00Z",
      },
    ]);
    const contactLink = screen.getByRole("link", { name: "Current Name" });

    fireEvent.click(contactLink);
    expect(parentClick).not.toHaveBeenCalled();

    fireEvent.focus(contactLink);
    const contactCardLink = await screen.findByRole("link", {
      name: "View contact: Current Name",
    });
    expect(screen.getByText("Nickname: Ace")).toBeInTheDocument();
    expect(screen.getByText("Position: Designer")).toBeInTheDocument();
    expect(screen.getByText("Last talked Aug 1, 2026")).toBeInTheDocument();
    expect(contactCardLink).toHaveAttribute(
      "href",
      `/vaults/v1/contacts/${CONTACT_ID}`,
    );
    await waitFor(() => expect(mockAvatarGet).toHaveBeenCalled());
  });

  it("renders the saved display name when a valid mention is no longer associated", () => {
    const { container } = renderUnassociatedMentionText();

    expect(container).toHaveTextContent("Hello Saved Name.");
    expect(screen.queryByText(/contact:/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Saved Name" }),
    ).not.toBeInTheDocument();
  });

  it("renders the decoded saved display name when a contact is no longer associated", () => {
    const savedContactName = "Saved ] \\ Name";
    const { container } = renderUnassociatedMentionText(
      `Hello @[Saved \\] \\\\ Name](contact:${CONTACT_ID}).`,
    );

    expect(container).toHaveTextContent(`Hello ${savedContactName}.`);
    expect(screen.queryByText(/contact:/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: savedContactName }),
    ).not.toBeInTheDocument();
  });

  it("appends an associated contact when legacy text has no matching marker", async () => {
    const { container } = renderMentionText(
      vi.fn(),
      [{ id: CONTACT_ID, first_name: "Alice", last_name: "Example" }],
      "A legacy journal entry.",
    );

    expect(container).toHaveTextContent(
      "A legacy journal entry. @Alice Example",
    );
    expect(
      await screen.findByRole("link", { name: "@Alice Example" }),
    ).toHaveAttribute("href", `/vaults/v1/contacts/${CONTACT_ID}`);
  });
});
