import { useRef } from "react";
import { beforeAll, beforeEach, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { ImportantDatesModuleTestView } from "./importantDatesModuleTestView";

type MutationOptions<TVariables> = {
  readonly mutationFn: (values: TVariables) => unknown;
  readonly onSuccess?: (
    data: unknown,
    variables: TVariables,
  ) => void | Promise<void>;
  readonly onError?: (error: Error, variables: TVariables) => void;
};

type MutationController<TVariables> = {
  options: MutationOptions<TVariables>;
};

async function completeMutation<TVariables>(
  request: unknown,
  variables: TVariables,
  controller: MutationController<TVariables>,
): Promise<void> {
  try {
    const data = await request;
    await controller.options.onSuccess?.(data, variables);
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    controller.options.onError?.(error, variables);
  }
}

function isDeleteOperation(
  value: unknown,
): value is { readonly kind: "delete" } {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "delete"
  );
}

type ImportantDatesModuleTestProps = {
  readonly vaultId?: string | number;
  readonly contactId?: string | number;
  readonly datesReturn?: unknown;
};

const hoistedMocks = vi.hoisted(() => ({
  apiMock: {
    contactsDatesCreate: vi.fn(),
    contactsDatesUpdate: vi.fn(),
    contactsDatesDelete: vi.fn(),
  },
  mutationMock: {
    saveExecution: vi.fn(),
    deleteExecution: vi.fn(),
  },
  queryKeyMock: vi.fn(),
  invalidateQueriesMock: vi
    .fn<(filters: { readonly queryKey: readonly unknown[] }) => Promise<void>>()
    .mockResolvedValue(undefined),
  pendingSaveCompletion: undefined as (() => Promise<void>) | undefined,
  pendingDeleteCompletion: undefined as (() => Promise<void>) | undefined,
  appMessageMock: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

export const apiMock = hoistedMocks.apiMock;
export const mutationMock = hoistedMocks.mutationMock;
export const queryKeyMock = hoistedMocks.queryKeyMock;
export const invalidateQueriesMock = hoistedMocks.invalidateQueriesMock;
export const appMessageMock = hoistedMocks.appMessageMock;

export async function completePendingSave(): Promise<void> {
  if (hoistedMocks.pendingSaveCompletion === undefined) {
    throw new Error("expected a pending important date save mutation");
  }
  await act(hoistedMocks.pendingSaveCompletion);
}

export async function completePendingDelete(): Promise<void> {
  if (hoistedMocks.pendingDeleteCompletion === undefined) {
    throw new Error("expected a pending important date delete mutation");
  }
  await act(hoistedMocks.pendingDeleteCompletion);
}

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  return {
    ...actual,
    App: Object.assign(actual.App, {
      useApp: () => ({ message: hoistedMocks.appMessageMock }),
    }),
  };
});

export let mockDatesReturn: unknown = { data: [], isLoading: false };
export let mockPrefsReturn: unknown = { data: undefined };
export let mockDateTypesReturn: unknown = { data: [], isLoading: false };

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

vi.mock("@/api", () => ({
  api: {
    importantDates: {
      contactsDatesList: vi.fn(),
      contactsDatesCreate: hoistedMocks.apiMock.contactsDatesCreate,
      contactsDatesUpdate: hoistedMocks.apiMock.contactsDatesUpdate,
      contactsDatesDelete: hoistedMocks.apiMock.contactsDatesDelete,
    },
    preferences: {
      preferencesList: vi.fn(),
    },
    vaultSettings: {
      settingsDateTypesList: vi.fn(),
    },
  },
}));

vi.mock(
  "@/components/CalendarDatePicker",
  async () => import("./importantDatesCalendarDatePickerMock"),
);

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (opts: { queryKey: readonly unknown[] }) => {
      const key = JSON.stringify(opts.queryKey);
      if (key.includes("preferences")) return mockPrefsReturn;
      if (key.includes("date-types")) return mockDateTypesReturn;
      hoistedMocks.queryKeyMock(opts.queryKey);
      return mockDatesReturn;
    },
    useMutation: <TVariables,>(options: MutationOptions<TVariables>) => {
      const controller = useRef<MutationController<TVariables>>({ options });
      controller.current.options = options;
      return {
        mutate: (values: TVariables) => {
          const request = options.mutationFn(values);
          if (isDeleteOperation(values)) {
            hoistedMocks.mutationMock.deleteExecution(values);
            hoistedMocks.pendingDeleteCompletion = () =>
              completeMutation(request, values, controller.current);
            return;
          }
          hoistedMocks.mutationMock.saveExecution(values);
          hoistedMocks.pendingSaveCompletion = () =>
            completeMutation(request, values, controller.current);
        },
        isPending: false,
      };
    },
    useQueryClient: () => ({
      invalidateQueries: hoistedMocks.invalidateQueriesMock,
    }),
  };
});

export const mockDates = [
  {
    id: 1,
    contact_id: "c1",
    label: "Birthday",
    day: 15,
    month: 3,
    year: 2025,
    calendar_type: "gregorian",
    original_day: null,
    original_month: null,
    original_year: null,
    contact_important_date_type_id: null,
    created_at: "2025-01-01",
    updated_at: "2025-01-01",
  },
  {
    id: 2,
    contact_id: "c1",
    label: "Lunar NY",
    day: 12,
    month: 2,
    year: 2025,
    calendar_type: "lunar",
    original_day: 15,
    original_month: 1,
    original_year: 2025,
    created_at: "2025-01-01",
    updated_at: "2025-01-01",
    contact_important_date_type_id: null,
  },
];

beforeEach(() => {
  mockDatesReturn = { data: [], isLoading: false };
  mockPrefsReturn = { data: undefined };
  mockDateTypesReturn = { data: [], isLoading: false };
  mutationMock.saveExecution.mockClear();
  mutationMock.deleteExecution.mockClear();
  queryKeyMock.mockClear();
  invalidateQueriesMock.mockReset();
  invalidateQueriesMock.mockResolvedValue(undefined);
  hoistedMocks.pendingSaveCompletion = undefined;
  hoistedMocks.pendingDeleteCompletion = undefined;
  appMessageMock.success.mockClear();
  appMessageMock.error.mockClear();
  apiMock.contactsDatesCreate.mockReset();
  apiMock.contactsDatesCreate.mockResolvedValue({ data: {} });
  apiMock.contactsDatesUpdate.mockReset();
  apiMock.contactsDatesUpdate.mockResolvedValue({ data: {} });
  apiMock.contactsDatesDelete.mockReset();
  apiMock.contactsDatesDelete.mockResolvedValue({ data: {} });
});

export function renderImportantDatesModule(
  props: ImportantDatesModuleTestProps = {},
) {
  if (props.datesReturn !== undefined) {
    mockDatesReturn = props.datesReturn;
  }
  const renderResult = render(<ImportantDatesModuleTestView {...props} />);
  return {
    ...renderResult,
    rerenderModule: (nextProps: ImportantDatesModuleTestProps) =>
      renderResult.rerender(<ImportantDatesModuleTestView {...nextProps} />),
  };
}
