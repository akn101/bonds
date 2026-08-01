import { useRef } from "react";
import { act, render } from "@testing-library/react";
import { beforeAll, beforeEach, expect, vi } from "vitest";
import type { NormalizedFeedSource } from "@/utils/feedSourceLink";
import { RemindersModuleTestView } from "./remindersModuleTestView";

type ReminderTarget = Extract<
  NormalizedFeedSource,
  { readonly module: "reminders" }
>;

type RemindersModuleTestProps = {
  readonly vaultId?: string | number;
  readonly contactId?: string | number;
  readonly target?: ReminderTarget;
};

type MutationOptions<TVariables> = {
  readonly mutationFn: (variables: TVariables) => unknown | Promise<unknown>;
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
  request: unknown | Promise<unknown>,
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

export type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: Error) => void;
};

export function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: Error) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  if (resolvePromise === undefined || rejectPromise === undefined) {
    throw new Error("expected deferred handlers initialization");
  }
  return { promise, resolve: resolvePromise, reject: rejectPromise };
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

const hoistedMocks = vi.hoisted(() => ({
  apiMock: {
    reminders: {
      contactsRemindersList: vi.fn(),
      contactsRemindersCreate: vi.fn(),
      contactsRemindersUpdate: vi.fn(),
      contactsRemindersDelete: vi.fn(),
    },
    preferences: {
      preferencesList: vi.fn(),
    },
  },
  appMessageMock: {
    success: vi.fn(),
    error: vi.fn(),
  },
  mutationMock: {
    saveExecution: vi.fn(),
    deleteExecution: vi.fn(),
    queryKey: vi.fn(),
    invalidateQueries: vi
      .fn<
        (filters: { readonly queryKey: readonly unknown[] }) => Promise<void>
      >()
      .mockResolvedValue(undefined),
    pendingSaveCompletion: undefined as (() => Promise<void>) | undefined,
    pendingDeleteCompletion: undefined as (() => Promise<void>) | undefined,
  },
}));

export const appMessageMock = hoistedMocks.appMessageMock;
export const mutationMock = hoistedMocks.mutationMock;
export const apiMock = hoistedMocks.apiMock;

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  return {
    ...actual,
    App: Object.assign(actual.App, {
      useApp: () => ({ message: appMessageMock }),
    }),
  };
});

vi.mock(
  "@/components/CalendarDatePicker",
  async () => import("./remindersCalendarDatePickerMock"),
);

vi.mock("@/api", () => ({
  api: hoistedMocks.apiMock,
}));

let reminderQueryResult: unknown = { data: [], isLoading: false };
let preferencesQueryResult: unknown = { data: undefined };

export function setReminderQueryResult(result: unknown): void {
  reminderQueryResult = result;
}

export function setReminderPreferencesResult(result: unknown): void {
  preferencesQueryResult = result;
}

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { readonly queryKey: readonly unknown[] }) => {
    if (JSON.stringify(options.queryKey).includes("preferences")) {
      return preferencesQueryResult;
    }
    mutationMock.queryKey(options.queryKey);
    return reminderQueryResult;
  },
  useMutation: <TVariables,>(options: MutationOptions<TVariables>) => {
    const controller = useRef<MutationController<TVariables>>({ options });
    controller.current.options = options;
    return {
      mutate: vi.fn((variables: TVariables) => {
        const request = options.mutationFn(variables);
        if (isDeleteOperation(variables)) {
          mutationMock.deleteExecution(variables);
          mutationMock.pendingDeleteCompletion = () =>
            completeMutation(request, variables, controller.current);
          return;
        }
        mutationMock.saveExecution(variables);
        mutationMock.pendingSaveCompletion = () =>
          completeMutation(request, variables, controller.current);
      }),
      isPending: false,
    };
  },
  useQueryClient: () => ({ invalidateQueries: mutationMock.invalidateQueries }),
}));

export const reminderAndCalendarKeys = [
  ["vaults", "101", "reminders"],
  ["vaults", "101", "contacts", "202", "reminders"],
  ["vaults", "101", "calendar"],
  ["vaults", "101", "contacts", "202", "important-dates"],
] as const;
export const reminderCreateKeys = [
  ...reminderAndCalendarKeys,
  ["vaults", "101", "feed"],
  ["vaults", "101", "contacts", "202", "feed"],
] as const;
export const reminderDeleteKeys = reminderCreateKeys;

export function expectInvalidatedKeys(
  expectedKeys: readonly (readonly unknown[])[],
): void {
  expect(mutationMock.invalidateQueries).toHaveBeenCalledTimes(
    expectedKeys.length,
  );
  expect(
    mutationMock.invalidateQueries.mock.calls.map(
      ([filters]) => filters.queryKey,
    ),
  ).toEqual(expectedKeys);
}

export function holdReminderInvalidation(
  heldQueryKey: readonly unknown[],
  completion: Deferred<void>,
): void {
  mutationMock.invalidateQueries.mockImplementation(({ queryKey }) =>
    JSON.stringify(queryKey) === JSON.stringify(heldQueryKey)
      ? completion.promise
      : Promise.resolve(),
  );
}

export async function completePendingSave(): Promise<void> {
  if (mutationMock.pendingSaveCompletion === undefined) {
    throw new Error("expected a pending reminder save mutation");
  }
  await act(mutationMock.pendingSaveCompletion);
}

export async function completePendingDelete(): Promise<void> {
  if (mutationMock.pendingDeleteCompletion === undefined) {
    throw new Error("expected a pending reminder delete mutation");
  }
  await act(mutationMock.pendingDeleteCompletion);
}

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mutationMock.invalidateQueries.mockResolvedValue(undefined);
  mutationMock.pendingSaveCompletion = undefined;
  mutationMock.pendingDeleteCompletion = undefined;
  reminderQueryResult = { data: [], isLoading: false };
  preferencesQueryResult = { data: undefined };
  apiMock.reminders.contactsRemindersList.mockResolvedValue({ data: [] });
  apiMock.reminders.contactsRemindersCreate.mockResolvedValue({ data: {} });
  apiMock.reminders.contactsRemindersUpdate.mockResolvedValue({ data: {} });
  apiMock.reminders.contactsRemindersDelete.mockResolvedValue({ data: {} });
  apiMock.preferences.preferencesList.mockResolvedValue({ data: undefined });
});

export function renderRemindersModule(props: RemindersModuleTestProps = {}) {
  const renderResult = render(<RemindersModuleTestView {...props} />);
  return {
    ...renderResult,
    rerenderModule: (nextProps: RemindersModuleTestProps) =>
      renderResult.rerender(<RemindersModuleTestView {...nextProps} />),
  };
}
