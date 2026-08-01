import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { App as AntApp, ConfigProvider } from "antd";
import ContactList from "@/pages/contact/ContactList";
import { api } from "@/api";
import type { Contact, PaginationMeta } from "@/api";
import type {
  InvalidateQueryFilters,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
import { mostConsultedQueryKey } from "@/utils/mostConsultedProjection";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("min-width"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location-probe">
      {location.pathname}
      {location.search}
    </div>
  );
}

function RouteNavigator() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      data-testid="navigate-vault-9"
      onClick={() => navigate("/vaults/9/contacts")}
    >
      Navigate to vault 9
    </button>
  );
}

vi.mock("@/api", () => ({
  api: {
    contacts: {
      contactsList: vi.fn(),
      contactsLabelsDetail: vi.fn(),
      contactsSortUpdate: vi.fn(),
      contactsBulkMoveCreate: vi.fn(),
    },
    contactLabels: { contactLabelsList: vi.fn() },
    groups: { groupsList: vi.fn() },
    vaults: { vaultsList: vi.fn() },
    vaultSettings: { settingsLabelsList: vi.fn() },
    vcard: { contactsExportList: vi.fn(), contactsImportCreate: vi.fn() },
  },
  httpClient: {
    instance: {
      get: vi.fn().mockRejectedValue(new Error("mocked")),
    },
  },
}));

vi.mock("@/components/ContactAvatar", () => ({
  default: () => <div data-testid="contact-avatar" />,
}));

const mockUseQuery = vi.fn();
const mockInvalidateQueries =
  vi.fn<(filters: InvalidateQueryFilters) => Promise<void>>();
const mockSetQueryData = vi.fn<QueryClient["setQueryData"]>();
const mockMutationVariables = vi.fn();

type MutationOptions<TVariables> = {
  mutationFn?: (variables: TVariables) => Promise<unknown> | unknown;
  onSuccess?: (
    data: unknown,
    variables: TVariables,
    context: unknown,
  ) => Promise<void> | void;
  onError?: (error: Error, variables: TVariables, context: unknown) => void;
};

vi.mock("@tanstack/react-query", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    useQuery: (...args: unknown[]) => mockUseQuery(...args),
    useMutation: <TVariables,>(options?: MutationOptions<TVariables>) => {
      const optionsRef = React.useRef(options);
      optionsRef.current = options;
      const mutate = React.useRef((variables: TVariables) => {
        mockMutationVariables(variables);
        const submittedOptions = optionsRef.current;
        void (async () => {
          try {
            const data = await submittedOptions?.mutationFn?.(variables);
            await optionsRef.current?.onSuccess?.(data, variables, undefined);
          } catch (error) {
            optionsRef.current?.onError?.(
              error instanceof Error ? error : new Error(String(error)),
              variables,
              undefined,
            );
          }
        })();
      });

      return { mutate: mutate.current, isPending: false };
    },
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
      setQueryData: mockSetQueryData,
    }),
  };
});

let mockLabels: { id: number; name: string }[] = [];

function mockContactListQuery(
  contacts: Contact[] = [],
  meta: PaginationMeta = { total: contacts.length },
  vaults: { id: string; name: string }[] = [],
) {
  mockUseQuery.mockImplementation((opts) => {
    const key = Array.isArray(opts?.queryKey) ? opts.queryKey : [];
    if (key.includes("labels")) {
      return { data: mockLabels, isLoading: false };
    }
    if (key.includes("groups")) {
      return { data: [], isLoading: false };
    }
    if (key[0] === "vaults" && key[1] === "bulkMoveTargets") {
      return { data: vaults, isLoading: false };
    }
    if (key[0] === "vaults" && key[2] === "contacts") {
      return { data: { contacts, meta }, isLoading: false };
    }
    return { data: undefined, isLoading: false };
  });
}

function getContactsQueryKey() {
  const call = mockUseQuery.mock.calls.find(([opts]) => {
    const key = Array.isArray(opts?.queryKey) ? opts.queryKey : [];
    return key[0] === "vaults" && key[2] === "contacts";
  });
  return call?.[0]?.queryKey as unknown[] | undefined;
}

type QueryOptions = { queryKey?: unknown[]; queryFn?: () => Promise<unknown> };

function getLatestContactsQueryOptions() {
  const calls = mockUseQuery.mock.calls.filter(([opts]) => {
    const key = Array.isArray(opts?.queryKey) ? opts.queryKey : [];
    return key[0] === "vaults" && key[2] === "contacts";
  });
  return calls.at(-1)?.[0] as QueryOptions | undefined;
}

function serializeQueryKey(queryKey: readonly unknown[]): string {
  return JSON.stringify(queryKey);
}

