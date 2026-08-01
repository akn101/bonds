import { App as AntApp, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api";
import LifeEventsModule from "@/pages/contact/modules/LifeEventsModule";

type TimelineDatePickerProps = {
  readonly onChange?: (value: { readonly toISOString: () => string }) => void;
};

type CalendarAwareDatePickerProps = {
  readonly onChange?: (value: {
    readonly date: { readonly toISOString: () => string };
    readonly calendarType: "gregorian";
    readonly originalDay: null;
    readonly originalMonth: null;
    readonly originalYear: null;
  }) => void;
};

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

type RenderLifeEventsModuleOptions = {
  readonly invalidationCompletion?: Deferred<void>;
  readonly heldQueryKey?: QueryKey;
};

const appMessageMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  return {
    ...actual,
    App: Object.assign(actual.App, {
      useApp: () => ({ message: appMessageMock }),
    }),
    DatePicker: ({ onChange }: TimelineDatePickerProps) => (
      <button
        type="button"
        onClick={() =>
          onChange?.({ toISOString: () => "2026-01-15T00:00:00.000Z" })
        }
      >
        Set timeline date
      </button>
    ),
  };
});

vi.mock("@/api", () => ({
  api: {
    contacts: { contactsList: vi.fn() },
    lifeEvents: {
      contactsTimelineEventsList: vi.fn(),
      contactsTimelineEventsCreate: vi.fn(),
      contactsTimelineEventsDelete: vi.fn(),
      contactsTimelineEventsToggleUpdate: vi.fn(),
      contactsTimelineEventsLifeEventsCreate: vi.fn(),
      contactsTimelineEventsLifeEventsUpdate: vi.fn(),
      contactsTimelineEventsLifeEventsDelete: vi.fn(),
      contactsTimelineEventsLifeEventsToggleUpdate: vi.fn(),
    },
    preferences: { preferencesList: vi.fn() },
    vaultSettings: { settingsLifeEventCategoriesList: vi.fn() },
  },
}));

vi.mock("@/components/CalendarAwareDatePicker", () => ({
  default: ({ onChange }: CalendarAwareDatePickerProps) => (
    <button
      type="button"
      onClick={() =>
        onChange?.({
          date: { toISOString: () => "2026-02-15T00:00:00.000Z" },
          calendarType: "gregorian",
          originalDay: null,
          originalMonth: null,
          originalYear: null,
        })
      }
    >
      Set life event date
    </button>
  ),
}));

const timelineQueryKey = [
  "vaults",
  101,
  "contacts",
  202,
  "timelineEvents",
] as const;
const feedQueryKeys = [
  ["vaults", "101", "feed"],
  ["vaults", "101", "contacts", "202", "feed"],
] as const;
const existingTimeline = {
  id: 7,
  label: "Existing timeline",
  started_at: "2026-01-01T00:00:00Z",
  collapsed: false,
  life_events: [
    {
      id: 8,
      summary: "Existing event",
      happened_at: "2026-01-02T00:00:00Z",
      collapsed: false,
      life_event_type_id: 11,
    },
  ],
};

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  if (resolvePromise === undefined) {
    throw new Error("deferred promise did not expose its resolver");
  }
  return { promise, resolve: resolvePromise };
}

function lifeEventsView(
  queryClient: QueryClient,
  vaultId: string | number,
  contactId: string | number,
) {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider>
        <AntApp>
          <MemoryRouter>
            <LifeEventsModule vaultId={vaultId} contactId={contactId} />
          </MemoryRouter>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
}

function renderLifeEventsModule({
  invalidationCompletion,
  heldQueryKey,
}: RenderLifeEventsModuleOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const originalInvalidateQueries =
    queryClient.invalidateQueries.bind(queryClient);
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  if (invalidationCompletion !== undefined) {
    invalidateQueries.mockImplementation((filters = {}, options) => {
      const holdsInvalidation =
        heldQueryKey === undefined
          ? filters.queryKey?.at(-1) === "feed"
          : JSON.stringify(filters.queryKey) === JSON.stringify(heldQueryKey);
      if (holdsInvalidation) {
        return invalidationCompletion.promise;
      }
      return originalInvalidateQueries(filters, options);
    });
  }

  const view = render(lifeEventsView(queryClient, 101, 202));

  return { invalidateQueries, queryClient, view };
}

