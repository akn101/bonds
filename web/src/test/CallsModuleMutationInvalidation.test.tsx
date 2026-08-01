import { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App as AntApp, ConfigProvider } from "antd";
import {
  QueryClient,
  QueryClientProvider,
  type QueryKey,
} from "@tanstack/react-query";
import CallsModule from "@/pages/contact/modules/CallsModule";
import { api } from "@/api";

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
  };
});

vi.mock("@/api", () => ({
  api: {
    calls: {
      contactsCallsList: vi.fn(),
      contactsCallsCreate: vi.fn(),
      contactsCallsUpdate: vi.fn(),
      contactsCallsDelete: vi.fn(),
    },
    preferences: {
      preferencesList: vi.fn(),
    },
  },
}));

const existingCall = {
  id: 1,
  type: "incoming",
  called_at: "2026-03-01T10:00:00Z",
  description: "Existing call",
};

const callsKey = ["vaults", 101, "contacts", 202, "calls"] as const;
const callsListAndFeedKeys = [
  callsKey,
  ["vaults", "101", "feed"],
  ["vaults", "101", "contacts", "202", "feed"],
] as const;

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
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

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function callsView(
  queryClient: QueryClient,
  vaultId: string | number,
  contactId: string | number,
) {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider>
        <AntApp>
          <CallsModule vaultId={vaultId} contactId={contactId} />
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
}

function renderModule() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);

  const view = render(callsView(queryClient, 101, 202));

  return { queryClient, view };
}

function expectOnlyInvalidatedKeys(
  queryClient: QueryClient,
  expectedKeys: readonly QueryKey[],
): void {
  const invalidateQueries = vi.mocked(queryClient.invalidateQueries);
  const invalidatedKeys = invalidateQueries.mock.calls.map(
    ([filters]) => filters?.queryKey,
  );
  expect(invalidatedKeys).toEqual(expectedKeys);
  expect(invalidatedKeys).not.toContainEqual(undefined);
  expect(invalidatedKeys).not.toContainEqual(["vaults", "unrelated", "feed"]);
}

async function submitCreate(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(screen.getByRole("button", { name: /Log call$/ }));
  const dialog = await screen.findByRole("dialog");
  const dateInput = within(dialog).getByRole("textbox", {
    name: "Date & Time",
  });
  await user.type(dateInput, "2026-04-10 09:30:00");
  await user.keyboard("{Enter}");
  await user.click(within(dialog).getByRole("combobox", { name: "Type" }));
  await user.click(await screen.findByTitle("Outgoing"));
  await user.click(within(dialog).getByRole("button", { name: "OK" }));
}