const BULK_MOVE_QUERY_INVALIDATION_FILTERS: readonly InvalidateQueryFilters[] =
  [
    { queryKey: ["vaults", "1", "contacts"] },
    { queryKey: ["vaults", "2", "contacts"] },
    { queryKey: ["vaults", "1", "all-tasks"], exact: true },
    { queryKey: ["vaults", "2", "all-tasks"], exact: true },
    { queryKey: ["vaults", "1", "feed"] },
    { queryKey: ["vaults", "1", "contacts", "42", "feed"] },
    { queryKey: ["vaults", "1", "contacts", "84", "feed"] },
    { queryKey: ["vaults", "1", "calendar"] },
    { queryKey: ["vaults", "2", "calendar"] },
    { queryKey: ["vaults", "1", "contacts", "42", "important-dates"] },
    { queryKey: ["vaults", "2", "contacts", "42", "important-dates"] },
    { queryKey: ["vaults", "1", "contacts", "84", "important-dates"] },
    { queryKey: ["vaults", "2", "contacts", "84", "important-dates"] },
    { queryKey: ["vaults", "1", "reminders"] },
    { queryKey: ["vaults", "2", "reminders"] },
    { queryKey: ["vaults", "1", "contacts", "42", "reminders"] },
    { queryKey: ["vaults", "2", "contacts", "42", "reminders"] },
    { queryKey: ["vaults", "1", "contacts", "84", "reminders"] },
    { queryKey: ["vaults", "2", "contacts", "84", "reminders"] },
    { queryKey: ["vaults", "1", "mostConsulted"], exact: true },
    { queryKey: ["vaults", "2", "mostConsulted"], exact: true },
  ] as const;

const BULK_MOVE_STALE_TASK_QUERY_KEYS = [
  ["vaults", "1", "all-tasks"],
  ["vaults", "2", "all-tasks"],
  ["vaults", "1", "contacts", "42", "tasks"],
  ["vaults", "1", "contacts", "42", "tasks", { page: 1 }],
  ["vaults", "1", "contacts", "source-coassignee", "tasks-completed"],
  ["vaults", "1", "contacts", "84", "tasks-completed", { page: 2 }],
  ["vaults", "2", "contacts", "42", "tasks-completed"],
  ["vaults", "2", "contacts", "42", "tasks-completed", { page: 3 }],
  ["vaults", "2", "contacts", "target-coassignee", "tasks"],
  ["vaults", "2", "contacts", "84", "tasks", { page: 4 }],
] as const satisfies readonly QueryKey[];

const BULK_MOVE_STALE_NON_TASK_QUERY_KEYS = [
  ["vaults", "1", "contacts", null, null, 1, 20, "name", "", "active"],
  ["vaults", "1", "contacts", "unrelated-contact"],
  ["vaults", "2", "contacts", null, null, 1, 20, "name", "", "active"],
  ["vaults", "2", "contacts", "unrelated-contact"],
  ["vaults", "1", "feed", { page: 2 }],
  ["vaults", "1", "calendar", { month: "2026-01" }],
  ["vaults", "2", "calendar", { month: "2026-02" }],
  ["vaults", "1", "reminders", { page: 2 }],
  ["vaults", "2", "reminders", { page: 3 }],
  ["vaults", "1", "contacts", "42", "feed", { page: 2 }],
  ["vaults", "2", "contacts", "84", "feed", { page: 3 }],
  ["vaults", "1", "contacts", "84", "important-dates", "future"],
  ["vaults", "2", "contacts", "42", "important-dates", "future"],
  ["vaults", "1", "contacts", "42", "reminders", { page: 2 }],
  ["vaults", "2", "contacts", "84", "reminders", { page: 3 }],
] as const satisfies readonly QueryKey[];

const BULK_MOVE_FRESH_QUERY_KEYS = [
  ["vaults", "9", "all-tasks"],
  ["vaults", "9", "contacts", null, null, 1, 20, "name", "", "active"],
  ["vaults", "9", "contacts", "42"],
  ["vaults", "9", "contacts", "42", "tasks"],
  ["vaults", "2", "feed", { page: 3 }],
  ["global", "task-statistics"],
] as const satisfies readonly QueryKey[];

const VCARD_INVALIDATION_KEYS = [
  ["vaults", "1", "contacts"],
  ["vaults", "1", "calendar"],
] as const;

function namedInvalidationCases(
  filters: readonly InvalidateQueryFilters[],
): readonly {
  readonly name: string;
  readonly filters: InvalidateQueryFilters;
}[] {
  return filters.map((invalidationFilters, index) => ({
    name: `${String(index + 1).padStart(2, "0")} ${serializeQueryKey(invalidationFilters.queryKey ?? [])}`,
    filters: invalidationFilters,
  }));
}

function bulkMoveInvalidationCases(): readonly {
  readonly name: string;
  readonly matches: (filters: InvalidateQueryFilters) => boolean;
}[] {
  return [
    ...BULK_MOVE_QUERY_INVALIDATION_FILTERS.map((expectedFilters, index) => ({
      name: `${String(index + 1).padStart(2, "0")} ${serializeQueryKey(expectedFilters.queryKey ?? [])}`,
      matches: (filters: InvalidateQueryFilters) =>
        JSON.stringify(filters) === JSON.stringify(expectedFilters),
    })),
    {
      name: "task-only predicate",
      matches: (filters: InvalidateQueryFilters) =>
        filters.predicate !== undefined,
    },
  ];
}