function expectExactInvalidationKeys(
  invalidateQueries: ReturnType<typeof vi.spyOn>,
  expectedKeys: readonly (readonly unknown[])[],
): void {
  expect(invalidateQueries).toHaveBeenCalledTimes(expectedKeys.length);
  expect(
    invalidateQueries.mock.calls.map(
      (call: Parameters<QueryClient["invalidateQueries"]>) => call[0]?.queryKey,
    ),
  ).toEqual(expectedKeys);
}

async function openExistingTimeline(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  const timelineLabel = await screen.findByText(/Existing timeline/);
  await user.click(timelineLabel);
  await screen.findByText("Existing event");
}

describe("LifeEventsModule local query invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.contacts.contactsList).mockResolvedValue({ data: [] });
    vi.mocked(api.preferences.preferencesList).mockResolvedValue({
      data: { enable_alternative_calendar: false },
    });
    vi.mocked(
      api.vaultSettings.settingsLifeEventCategoriesList,
    ).mockResolvedValue({ data: [] });
    vi.mocked(api.lifeEvents.contactsTimelineEventsList).mockResolvedValue({
      data: [],
      meta: { page: 1, per_page: 15, total: 0, total_pages: 1 },
    });
    vi.mocked(api.lifeEvents.contactsTimelineEventsCreate).mockResolvedValue({
      data: {},
    });
    vi.mocked(api.lifeEvents.contactsTimelineEventsDelete).mockResolvedValue({
      data: {},
    });
    vi.mocked(
      api.lifeEvents.contactsTimelineEventsToggleUpdate,
    ).mockResolvedValue({ data: {} });
    vi.mocked(
      api.lifeEvents.contactsTimelineEventsLifeEventsCreate,
    ).mockResolvedValue({ data: {} });
    vi.mocked(
      api.lifeEvents.contactsTimelineEventsLifeEventsUpdate,
    ).mockResolvedValue({ data: {} });
    vi.mocked(
      api.lifeEvents.contactsTimelineEventsLifeEventsDelete,
    ).mockResolvedValue({ data: {} });
    vi.mocked(
      api.lifeEvents.contactsTimelineEventsLifeEventsToggleUpdate,
    ).mockResolvedValue({ data: {} });
  });

  it("keeps invalidating the timeline list when create succeeds", async () => {
    const user = userEvent.setup();
    const { invalidateQueries } = renderLifeEventsModule();

    await screen.findByText("No life event timelines");
    await user.click(screen.getByRole("button", { name: /new timeline/i }));
    await user.type(
      screen.getByRole("textbox", { name: /label/i }),
      "Created timeline",
    );
    await user.click(
      screen.getByRole("button", { name: /set timeline date/i }),
    );
    await user.click(screen.getByRole("button", { name: /ok/i }));

    await waitFor(() =>
      expect(appMessageMock.success).toHaveBeenCalledWith("Timeline created"),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: timelineQueryKey,
    });
  });
});

