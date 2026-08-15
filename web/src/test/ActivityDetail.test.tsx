import { App as AntApp, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ActivityDetail from "@/pages/vault/ActivityDetail";

const mentionedId = "550e8400-e29b-41d4-a716-446655440000";
const participantId = "550e8400-e29b-41d4-a716-446655440001";
const mocks = vi.hoisted(() => ({ detail: vi.fn() }));

vi.mock("@/api", () => ({
  api: {
    activities: {
      activitiesDetail: (...args: unknown[]) => mocks.detail(...args),
    },
    preferences: {
      preferencesList: vi.fn().mockResolvedValue({
        data: { name_order: "%first_name% %last_name%" },
      }),
    },
  },
  httpClient: {
    instance: { get: vi.fn().mockResolvedValue({ data: new Blob([]) }) },
  },
}));

function renderDetail() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ConfigProvider>
        <AntApp>
          <MemoryRouter initialEntries={["/vaults/vault-1/activities/42"]}>
            <Routes>
              <Route
                path="/vaults/:id/activities/:activityId"
                element={<ActivityDetail />}
              />
            </Routes>
          </MemoryRouter>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>,
  );
}

describe("ActivityDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.detail.mockResolvedValue({
      data: {
        id: 42,
        title: "Dinner",
        description: `Met @[Alice Mentioned](contact:${mentionedId})`,
        place: "Cafe",
        activity_type: { label: "Meal" },
        subject_user_id: "user-1",
        subject_user_name: "Activity Owner",
        subject_is_current_user: true,
        participants: [
          { id: mentionedId, first_name: "Alice", last_name: "Mentioned" },
          { id: participantId, first_name: "Bob", last_name: "Participant" },
        ],
        mentioned_contacts: [
          { id: mentionedId, first_name: "Alice", last_name: "Mentioned" },
        ],
      },
    });
  });

  it("restores a direct deep link and keeps description mentions separate from participants", async () => {
    renderDetail();

    expect(
      await screen.findByRole("heading", { name: "Dinner" }),
    ).toBeInTheDocument();
    expect(mocks.detail).toHaveBeenCalledWith("vault-1", 42);
    expect(screen.getByText("Cafe")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();

    const aliceLinks = screen.getAllByRole("link", { name: "Alice Mentioned" });
    expect(aliceLinks).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: "Bob Participant" }),
    ).toHaveAttribute("href", `/vaults/vault-1/contacts/${participantId}`);
    expect(screen.queryByText("@Bob Participant")).not.toBeInTheDocument();
  });

  it("still displays participants when the description is empty", async () => {
    mocks.detail.mockResolvedValueOnce({
      data: {
        id: 42,
        title: "Silent activity",
        description: "",
        participants: [
          { id: participantId, first_name: "Bob", last_name: "Participant" },
        ],
        mentioned_contacts: [],
      },
    });

    renderDetail();

    expect(await screen.findByText("No description")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Bob Participant" }),
    ).toBeInTheDocument();
  });
});