function holdContactListInvalidation(
  matches: (filters: InvalidateQueryFilters) => boolean,
): {
  readonly resolve: () => void;
} {
  let resolveHeldInvalidation = () => {};
  const heldInvalidation = new Promise<void>((resolve) => {
    resolveHeldInvalidation = resolve;
  });
  mockInvalidateQueries.mockImplementation((filters) =>
    matches(filters) ? heldInvalidation : Promise.resolve(),
  );
  return { resolve: resolveHeldInvalidation };
}

function expectBulkMoveInvalidations(): void {
  const actualFilters = mockInvalidateQueries.mock.calls.map(
    ([filters]) => filters,
  );
  const predicateFilters = actualFilters.filter(
    (filters) => filters.predicate !== undefined,
  );

  expect(actualFilters).toHaveLength(
    BULK_MOVE_QUERY_INVALIDATION_FILTERS.length + 1,
  );
  expect(
    actualFilters.filter((filters) => filters.predicate === undefined),
  ).toEqual(BULK_MOVE_QUERY_INVALIDATION_FILTERS);
  expect(predicateFilters).toHaveLength(1);
  expect(predicateFilters[0]).toEqual({ predicate: expect.any(Function) });

  const serializedActualKeys = actualFilters.flatMap(({ queryKey }) =>
    queryKey === undefined ? [] : [serializeQueryKey(queryKey)],
  );
  expect(new Set(serializedActualKeys).size).toBe(serializedActualKeys.length);
}

function expectExactInvalidationKeys(
  expectedKeys: readonly (readonly string[])[],
) {
  const actualKeys = mockInvalidateQueries.mock.calls.flatMap(([filters]) =>
    filters.queryKey === undefined ? [] : [filters.queryKey],
  );
  const serializedActualKeys = actualKeys.map(serializeQueryKey);

  expect([...serializedActualKeys].sort()).toEqual(
    expectedKeys.map(serializeQueryKey).sort(),
  );
  expect(new Set(serializedActualKeys).size).toBe(actualKeys.length);
}

function expectQueryStaleness(
  queryClient: QueryClient,
  queryKeys: readonly QueryKey[],
  expectedStale: boolean,
): void {
  for (const queryKey of queryKeys) {
    const query = queryClient.getQueryCache().find({ queryKey, exact: true });
    expect(query, JSON.stringify(queryKey)).toBeDefined();
    expect.soft(query?.isStale(), JSON.stringify(queryKey)).toBe(expectedStale);
  }
}