describe("CallsModule mutation invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.calls.contactsCallsList).mockResolvedValue({
      data: [existingCall],
      meta: { page: 1, per_page: 15, total: 1, total_pages: 1 },
    });
    vi.mocked(api.calls.contactsCallsCreate).mockResolvedValue({ data: {} });
    vi.mocked(api.calls.contactsCallsUpdate).mockResolvedValue({ data: {} });
    vi.mocked(api.calls.contactsCallsDelete).mockResolvedValue({ data: {} });
    vi.mocked(api.preferences.preferencesList).mockResolvedValue({ data: {} });
  });

  it("keeps the submitted route for the API and invalidations when a pending create finishes after route drift", async () => {
    const user = userEvent.setup();
    const createRequest =
      createDeferred<
        Awaited<ReturnType<typeof api.calls.contactsCallsCreate>>
      >();
    vi.mocked(api.calls.contactsCallsCreate).mockReturnValue(
      createRequest.promise,
    );
    const { queryClient, view } = renderModule();
    await screen.findByText("Existing call");

    await submitCreate(user);
    await waitFor(() =>
      expect(api.calls.contactsCallsCreate).toHaveBeenCalledWith(
        "101",
        "202",
        expect.objectContaining({ description: undefined, type: "outgoing" }),
      ),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    await user.click(screen.getByRole("button", { name: "edit" }));
    view.rerender(callsView(queryClient, 404, 505));

    createRequest.resolve({ data: {} });

    await waitFor(() =>
      expect(appMessageMock.success).toHaveBeenCalledWith("Call logged"),
    );
    expectOnlyInvalidatedKeys(queryClient, callsListAndFeedKeys);
  }, 10_000);

  it("waits for both the Calls list and Feed invalidations before closing and reporting create success", async () => {
    const user = userEvent.setup();
    const listInvalidation = createDeferred<void>();
    const feedInvalidation = createDeferred<void>();
    const { queryClient } = renderModule();
    vi.mocked(queryClient.invalidateQueries).mockImplementation(
      (filters = {}) =>
        filters.queryKey?.at(-1) === "feed"
          ? feedInvalidation.promise
          : listInvalidation.promise,
    );
    await screen.findByText("Existing call");

    await submitCreate(user);
    await waitFor(() =>
      expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(3),
    );

    await act(async () => {
      feedInvalidation.resolve(undefined);
      await feedInvalidation.promise;
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-04-10 09:30:00")).toBeInTheDocument();
    expect(appMessageMock.success).not.toHaveBeenCalled();

    listInvalidation.resolve(undefined);
    await waitFor(() =>
      expect(appMessageMock.success).toHaveBeenCalledWith("Call logged"),
    );
    expect(screen.getByRole("dialog")).toHaveClass("ant-zoom-leave");
    expect(
      screen.queryByDisplayValue("2026-04-10 09:30:00"),
    ).not.toBeInTheDocument();
  }, 10_000);

  it("keeps a pending update local and reports update success after edit state changes", async () => {
    const user = userEvent.setup();
    let resolveUpdate: (() => void) | undefined;
    vi.mocked(api.calls.contactsCallsUpdate).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = () => resolve({ data: {} });
        }),
    );
    const { queryClient } = renderModule();
    await screen.findByText("Existing call");

    await user.click(screen.getByRole("button", { name: "edit" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(api.calls.contactsCallsUpdate).toHaveBeenCalled(),
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    if (resolveUpdate === undefined) {
      throw new Error("expected the call update request to be pending");
    }
    resolveUpdate();

    await waitFor(() =>
      expect(appMessageMock.success).toHaveBeenCalledWith("Call updated"),
    );
    expectOnlyInvalidatedKeys(queryClient, [callsKey]);
  });

  it("waits for only the Calls list invalidation before closing and reporting update success", async () => {
    const user = userEvent.setup();
    const listInvalidation = createDeferred<void>();
    const { queryClient } = renderModule();
    vi.mocked(queryClient.invalidateQueries).mockReturnValue(
      listInvalidation.promise,
    );
    await screen.findByText("Existing call");

    await user.click(screen.getByRole("button", { name: "edit" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1),
    );

    expectOnlyInvalidatedKeys(queryClient, [callsKey]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(appMessageMock.success).not.toHaveBeenCalled();

    listInvalidation.resolve(undefined);
    await waitFor(() =>
      expect(appMessageMock.success).toHaveBeenCalledWith("Call updated"),
    );
    expect(screen.getByRole("dialog")).toHaveClass("ant-zoom-leave");
    expect(
      screen.queryByDisplayValue("2026-03-01 10:00:00"),
    ).not.toBeInTheDocument();
  });

  it("invalidates only the Calls list and exact Feed projections after delete", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderModule();
    await screen.findByText("Existing call");

    await user.click(screen.getByRole("button", { name: "delete" }));
    await user.click(await screen.findByRole("button", { name: "OK" }));

    await waitFor(() =>
      expect(appMessageMock.success).toHaveBeenCalledWith("Call deleted"),
    );
    expectOnlyInvalidatedKeys(queryClient, callsListAndFeedKeys);
  });

  it("keeps the submitted route for the API and invalidations when a pending delete finishes after route drift", async () => {
    const user = userEvent.setup();
    const deleteRequest =
      createDeferred<
        Awaited<ReturnType<typeof api.calls.contactsCallsDelete>>
      >();
    vi.mocked(api.calls.contactsCallsDelete).mockReturnValue(
      deleteRequest.promise,
    );
    const { queryClient, view } = renderModule();
    await screen.findByText("Existing call");

    await user.click(screen.getByRole("button", { name: "delete" }));
    await user.click(await screen.findByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(api.calls.contactsCallsDelete).toHaveBeenCalledWith(
        "101",
        "202",
        1,
      ),
    );
    view.rerender(callsView(queryClient, 404, 505));

    deleteRequest.resolve({ data: {} });

    await waitFor(() =>
      expect(appMessageMock.success).toHaveBeenCalledWith("Call deleted"),
    );
    expectOnlyInvalidatedKeys(queryClient, callsListAndFeedKeys);
  });

  it("waits for both the Calls list and Feed invalidations before reporting delete success", async () => {
    const user = userEvent.setup();
    const listInvalidation = createDeferred<void>();
    const feedInvalidation = createDeferred<void>();
    const { queryClient } = renderModule();
    vi.mocked(queryClient.invalidateQueries).mockImplementation(
      (filters = {}) =>
        filters.queryKey?.at(-1) === "feed"
          ? feedInvalidation.promise
          : listInvalidation.promise,
    );
    await screen.findByText("Existing call");

    await user.click(screen.getByRole("button", { name: "delete" }));
    await user.click(await screen.findByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(3),
    );
    expectOnlyInvalidatedKeys(queryClient, callsListAndFeedKeys);

    await act(async () => {
      listInvalidation.resolve(undefined);
      await listInvalidation.promise;
    });
    expect(appMessageMock.success).not.toHaveBeenCalled();

    feedInvalidation.resolve(undefined);
    await waitFor(() =>
      expect(appMessageMock.success).toHaveBeenCalledWith("Call deleted"),
    );
  });
});