describe("LifeEventsModule Feed invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.contacts.contactsList).mockResolvedValue({ data: [] });
    vi.mocked(api.preferences.preferencesList).mockResolvedValue({
      data: { enable_alternative_calendar: false },
    });
    vi.mocked(
      api.vaultSettings.settingsLifeEventCategoriesList,
    ).mockResolvedValue({
      data: [
        {
          id: 5,
          label: "Milestones",
          types: [{ id: 11, label: "Achievement" }],
        },
      ],
    });
    vi.mocked(api.lifeEvents.contactsTimelineEventsList).mockResolvedValue({
      data: [existingTimeline],
      meta: { page: 1, per_page: 15, total: 1, total_pages: 1 },
    });
    vi.mocked(api.lifeEvents.contactsTimelineEventsCreate).mockResolvedValue({
      data: {},
    });
    vi.mocked(api.lifeEvents.contactsTimelineEventsDelete).mockResolvedValue({
      data: {},
    });
    vi.mocked(
      api.lifeEvents.contactsTimelineEventsToggleUpdate,
    ).mockResolvedValue({ data: {} });
    vi.mocked(
      api.lifeEvents.contactsTimelineEventsLifeEventsCreate,
    ).mockResolvedValue({ data: {} });
    vi.mocked(
      api.lifeEvents.contactsTimelineEventsLifeEventsUpdate,
    ).mockResolvedValue({ data: {} });
    vi.mocked(
      api.lifeEvents.contactsTimelineEventsLifeEventsDelete,
    ).mockResolvedValue({ data: {} });
    vi.mocked(
      api.lifeEvents.contactsTimelineEventsLifeEventsToggleUpdate,
    ).mockResolvedValue({ data: {} });
  });

  it("invalidates only the submitted timeline and Feed scopes before closing create UI", async () => {
    const user = userEvent.setup();
    const request =
      createDeferred<
        Awaited<ReturnType<typeof api.lifeEvents.contactsTimelineEventsCreate>>
      >();
    const feedInvalidation = createDeferred<void>();
    vi.mocked(api.lifeEvents.contactsTimelineEventsCreate).mockReturnValue(
      request.promise,
    );
    const { invalidateQueries, queryClient, view } = renderLifeEventsModule({
      invalidationCompletion: feedInvalidation,
    });

    await screen.findByText(/Existing timeline/);
    await user.click(screen.getByRole("button", { name: /new timeline/i }));
    await user.type(
      screen.getByRole("textbox", { name: /label/i }),
      "Created timeline",
    );
    await user.click(
      screen.getByRole("button", { name: /set timeline date/i }),
    );
    await user.click(screen.getByRole("button", { name: /ok/i }));
    await waitFor(() =>
      expect(api.lifeEvents.contactsTimelineEventsCreate).toHaveBeenCalledWith(
        "101",
        "202",
        expect.objectContaining({ label: "Created timeline" }),
      ),
    );
    view.rerender(lifeEventsView(queryClient, 303, 404));

    request.resolve({ data: {} });
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalled());

    expectExactInvalidationKeys(invalidateQueries, [
      timelineQueryKey,
      ...feedQueryKeys,
    ]);
    expect(screen.getByDisplayValue("Created timeline")).toBeInTheDocument();
    expect(appMessageMock.success).not.toHaveBeenCalled();

    feedInvalidation.resolve(undefined);
    await waitFor(() =>
      expect(appMessageMock.success).toHaveBeenCalledWith("Timeline created"),
    );
    expect(
      screen.queryByDisplayValue("Created timeline"),
    ).not.toBeInTheDocument();
  });

  it("keeps the refetched timeline visible after Feed invalidation finishes", async () => {
    const user = userEvent.setup();
    const request =
      createDeferred<
        Awaited<ReturnType<typeof api.lifeEvents.contactsTimelineEventsCreate>>
      >();
    const feedInvalidation = createDeferred<void>();
    const createdTimeline = {
      ...existingTimeline,
      id: 9,
      label: "Created timeline",
      life_events: [],
    };
    vi.mocked(api.lifeEvents.contactsTimelineEventsCreate).mockReturnValue(
      request.promise,
    );
    vi.mocked(api.lifeEvents.contactsTimelineEventsList)
      .mockResolvedValueOnce({
        data: [existingTimeline],
        meta: { page: 1, per_page: 15, total: 1, total_pages: 1 },
      })
      .mockResolvedValue({
        data: [existingTimeline, createdTimeline],
        meta: { page: 1, per_page: 15, total: 2, total_pages: 1 },
      });
    renderLifeEventsModule({ invalidationCompletion: feedInvalidation });

    await screen.findByText(/Existing timeline/);
    await user.click(screen.getByRole("button", { name: /new timeline/i }));
    await user.type(
      screen.getByRole("textbox", { name: /label/i }),
      "Created timeline",
    );
    await user.click(
      screen.getByRole("button", { name: /set timeline date/i }),
    );
    await user.click(screen.getByRole("button", { name: /ok/i }));
    await waitFor(() =>
      expect(api.lifeEvents.contactsTimelineEventsCreate).toHaveBeenCalled(),
    );

    request.resolve({ data: {} });
    await screen.findByText(/Created timeline/);

    feedInvalidation.resolve(undefined);
    await waitFor(() =>
      expect(appMessageMock.success).toHaveBeenCalledWith("Timeline created"),
    );
    expect(screen.getByText(/Created timeline/)).toBeInTheDocument();
  });

  it("invalidates the timeline list and exact Feed scopes when timeline delete succeeds", async () => {
    const user = userEvent.setup();
    const { invalidateQueries } = renderLifeEventsModule();

    const timelineLabel = await screen.findByText(/Existing timeline/);
    const timelineHeader = timelineLabel.closest(".ant-collapse-header");
    if (!(timelineHeader instanceof HTMLElement))
      throw new Error("expected a timeline collapse header");
    await user.click(
      within(timelineHeader).getByRole("button", { name: "delete" }),
    );
    await user.click(await screen.findByRole("button", { name: /ok/i }));

    await waitFor(() =>
      expect(appMessageMock.success).toHaveBeenCalledWith("Timeline deleted"),
    );
    expectExactInvalidationKeys(invalidateQueries, [
      timelineQueryKey,
      ...feedQueryKeys,
    ]);
  });

  it("uses the submitted timeline delete source and list identity after route drift", async () => {
    const user = userEvent.setup();
    const request =
      createDeferred<
        Awaited<ReturnType<typeof api.lifeEvents.contactsTimelineEventsDelete>>
      >();
    vi.mocked(api.lifeEvents.contactsTimelineEventsDelete).mockReturnValue(
      request.promise,
    );
    const { invalidateQueries, queryClient, view } = renderLifeEventsModule();

    const timelineLabel = await screen.findByText(/Existing timeline/);
    const timelineHeader = timelineLabel.closest(".ant-collapse-header");
    if (!(timelineHeader instanceof HTMLElement))
      throw new Error("expected a timeline collapse header");
    await user.click(
      within(timelineHeader).getByRole("button", { name: "delete" }),
    );
    await user.click(await screen.findByRole("button", { name: /ok/i }));
    await waitFor(() =>
      expect(api.lifeEvents.contactsTimelineEventsDelete).toHaveBeenCalledWith(
        "101",
        "202",
        7,
      ),
    );

    view.rerender(lifeEventsView(queryClient, 303, 404));
    request.resolve({ data: {} });

    await waitFor(() =>
      expect(appMessageMock.success).toHaveBeenCalledWith("Timeline deleted"),
    );
    expectExactInvalidationKeys(invalidateQueries, [
      timelineQueryKey,
      ...feedQueryKeys,
    ]);
  });

  it("awaits one held timeline delete invalidation before showing success", async () => {
    const user = userEvent.setup();
    const invalidationCompletion = createDeferred<void>();
    const { invalidateQueries } = renderLifeEventsModule({
      invalidationCompletion,
      heldQueryKey: feedQueryKeys[1],
    });

    const timelineLabel = await screen.findByText(/Existing timeline/);
    const timelineHeader = timelineLabel.closest(".ant-collapse-header");
    if (!(timelineHeader instanceof HTMLElement))
      throw new Error("expected a timeline collapse header");
    await user.click(
      within(timelineHeader).getByRole("button", { name: "delete" }),
    );
    await user.click(await screen.findByRole("button", { name: /ok/i }));

    await waitFor(() =>
      expectExactInvalidationKeys(invalidateQueries, [
        timelineQueryKey,
        ...feedQueryKeys,
      ]),
    );
    expect(appMessageMock.success).not.toHaveBeenCalled();

    invalidationCompletion.resolve(undefined);
    await waitFor(() =>
      expect(appMessageMock.success).toHaveBeenCalledWith("Timeline deleted"),
    );
  });

  it("does not invalidate Feed when life event add succeeds", async () => {
    const user = userEvent.setup();
    const { invalidateQueries } = renderLifeEventsModule();

    await screen.findByText(/Existing timeline/);
    await user.click(screen.getByRole("button", { name: "plusEvent" }));
    await user.click(
      screen.getByRole("combobox", { name: /select category/i }),
    );
    await user.click(await screen.findByText("Milestones"));
    await user.click(
      screen.getByRole("combobox", { name: /select event type/i }),
    );
    await user.click(await screen.findByText("Achievement"));
    await user.type(
      screen.getByRole("textbox", { name: /label/i }),
      "Created event",
    );
    await user.click(
      screen.getByRole("button", { name: /set life event date/i }),
    );
    await user.click(screen.getByRole("button", { name: /ok/i }));

    await waitFor(() =>
      expect(appMessageMock.success).toHaveBeenCalledWith("Life event added"),
    );
    expectExactInvalidationKeys(invalidateQueries, [timelineQueryKey]);
  });

  it("does not invalidate Feed when life event update succeeds", async () => {
    const user = userEvent.setup();
    const { invalidateQueries } = renderLifeEventsModule();

    await openExistingTimeline(user);
    const eventContent = screen
      .getByText("Existing event")
      .closest(".ant-timeline-item-content");
    if (!(eventContent instanceof HTMLElement))
      throw new Error("expected life event content");
    await user.click(
      within(eventContent).getByRole("button", { name: "edit" }),
    );
    await user.click(screen.getByRole("button", { name: /ok/i }));

    await waitFor(() =>
      expect(appMessageMock.success).toHaveBeenCalledWith("Life event updated"),
    );
    expectExactInvalidationKeys(invalidateQueries, [timelineQueryKey]);
  });

  it("does not invalidate Feed when life event delete succeeds", async () => {
    const user = userEvent.setup();
    const { invalidateQueries } = renderLifeEventsModule();

    await openExistingTimeline(user);
    const eventContent = screen
      .getByText("Existing event")
      .closest(".ant-timeline-item-content");
    if (!(eventContent instanceof HTMLElement))
      throw new Error("expected life event content");
    await user.click(
      within(eventContent).getByRole("button", { name: "delete" }),
    );
    await user.click(await screen.findByRole("button", { name: /ok/i }));

    await waitFor(() =>
      expect(appMessageMock.success).toHaveBeenCalledWith("Life event deleted"),
    );
    expectExactInvalidationKeys(invalidateQueries, [timelineQueryKey]);
  });

  it("does not invalidate Feed when timeline collapse toggle succeeds", async () => {
    const user = userEvent.setup();
    const { invalidateQueries } = renderLifeEventsModule();

    await screen.findByText(/Existing timeline/);
    await user.click(screen.getByTitle("Toggle timeline"));

    await waitFor(() =>
      expect(appMessageMock.success).toHaveBeenCalledWith("Timeline toggled"),
    );
    expectExactInvalidationKeys(invalidateQueries, [timelineQueryKey]);
  });

  it("does not invalidate Feed when life event collapse toggle succeeds", async () => {
    const user = userEvent.setup();
    const { invalidateQueries } = renderLifeEventsModule();

    await openExistingTimeline(user);
    await user.click(screen.getByTitle("Toggle event"));

    await waitFor(() =>
      expect(appMessageMock.success).toHaveBeenCalledWith("Event toggled"),
    );
    expectExactInvalidationKeys(invalidateQueries, [timelineQueryKey]);
  });
});