function renderContactList(initialUrl = "/vaults/1/contacts") {
  return render(
    <ConfigProvider>
      <AntApp>
        <MemoryRouter initialEntries={[initialUrl]}>
          <Routes>
            <Route
              path="/vaults/:id/contacts"
              element={
                <>
                  <ContactList />
                  <LocationProbe />
                  <RouteNavigator />
                </>
              }
            />
            <Route
              path="/vaults/:id/contacts/:contactId"
              element={
                <>
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </ConfigProvider>,
  );
}

async function chooseSelectOption(selectTestId: string, optionText: string) {
  const select = screen.getByTestId(selectTestId);
  const control = select.querySelector<HTMLElement>("input") ?? select;
  fireEvent.mouseDown(control);
  fireEvent.click(control);

  const optionByTitle = await screen.findByTitle(optionText);
  fireEvent.click(optionByTitle);
}

function mockTwoContactBulkMove(): void {
  mockContactListQuery(
    [
      {
        id: "42",
        first_name: "Ada",
        last_name: "Lovelace",
        updated_at: "2024-06-01T00:00:00Z",
      },
      {
        id: "84",
        first_name: "Grace",
        last_name: "Hopper",
        updated_at: "2024-06-02T00:00:00Z",
      },
    ],
    { total: 2 },
    [
      { id: "1", name: "Current Vault" },
      { id: "2", name: "Family Vault" },
    ],
  );
  vi.mocked(api.contacts.contactsBulkMoveCreate).mockResolvedValue({
    data: { moved_count: 2 },
  });
}

async function submitTwoContactBulkMove(): Promise<void> {
  const user = userEvent.setup();
  renderContactList();

  const rowCheckboxes = screen.getAllByRole("checkbox");
  const firstRowCheckbox = rowCheckboxes[1];
  const secondRowCheckbox = rowCheckboxes[2];
  if (!firstRowCheckbox || !secondRowCheckbox) {
    throw new Error("Contact row checkboxes were not rendered");
  }
  await user.click(firstRowCheckbox);
  await user.click(secondRowCheckbox);
  await user.click(screen.getByRole("button", { name: /move 2 selected/i }));
  await chooseSelectOption("bulk-move-vault-select", "Family Vault");
  await user.click(screen.getByRole("button", { name: "Move contacts" }));

  await waitFor(() => {
    expect(api.contacts.contactsBulkMoveCreate).toHaveBeenCalledWith("1", {
      contact_ids: ["42", "84"],
      target_vault_id: "2",
    });
  });
}

async function submitVCardImport(): Promise<void> {
  const user = userEvent.setup();
  renderContactList();

  const fileInput = document.querySelector<HTMLInputElement>(
    'input[type="file"][accept=".vcf"]',
  );
  if (!fileInput) throw new Error("vCard import input was not rendered");
  await user.upload(
    fileInput,
    new File(["BEGIN:VCARD\nEND:VCARD"], "contacts.vcf", {
      type: "text/vcard",
    }),
  );

  await waitFor(() => {
    expect(mockInvalidateQueries).toHaveBeenCalledTimes(
      VCARD_INVALIDATION_KEYS.length,
    );
  });
}

describe("ContactList", () => {
  beforeEach(() => {
    localStorage.removeItem("bonds_contact_list_columns");
    mockLabels = [];
    mockUseQuery.mockReset();
    vi.mocked(api.contacts.contactsList).mockReset();
    vi.mocked(api.contacts.contactsLabelsDetail).mockReset();
    vi.mocked(api.contacts.contactsBulkMoveCreate).mockReset();
    vi.mocked(api.vcard.contactsImportCreate).mockReset();
    mockInvalidateQueries.mockReset().mockResolvedValue(undefined);
    mockSetQueryData.mockReset();
    mockMutationVariables.mockReset();
    mockContactListQuery();
  });

  it("renders loading state", () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: true });
    renderContactList();
    expect(document.querySelector(".ant-spin")).toBeInTheDocument();
  }, 15000);

  it("renders empty state", () => {
    mockContactListQuery();
    renderContactList();
    expect(screen.getByText("No contacts yet")).toBeInTheDocument();
  });

  it("renders search input", () => {
    mockContactListQuery();
    renderContactList();
    expect(screen.getByPlaceholderText("Quick search")).toBeInTheDocument();
  });

  it("reads page and per_page from URL query parameters", () => {
    renderContactList("/vaults/1/contacts?page=3&per_page=50");

    expect(getContactsQueryKey()).toEqual([
      "vaults",
      "1",
      "contacts",
      null,
      null,
      3,
      50,
      "name",
      "",
      "active",
    ]);
  });

  it("falls back to default pagination when URL query values are invalid", () => {
    renderContactList("/vaults/1/contacts?page=abc&per_page=0");

    expect(getContactsQueryKey()).toEqual([
      "vaults",
      "1",
      "contacts",
      null,
      null,
      1,
      20,
      "name",
      "",
      "active",
    ]);
  });

  it("updates URL when pagination changes", async () => {
    const user = userEvent.setup();
    mockContactListQuery(
      Array.from({ length: 20 }).map((_, i) => ({
        id: String(i + 1),
        first_name: `User ${i + 1}`,
        last_name: "Example",
        updated_at: "2024-06-01T00:00:00Z",
      })),
      { total: 60 },
    );

    renderContactList("/vaults/1/contacts");

    const page2Button = document.querySelector<HTMLElement>(
      ".ant-pagination-item-2 a",
    );
    expect(page2Button).toBeInTheDocument();
    if (!page2Button)
      throw new Error("Page 2 pagination link was not rendered");
    await user.click(page2Button);

    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        "/vaults/1/contacts?page=2&per_page=20",
      );
    });
  });

  it("preserves pagination query parameters when navigating to a contact", async () => {
    const user = userEvent.setup();
    mockContactListQuery(
      [
        {
          id: "42",
          first_name: "Test",
          last_name: "User",
          updated_at: "2024-06-01T00:00:00Z",
        },
      ],
      { total: 100 },
    );

    renderContactList("/vaults/1/contacts?page=3&per_page=50");

    const contactRow = await screen.findByText("Test User");
    await user.click(contactRow);

    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        "/vaults/1/contacts/42?page=3&per_page=50",
      );
    });
  });

  it("renders first-met dates in the default visible columns", () => {
    mockContactListQuery(
      [
        {
          id: "42",
          first_name: "Ada",
          last_name: "Lovelace",
          first_met_at: "2026-01-15T00:00:00Z",
          updated_at: "2026-01-20T00:00:00Z",
        },
      ],
      { total: 1 },
    );

    renderContactList();

    expect(screen.getByText("First met")).toBeInTheDocument();
    expect(screen.getByText("Jan 15, 2026")).toBeInTheDocument();
  });

  it("renders imprecise first-met dates in the default visible columns", () => {
    mockContactListQuery(
      [
        {
          id: "42",
          first_name: "Ada",
          last_name: "Lovelace",
          first_met_date_precision: "month",
          first_met_year: 2026,
          first_met_month: 5,
          updated_at: "2026-01-20T00:00:00Z",
        } as Contact,
      ],
      { total: 1 },
    );

    renderContactList();

    expect(screen.getByText("First met")).toBeInTheDocument();
    expect(screen.getByText("May 2026")).toBeInTheDocument();
  });

  it("uses first_met_at when the first-met sort option is selected", async () => {
    mockContactListQuery();

    renderContactList();

    await chooseSelectOption("contact-sort-select", "First met");

    await waitFor(() => {
      expect(getLatestContactsQueryOptions()?.queryKey).toEqual([
        "vaults",
        "1",
        "contacts",
        null,
        null,
        1,
        20,
        "first_met_at",
        "",
        "active",
      ]);
    });
  });

  it("passes the selected first-met sort through label-filtered contact queries", async () => {
    mockLabels = [{ id: 7, name: "Friends" }];
    mockContactListQuery();
    vi.mocked(api.contacts.contactsLabelsDetail).mockResolvedValue({
      data: [],
      meta: { total: 0 },
    });

    renderContactList();

    await chooseSelectOption("contact-sort-select", "First met");
    await chooseSelectOption("contact-label-filter", "Friends");

    const queryOptions = getLatestContactsQueryOptions();
    await queryOptions?.queryFn?.();

    expect(api.contacts.contactsLabelsDetail).toHaveBeenCalledWith("1", 7, {
      page: 1,
      per_page: 20,
      sort: "first_met_at",
      filter: "active",
    });
  });

  it("moves selected contacts with the bulk move API", async () => {
    const user = userEvent.setup();
    mockContactListQuery(
      [
        {
          id: "42",
          first_name: "Ada",
          last_name: "Lovelace",
          updated_at: "2024-06-01T00:00:00Z",
        },
      ],
      { total: 1 },
      [
        { id: "1", name: "Current Vault" },
        { id: "2", name: "Family Vault" },
      ],
    );
    vi.mocked(api.contacts.contactsBulkMoveCreate).mockResolvedValue({
      data: { moved_count: 1 },
    });

    renderContactList();

    const rowCheckbox = screen.getAllByRole("checkbox")[1];
    if (!rowCheckbox) throw new Error("Contact row checkbox was not rendered");
    await user.click(rowCheckbox);

    await user.click(screen.getByRole("button", { name: /move 1 selected/i }));
    expect(screen.getByText("Move selected contacts")).toBeInTheDocument();
    expect(screen.queryByText("Current Vault")).not.toBeInTheDocument();

    await chooseSelectOption("bulk-move-vault-select", "Family Vault");
    await user.click(screen.getByRole("button", { name: "Move contacts" }));

    await waitFor(() => {
      expect(api.contacts.contactsBulkMoveCreate).toHaveBeenCalledWith("1", {
        contact_ids: ["42"],
        target_vault_id: "2",
      });
    });
    await waitFor(() => {
      expect(screen.getByText("Moved 1 contacts")).toBeInTheDocument();
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["vaults", "1", "contacts"],
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["vaults", "2", "contacts"],
    });
  }, 15000);

  it("invalidates source and target Contacts prefixes after a bulk move", async () => {
    const user = userEvent.setup();
    mockContactListQuery(
      [
        {
          id: "42",
          first_name: "Ada",
          last_name: "Lovelace",
          updated_at: "2024-06-01T00:00:00Z",
        },
      ],
      { total: 1 },
      [
        { id: "1", name: "Current Vault" },
        { id: "2", name: "Family Vault" },
      ],
    );
    vi.mocked(api.contacts.contactsBulkMoveCreate).mockResolvedValue({
      data: { moved_count: 1 },
    });

    renderContactList();

    const rowCheckbox = screen.getAllByRole("checkbox")[1];
    if (!rowCheckbox) throw new Error("Contact row checkbox was not rendered");
    await user.click(rowCheckbox);
    await user.click(screen.getByRole("button", { name: /move 1 selected/i }));
    await chooseSelectOption("bulk-move-vault-select", "Family Vault");
    await user.click(screen.getByRole("button", { name: "Move contacts" }));

    await waitFor(() => {
      expect(screen.getByText("Moved 1 contacts")).toBeInTheDocument();
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["vaults", "1", "contacts"],
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["vaults", "2", "contacts"],
    });
  }, 15000);

  it("invalidates only the submitted bulk move scopes", async () => {
    const user = userEvent.setup();
    mockContactListQuery(
      [
        {
          id: "42",
          first_name: "Ada",
          last_name: "Lovelace",
          updated_at: "2024-06-01T00:00:00Z",
        },
        {
          id: "84",
          first_name: "Grace",
          last_name: "Hopper",
          updated_at: "2024-06-02T00:00:00Z",
        },
        {
          id: "126",
          first_name: "Katherine",
          last_name: "Johnson",
          updated_at: "2024-06-03T00:00:00Z",
        },
      ],
      { total: 3 },
      [
        { id: "1", name: "Current Vault" },
        { id: "2", name: "Family Vault" },
      ],
    );
    type MoveResponse = Awaited<
      ReturnType<typeof api.contacts.contactsBulkMoveCreate>
    >;
    let resolveMove: ((response: MoveResponse) => void) | undefined;
    const moveResponse = new Promise<MoveResponse>((resolve) => {
      resolveMove = resolve;
    });
    const invalidationResolvers: Array<() => void> = [];
    mockInvalidateQueries.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          invalidationResolvers.push(resolve);
        }),
    );
    vi.mocked(api.contacts.contactsBulkMoveCreate).mockReturnValue(
      moveResponse,
    );

    renderContactList();

    const rowCheckboxes = screen.getAllByRole("checkbox");
    const firstRowCheckbox = rowCheckboxes[1];
    const secondRowCheckbox = rowCheckboxes[2];
    const thirdRowCheckbox = rowCheckboxes[3];
    if (!firstRowCheckbox || !secondRowCheckbox || !thirdRowCheckbox) {
      throw new Error("Contact row checkboxes were not rendered");
    }
    await user.click(firstRowCheckbox);
    await user.click(secondRowCheckbox);
    await user.click(screen.getByRole("button", { name: /move 2 selected/i }));
    await chooseSelectOption("bulk-move-vault-select", "Family Vault");
    await user.click(screen.getByRole("button", { name: "Move contacts" }));

    await waitFor(() => {
      expect(api.contacts.contactsBulkMoveCreate).toHaveBeenCalledWith("1", {
        contact_ids: ["42", "84"],
        target_vault_id: "2",
      });
    });
    fireEvent.click(thirdRowCheckbox);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /move 3 selected/i }),
      ).toBeInTheDocument();
    });

    const submittedVariables = mockMutationVariables.mock.calls.at(-1)?.[0];
    expect(submittedVariables).toEqual({
      sourceVaultId: "1",
      targetVaultId: "2",
      selectedContactIds: ["42", "84"],
    });
    expect(Object.isFrozen(submittedVariables)).toBe(true);
    if (
      typeof submittedVariables !== "object" ||
      submittedVariables === null ||
      !("selectedContactIds" in submittedVariables)
    ) {
      throw new Error("Bulk move variables did not include selectedContactIds");
    }
    expect(Object.isFrozen(submittedVariables.selectedContactIds)).toBe(true);

    if (!resolveMove) throw new Error("Bulk move request did not start");
    resolveMove({ data: { moved_count: 2 } });

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith(
        BULK_MOVE_QUERY_INVALIDATION_FILTERS.at(-1),
      );
    });
    expectBulkMoveInvalidations();
    expect(screen.getByText("Move selected contacts")).toBeInTheDocument();

    for (const resolveInvalidation of invalidationResolvers) {
      resolveInvalidation();
    }
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /move 1 selected/i }),
      ).toBeInTheDocument();
    });
  }, 15000);

  it("keeps the submitted bulk move route identity when the route rerenders while pending", async () => {
    const user = userEvent.setup();
    mockTwoContactBulkMove();
    type MoveResponse = Awaited<
      ReturnType<typeof api.contacts.contactsBulkMoveCreate>
    >;
    let resolveMove: ((response: MoveResponse) => void) | undefined;
    const moveResponse = new Promise<MoveResponse>((resolve) => {
      resolveMove = resolve;
    });
    vi.mocked(api.contacts.contactsBulkMoveCreate).mockReturnValue(
      moveResponse,
    );

    renderContactList();

    const rowCheckboxes = screen.getAllByRole("checkbox");
    const firstRowCheckbox = rowCheckboxes[1];
    const secondRowCheckbox = rowCheckboxes[2];
    if (!firstRowCheckbox || !secondRowCheckbox) {
      throw new Error("Contact row checkboxes were not rendered");
    }
    await user.click(firstRowCheckbox);
    await user.click(secondRowCheckbox);
    await user.click(screen.getByRole("button", { name: /move 2 selected/i }));
    await chooseSelectOption("bulk-move-vault-select", "Family Vault");
    await user.click(screen.getByRole("button", { name: "Move contacts" }));

    await waitFor(() => {
      expect(api.contacts.contactsBulkMoveCreate).toHaveBeenCalledWith("1", {
        contact_ids: ["42", "84"],
        target_vault_id: "2",
      });
    });
    fireEvent.click(screen.getByTestId("navigate-vault-9"));
    expect(await screen.findByTestId("location-probe")).toHaveTextContent(
      "/vaults/9/contacts",
    );

    if (!resolveMove) throw new Error("Bulk move request did not start");
    resolveMove({ data: {} });

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith(
        BULK_MOVE_QUERY_INVALIDATION_FILTERS.at(-1),
      );
    });
    expectBulkMoveInvalidations();
    expect(
      mockInvalidateQueries.mock.calls.some(
        ([filters]) =>
          filters.queryKey?.[0] === "vaults" && filters.queryKey[1] === "9",
      ),
    ).toBe(false);
    expect(await screen.findByText("Moved 2 contacts")).toBeInTheDocument();
    expect(mockMutationVariables).toHaveBeenLastCalledWith({
      sourceVaultId: "1",
      targetVaultId: "2",
      selectedContactIds: ["42", "84"],
    });
  }, 15000);

  it.each(bulkMoveInvalidationCases())(
    "awaits bulk move invalidation $name",
    async ({ matches }) => {
      mockTwoContactBulkMove();
      const heldInvalidation = holdContactListInvalidation(matches);

      await submitTwoContactBulkMove();

      await waitFor(() => {
        expect(
          mockInvalidateQueries.mock.calls.some(([filters]) =>
            matches(filters),
          ),
        ).toBe(true);
      });
      expect(screen.queryByText("Moved 2 contacts")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /move 2 selected/i }),
      ).toBeInTheDocument();

      await act(async () => {
        heldInvalidation.resolve();
        await Promise.resolve();
      });
      expect(await screen.findByText("Moved 2 contacts")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /move 2 selected/i }),
      ).not.toBeInTheDocument();
    },
    15000,
  );

  it("refetches active source Contacts while staling target Contacts and scoped projections", async () => {
    // Given
    mockTwoContactBulkMove();
    const {
      QueryClient: ActualQueryClient,
      QueryObserver: ActualQueryObserver,
    } = await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
    const queryClient = new ActualQueryClient({
      defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity } },
    });
    for (const queryKey of [
      ...BULK_MOVE_STALE_TASK_QUERY_KEYS,
      ...BULK_MOVE_STALE_NON_TASK_QUERY_KEYS,
      ...BULK_MOVE_FRESH_QUERY_KEYS,
    ]) {
      queryClient.setQueryData(queryKey, { cached: true });
    }
    const activeSourceContactsRefetch = vi
      .fn()
      .mockResolvedValue({ cached: "source-contacts-refetched" });
    const activeSourceContactsObserver = new ActualQueryObserver(queryClient, {
      queryKey: BULK_MOVE_STALE_NON_TASK_QUERY_KEYS[0],
      queryFn: activeSourceContactsRefetch,
      staleTime: Infinity,
    });
    const unsubscribeSourceContacts = activeSourceContactsObserver.subscribe(
      () => undefined,
    );
    mockInvalidateQueries.mockImplementation((filters) =>
      queryClient.invalidateQueries(filters),
    );

    // When
    await submitTwoContactBulkMove();
    await waitFor(() => {
      expect(screen.getByText("Moved 2 contacts")).toBeInTheDocument();
    });

    // Then
    expectBulkMoveInvalidations();
    expect(activeSourceContactsRefetch).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryData(BULK_MOVE_STALE_NON_TASK_QUERY_KEYS[0]),
    ).toEqual({ cached: "source-contacts-refetched" });
    expectQueryStaleness(queryClient, BULK_MOVE_STALE_TASK_QUERY_KEYS, true);
    expectQueryStaleness(
      queryClient,
      BULK_MOVE_STALE_NON_TASK_QUERY_KEYS.slice(1),
      true,
    );
    expectQueryStaleness(queryClient, BULK_MOVE_FRESH_QUERY_KEYS, false);
    unsubscribeSourceContacts();
  });

  it("bulk-evicts submitted contacts from source Most Consulted without changing target ranking data", async () => {
    // Given
    mockTwoContactBulkMove();
    const { QueryClient: ActualQueryClient } = await vi.importActual<
      typeof import("@tanstack/react-query")
    >("@tanstack/react-query");
    const queryClient = new ActualQueryClient({
      defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity } },
    });
    const sourceMostConsultedKey = mostConsultedQueryKey("1");
    const targetMostConsultedKey = mostConsultedQueryKey("2");
    const sourceRanking = [
      { contact_id: "42", consultations: 8 },
      { contact_id: "84", consultations: 6 },
      { contact_id: "remaining-contact", consultations: 4 },
    ];
    const targetRanking = [{ contact_id: "target-contact", consultations: 10 }];
    queryClient.setQueryData(sourceMostConsultedKey, sourceRanking);
    queryClient.setQueryData(targetMostConsultedKey, targetRanking);
    mockSetQueryData.mockImplementation((queryKey, updater) =>
      queryClient.setQueryData(queryKey, updater),
    );
    mockInvalidateQueries.mockImplementation((filters) =>
      queryClient.invalidateQueries(filters),
    );

    // When
    await submitTwoContactBulkMove();
    await waitFor(() => {
      expect(screen.getByText("Moved 2 contacts")).toBeInTheDocument();
    });

    // Then
    expect(queryClient.getQueryData(sourceMostConsultedKey)).toEqual([
      { contact_id: "remaining-contact", consultations: 4 },
    ]);
    expect(queryClient.getQueryData(targetMostConsultedKey)).toBe(
      targetRanking,
    );
    expect(
      queryClient.getQueryState(sourceMostConsultedKey)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(targetMostConsultedKey)?.isInvalidated,
    ).toBe(true);
  });

  it("preserves bulk move errors without invalidating queries", async () => {
    const user = userEvent.setup();
    mockContactListQuery(
      [
        {
          id: "42",
          first_name: "Ada",
          last_name: "Lovelace",
          updated_at: "2024-06-01T00:00:00Z",
        },
      ],
      { total: 1 },
      [
        { id: "1", name: "Current Vault" },
        { id: "2", name: "Family Vault" },
      ],
    );
    vi.mocked(api.contacts.contactsBulkMoveCreate).mockRejectedValue(
      new Error("Bulk move request failed"),
    );

    renderContactList();

    const rowCheckbox = screen.getAllByRole("checkbox")[1];
    if (!rowCheckbox) throw new Error("Contact row checkbox was not rendered");
    await user.click(rowCheckbox);
    await user.click(screen.getByRole("button", { name: /move 1 selected/i }));
    await chooseSelectOption("bulk-move-vault-select", "Family Vault");
    await user.click(screen.getByRole("button", { name: "Move contacts" }));

    expect(
      await screen.findByText("Bulk move request failed"),
    ).toBeInTheDocument();
    expect(mockInvalidateQueries).not.toHaveBeenCalled();
    expect(mockSetQueryData).not.toHaveBeenCalled();
    expect(screen.queryByText(/Moved 1 contacts/)).not.toBeInTheDocument();
    expect(screen.getByText("Move selected contacts")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /move 1 selected/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location-probe")).toHaveTextContent(
      "/vaults/1/contacts",
    );
  }, 15000);

  it("invalidates only contacts and Calendar after a vCard import", async () => {
    const user = userEvent.setup();
    vi.mocked(api.vcard.contactsImportCreate).mockResolvedValue({
      data: {
        contacts: [],
        errors: [],
        imported_count: 3,
        skipped_count: 1,
      },
    });
    const invalidationResolvers: Array<() => void> = [];
    mockInvalidateQueries.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          invalidationResolvers.push(resolve);
        }),
    );

    renderContactList();

    const fileInput = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".vcf"]',
    );
    if (!fileInput) throw new Error("vCard import input was not rendered");
    await user.upload(
      fileInput,
      new File(["BEGIN:VCARD\nEND:VCARD"], "contacts.vcf", {
        type: "text/vcard",
      }),
    );

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledTimes(2);
    });
    expectExactInvalidationKeys(VCARD_INVALIDATION_KEYS);
    expect(
      screen.queryByText("Successfully imported 3 contacts"),
    ).not.toBeInTheDocument();

    for (const resolveInvalidation of invalidationResolvers) {
      resolveInvalidation();
    }
    expect(
      await screen.findByText("Successfully imported 3 contacts"),
    ).toBeInTheDocument();
  }, 15000);

  it("keeps the submitted vCard route identity when the route rerenders while pending", async () => {
    const user = userEvent.setup();
    type ImportResponse = Awaited<
      ReturnType<typeof api.vcard.contactsImportCreate>
    >;
    let resolveImport: ((response: ImportResponse) => void) | undefined;
    const importResponse = new Promise<ImportResponse>((resolve) => {
      resolveImport = resolve;
    });
    vi.mocked(api.vcard.contactsImportCreate).mockReturnValue(importResponse);

    renderContactList();

    const fileInput = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".vcf"]',
    );
    if (!fileInput) throw new Error("vCard import input was not rendered");
    await user.upload(
      fileInput,
      new File(["BEGIN:VCARD\nEND:VCARD"], "contacts.vcf", {
        type: "text/vcard",
      }),
    );
    await waitFor(() => {
      expect(api.vcard.contactsImportCreate).toHaveBeenCalledWith("1", {
        file: expect.any(File),
      });
    });

    fireEvent.click(screen.getByTestId("navigate-vault-9"));
    expect(await screen.findByTestId("location-probe")).toHaveTextContent(
      "/vaults/9/contacts",
    );

    if (!resolveImport) throw new Error("vCard import request did not start");
    resolveImport({
      data: {
        contacts: [],
        errors: [],
        imported_count: 3,
        skipped_count: 0,
      },
    });

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledTimes(
        VCARD_INVALIDATION_KEYS.length,
      );
    });
    expectExactInvalidationKeys(VCARD_INVALIDATION_KEYS);
    expect(
      mockInvalidateQueries.mock.calls.some(
        ([filters]) =>
          filters.queryKey?.[0] === "vaults" && filters.queryKey[1] === "9",
      ),
    ).toBe(false);
    expect(
      await screen.findByText("Successfully imported 3 contacts"),
    ).toBeInTheDocument();
  }, 15000);

  it.each(
    namedInvalidationCases(
      VCARD_INVALIDATION_KEYS.map((queryKey) => ({ queryKey })),
    ),
  )(
    "awaits vCard invalidation $name",
    async ({ filters }) => {
      vi.mocked(api.vcard.contactsImportCreate).mockResolvedValue({
        data: {
          contacts: [],
          errors: [],
          imported_count: 3,
          skipped_count: 1,
        },
      });
      const heldInvalidation = holdContactListInvalidation(
        (actualFilters) =>
          JSON.stringify(actualFilters) === JSON.stringify(filters),
      );

      await submitVCardImport();

      expectExactInvalidationKeys(VCARD_INVALIDATION_KEYS);
      expect(
        screen.queryByText("Successfully imported 3 contacts"),
      ).not.toBeInTheDocument();

      await act(async () => {
        heldInvalidation.resolve();
        await Promise.resolve();
      });
      expect(
        await screen.findByText("Successfully imported 3 contacts"),
      ).toBeInTheDocument();
    },
    15000,
  );

  it("preserves vCard import errors without invalidating queries", async () => {
    const user = userEvent.setup();
    vi.mocked(api.vcard.contactsImportCreate).mockRejectedValue(
      new Error("vCard request failed"),
    );

    renderContactList();

    const fileInput = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".vcf"]',
    );
    if (!fileInput) throw new Error("vCard import input was not rendered");
    await user.upload(
      fileInput,
      new File(["BEGIN:VCARD\nEND:VCARD"], "contacts.vcf", {
        type: "text/vcard",
      }),
    );

    expect(
      await screen.findByText("Failed to load contacts"),
    ).toBeInTheDocument();
    expect(mockInvalidateQueries).not.toHaveBeenCalled();
    expect(screen.queryByText(/Successfully imported/)).not.toBeInTheDocument();
  }, 15000);
});
