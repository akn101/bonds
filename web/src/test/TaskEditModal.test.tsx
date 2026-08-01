import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TaskEditModal from "@/pages/vault/TaskEditModal";
import { api } from "@/api";
import type { Contact, VaultTask } from "@/api";

const queryMocks = vi.hoisted(() => ({
  invalidateQueries:
    vi.fn<
      (filters: { readonly queryKey: readonly unknown[] }) => Promise<void>
    >(),
  mutationVariables: vi.fn(),
  mutationCompletion: vi.fn<(completion: Promise<void>) => void>(),
}));

vi.mock("@/api", () => ({
  api: {
    contacts: { contactsList: vi.fn() },
    vaultTasks: {
      tasksList: vi.fn(),
      tasksCreate: vi.fn(),
      tasksPartialUpdate: vi.fn(),
      tasksDelete: vi.fn(),
    },
    preferences: { preferencesList: vi.fn() },
  },
  isPlainAPIError: (
    error: unknown,
  ): error is { readonly code: string; readonly message: string } =>
    error !== null &&
    typeof error === "object" &&
    !(error instanceof Error) &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string",
}));

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  type ReactNode = import("react").ReactNode;
  type SelectValue = string | number;
  type SelectOption = {
    readonly value: SelectValue;
    readonly label?: import("react").ReactNode;
  };
  type SelectProps = {
    readonly id?: string;
    readonly mode?: "multiple";
    readonly "aria-label"?: string;
    readonly onChange?: (value: SelectValue | readonly SelectValue[]) => void;
    readonly onSearch?: (value: string) => void;
    readonly options?: readonly SelectOption[];
    readonly placeholder?: string;
    readonly value?: SelectValue | readonly SelectValue[];
  };

  return {
    ...actual,
    App: Object.assign(
      ({ children }: { readonly children: ReactNode }) => <>{children}</>,
      { useApp: () => ({ message: { error: vi.fn() } }) },
    ),
    Modal: ({
      children,
      open,
      title,
    }: {
      readonly children: ReactNode;
      readonly open: boolean;
      readonly title: ReactNode;
    }) =>
      open ? (
        <section
          role="dialog"
          aria-label={typeof title === "string" ? title : undefined}
        >
          {children}
        </section>
      ) : null,
    Select: ({
      "aria-label": ariaLabel,
      id,
      mode,
      onChange,
      onSearch,
      options = [],
      placeholder,
      value,
    }: SelectProps) => {
      const selectedValues = Array.isArray(value)
        ? value
        : value === undefined
          ? []
          : [value];
      const selectedOptions = options.filter((option) =>
        selectedValues.includes(option.value),
      );

      return (
        <div className="ant-select">
          <input
            id={id}
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded="true"
            placeholder={placeholder}
            value=""
            onChange={(event) => onSearch?.(event.target.value)}
          />
          {selectedOptions.map((option) => (
            <span className="ant-select-selection-item" key={option.value}>
              {option.label}
              <button
                className="ant-select-selection-item-remove"
                type="button"
                onClick={() =>
                  onChange?.(
                    selectedValues.filter(
                      (selectedValue) => selectedValue !== option.value,
                    ),
                  )
                }
              >
                Remove
              </button>
            </span>
          ))}
          {options.map((option) => (
            <button
              type="button"
              title={
                typeof option.label === "string" ? option.label : undefined
              }
              key={option.value}
              onClick={() =>
                onChange?.(
                  mode === "multiple"
                    ? [...new Set([...selectedValues, option.value])]
                    : option.value,
                )
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      );
    },
  };
});

vi.mock("@/components/CalendarAwareDatePicker", () => ({
  default: () => null,
}));

type MutationOptions<TVariables> = {
  readonly mutationFn?: (variables: TVariables) => Promise<unknown> | unknown;
  readonly onSuccess?: (
    data: unknown,
    variables: TVariables,
    context: unknown,
  ) => Promise<void> | void;
  readonly onError?: (
    error: Error,
    variables: TVariables,
    context: unknown,
  ) => Promise<void> | void;
  readonly onSettled?: (
    data: unknown | undefined,
    error: Error | null,
    variables: TVariables,
    context: unknown,
  ) => Promise<void> | void;
};

vi.mock("@tanstack/react-query", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );

  return {
    ...actual,
    useQueryClient: () => {
      const queryClient = actual.useQueryClient();
      return {
        invalidateQueries: queryMocks.invalidateQueries,
        getQueryData: queryClient.getQueryData.bind(queryClient),
        getQueryState: queryClient.getQueryState.bind(queryClient),
      };
    },
    useMutation: <TVariables,>(options?: MutationOptions<TVariables>) => {
      const optionsRef = React.useRef(options);
      optionsRef.current = options;
      const mutate = React.useRef((variables: TVariables) => {
        queryMocks.mutationVariables(variables);
        const submittedOptions = optionsRef.current;
        const completion = (async () => {
          try {
            const data = await submittedOptions?.mutationFn?.(variables);
            await optionsRef.current?.onSuccess?.(data, variables, undefined);
            await optionsRef.current?.onSettled?.(
              data,
              null,
              variables,
              undefined,
            );
          } catch (error) {
            const mutationError =
              error instanceof Error ? error : new Error(String(error));
            await optionsRef.current?.onError?.(
              mutationError,
              variables,
              undefined,
            );
            await optionsRef.current?.onSettled?.(
              undefined,
              mutationError,
              variables,
              undefined,
            );
          }
        })();
        queryMocks.mutationCompletion(completion);
      });

      return { mutate: mutate.current, isPending: false };
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const messages: Record<string, string> = {
        "vault.tasks.contacts_label": "Assignees (optional)",
        "vault.tasks.no_contacts_placeholder": "No contacts (standalone)",
        "vault.tasks.parent_label": "Parent task",
        "vault.tasks.no_parent_placeholder": "No parent task",
        "vault.tasks.new_task_label_placeholder": "What needs doing?",
        "vault.tasks.new_task_description_placeholder":
          "Add details (optional)",
        "vault.tasks.new_task_modal_title": "New task",
        "vault.tasks.create": "Create",
        "vault.tasks.cancel": "Cancel",
        "vault.tasks.save_failed": "Could not save task",
      };
      return messages[key] || key;
    },
  }),
}));

type Deferred<Value> = {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
};

function createDeferred<Value>(): Deferred<Value> {
  let resolvePromise: Deferred<Value>["resolve"] = () => undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function invalidatedKeys(): readonly unknown[] {
  return queryMocks.invalidateQueries.mock.calls.map(
    ([filters]) => filters.queryKey,
  );
}

function taskListKeys(
  vaultId: string,
  contactIds: readonly string[],
): readonly unknown[][] {
  return contactIds.flatMap((contactId) => [
    ["vaults", vaultId, "contacts", contactId, "tasks"],
    ["vaults", vaultId, "contacts", contactId, "tasks-completed"],
  ]);
}

function taskFeedKeys(
  vaultId: string,
  contactIds: readonly string[],
): readonly unknown[][] {
  return [
    ["vaults", vaultId, "feed"],
    ...contactIds.map((contactId) => [
      "vaults",
      vaultId,
      "contacts",
      contactId,
      "feed",
    ]),
  ];
}

function vaultTask(
  id: number,
  label: string,
  contactIds: readonly string[],
  parentTaskId?: number,
): VaultTask {
  return {
    id,
    label,
    status: "todo",
    contacts: contactIds.map((contactId) => ({
      id: contactId,
      name: `Contact ${contactId}`,
    })),
    parent_task_id: parentTaskId,
  };
}

function setupApiMocks(): void {
  const contacts: Contact[] = [
    {
      id: "101",
      first_name: "Ada",
      last_name: "Lovelace",
    },
    {
      id: "202",
      first_name: "Grace",
      last_name: "Hopper",
    },
    {
      id: "303",
      first_name: "Katherine",
      last_name: "Johnson",
    },
  ];
  vi.mocked(api.contacts.contactsList).mockResolvedValue({
    data: contacts,
    success: true,
    meta: { page: 1, per_page: 200, total: contacts.length, total_pages: 1 },
  });
  vi.mocked(api.vaultTasks.tasksList).mockResolvedValue({
    data: [],
    success: true,
    meta: { page: 1, per_page: 200, total: 0, total_pages: 1 },
  });
  vi.mocked(api.preferences.preferencesList).mockResolvedValue({
    data: { enable_alternative_calendar: false },
    success: true,
    meta: { page: 1, per_page: 200, total: 0, total_pages: 1 },
  });
  queryMocks.invalidateQueries.mockResolvedValue(undefined);
}

function renderCreateModal(onClose: () => void, vaultId = "vault-1") {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const renderModal = (currentVaultId: string, defaultStatus: string) => (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <App>
          <TaskEditModal
            open
            vaultId={currentVaultId}
            task={null}
            defaultStatus={defaultStatus}
            statuses={[]}
            onClose={onClose}
          />
        </App>
      </ConfigProvider>
    </QueryClientProvider>
  );
  const rendered = render(renderModal(vaultId, "todo"));
  return {
    ...rendered,
    rerenderModal: (currentVaultId: string, defaultStatus: string) =>
      rendered.rerender(renderModal(currentVaultId, defaultStatus)),
  };
}

function renderEditModal(
  onClose: () => void,
  task: VaultTask,
  allTasks: readonly VaultTask[] = [task],
  vaultId = "vault-1",
) {
  vi.mocked(api.vaultTasks.tasksList).mockResolvedValue({
    data: [...allTasks],
    success: true,
    meta: { page: 1, per_page: 200, total: allTasks.length, total_pages: 1 },
  });
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const renderModal = (currentVaultId: string, currentTask: VaultTask) => (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <App>
          <TaskEditModal
            open
            vaultId={currentVaultId}
            task={currentTask}
            statuses={[
              {
                id: 1,
                slug: "todo",
                label: "To do",
                position: 0,
                is_default: true,
                can_be_deleted: false,
              },
            ]}
            onClose={onClose}
          />
        </App>
      </ConfigProvider>
    </QueryClientProvider>
  );
  const rendered = render(renderModal(vaultId, task));
  return {
    ...rendered,
    rerenderModal: (currentVaultId: string, currentTask: VaultTask) =>
      rendered.rerender(renderModal(currentVaultId, currentTask)),
  };
}

async function selectAssignees(contactNames: readonly string[]): Promise<void> {
  const user = userEvent.setup();
  const assigneeInput = await screen.findByRole("combobox", {
    name: "Assignees (optional)",
  });
  for (const contactName of contactNames) {
    await user.click(assigneeInput);
    fireEvent.click(await screen.findByTitle(contactName));
  }
}

async function submitCreate(label: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("What needs doing?"), label);
  await user.click(screen.getByRole("button", { name: "Create" }));
}

async function submitUpdate(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "vault.tasks.save" }));
}

async function confirmDelete(): Promise<void> {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: /vault\.tasks\.delete/ }),
  );
  await user.click(await screen.findByRole("button", { name: "OK" }));
}

async function removeAssignee(contactName: string): Promise<void> {
  await waitFor(() => {
    const selectedAssignee = [
      ...document.querySelectorAll<HTMLElement>(".ant-select-selection-item"),
    ].find((element) => element.textContent?.includes(contactName));
    const removeButton = selectedAssignee?.querySelector<HTMLElement>(
      ".ant-select-selection-item-remove",
    );
    if (removeButton === null || removeButton === undefined) {
      throw new Error(`expected ${contactName} to be removable`);
    }
    fireEvent.click(removeButton);
  });
}

describe("TaskEditModal assignee search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMocks();
  });

  it("searches assignee contacts remotely by first-name prefix", async () => {
    const initialContacts: Contact[] = [
      { id: "c1", first_name: "Bob", last_name: "Builder" },
    ];
    vi.mocked(api.contacts.contactsList).mockResolvedValue({
      data: initialContacts,
      success: true,
      meta: { page: 1, per_page: 200, total: 1, total_pages: 1 },
    });

    renderCreateModal(vi.fn());

    await waitFor(() => {
      expect(api.contacts.contactsList).toHaveBeenCalledWith("vault-1", {
        per_page: 200,
      });
    });
    const contactInput = document.getElementById("contact_ids");
    if (!(contactInput instanceof HTMLInputElement)) {
      throw new Error("expected assignee input");
    }

    fireEvent.change(contactInput, { target: { value: "Ali" } });

    await waitFor(
      () => {
        expect(api.contacts.contactsList).toHaveBeenCalledWith("vault-1", {
          per_page: 200,
          search: "Ali",
        });
      },
      { timeout: 2000 },
    );
  });
});

describe("TaskEditModal create cache invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMocks();
  });

  it("freezes the submitted create operation, invalidates its original vault, and leaves a replacement open", async () => {
    type CreateResponse = Awaited<
      ReturnType<typeof api.vaultTasks.tasksCreate>
    >;
    const createResult = createDeferred<CreateResponse>();
    vi.mocked(api.vaultTasks.tasksCreate).mockReturnValue(createResult.promise);
    const onClose = vi.fn();
    const rendered = renderCreateModal(onClose, "vault-1");
    await selectAssignees(["Ada Lovelace", "Grace Hopper"]);

    await submitCreate("Frozen task");
    await waitFor(() => expect(api.vaultTasks.tasksCreate).toHaveBeenCalled());
    const submittedOperation =
      queryMocks.mutationVariables.mock.calls.at(-1)?.[0];
    if (
      typeof submittedOperation !== "object" ||
      submittedOperation === null ||
      !("request" in submittedOperation) ||
      !("assigneeContactIds" in submittedOperation)
    ) {
      throw new Error("expected create mutation operation");
    }
    const request = submittedOperation.request;
    const assigneeContactIds = submittedOperation.assigneeContactIds;
    if (
      typeof request !== "object" ||
      request === null ||
      !("contact_ids" in request)
    ) {
      throw new Error("expected resolved create request");
    }

    expect(submittedOperation).toMatchObject({ vaultId: "vault-1" });
    expect(request).toEqual({
      label: "Frozen task",
      description: "",
      contact_ids: ["101", "202"],
      parent_task_id: undefined,
      status: "todo",
      due_at: undefined,
      calendar_type: undefined,
      original_day: undefined,
      original_month: undefined,
      original_year: undefined,
    });
    expect(assigneeContactIds).toEqual(["101", "202"]);
    expect(Object.isFrozen(submittedOperation)).toBe(true);
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.contact_ids)).toBe(true);
    expect(Object.isFrozen(assigneeContactIds)).toBe(true);

    rendered.rerenderModal("vault-2", "blocked");
    createResult.resolve({ success: true, data: {} });

    const completion = queryMocks.mutationCompletion.mock.calls.at(-1)?.[0];
    if (completion === undefined) {
      throw new Error("expected mutation completion");
    }
    await completion;

    expect(api.vaultTasks.tasksCreate).toHaveBeenCalledWith("vault-1", request);
    expect(invalidatedKeys()).toEqual([
      ["vaults", "vault-1", "all-tasks"],
      ...taskListKeys("vault-1", ["101", "202"]),
      ...taskFeedKeys("vault-1", ["101", "202"]),
    ]);
    expect(invalidatedKeys()).not.toContainEqual([
      "vaults",
      "vault-2",
      "all-tasks",
    ]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("invalidates every assigned contact task list and Feed before closing", async () => {
    // Given
    const assigneeIds = ["101", "202"] as const;
    const expectedKeys = [
      ["vaults", "vault-1", "all-tasks"],
      ...taskListKeys("vault-1", assigneeIds),
      ...taskFeedKeys("vault-1", assigneeIds),
    ];
    const heldInvalidation = createDeferred<void>();
    queryMocks.invalidateQueries.mockImplementation(({ queryKey }) =>
      JSON.stringify(queryKey) === JSON.stringify(expectedKeys.at(-1))
        ? heldInvalidation.promise
        : Promise.resolve(),
    );
    vi.mocked(api.vaultTasks.tasksCreate).mockResolvedValue({
      success: true,
      data: {},
    });
    const onClose = vi.fn();
    renderCreateModal(onClose);
    await selectAssignees(["Ada Lovelace", "Grace Hopper"]);

    // When
    await submitCreate("Assigned task");

    // Then
    await waitFor(() => expect(invalidatedKeys()).toEqual(expectedKeys));
    expect(onClose).not.toHaveBeenCalled();

    heldInvalidation.resolve(undefined);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("invalidates only all-tasks for an unassigned create", async () => {
    vi.mocked(api.vaultTasks.tasksCreate).mockResolvedValue({
      success: true,
      data: {},
    });
    const onClose = vi.fn();
    renderCreateModal(onClose);

    await submitCreate("Standalone task");

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(invalidatedKeys()).toEqual([["vaults", "vault-1", "all-tasks"]]);
  });

  it("keeps the modal open and skips invalidation when create rejects", async () => {
    vi.mocked(api.vaultTasks.tasksCreate).mockRejectedValue(
      new Error("create failed"),
    );
    const onClose = vi.fn();
    renderCreateModal(onClose);

    await submitCreate("Rejected task");

    const completion = queryMocks.mutationCompletion.mock.calls.at(-1)?.[0];
    if (completion === undefined) {
      throw new Error("expected mutation completion");
    }
    await completion;

    expect(queryMocks.invalidateQueries).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "New task" }),
    ).toBeInTheDocument();
  });
});

describe("TaskEditModal update and delete cache invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMocks();
  });

  it("invalidates submitted-old and response-new assignees without closing a rerendered update", async () => {
    // Given
    const originalTask = vaultTask(11, "Original task", ["101"]);
    const rerenderedTask = vaultTask(22, "Unrelated task", ["404"]);
    const mutationStarted = createDeferred<void>();
    queryMocks.mutationVariables.mockImplementationOnce(() =>
      mutationStarted.resolve(undefined),
    );
    const updateResult =
      createDeferred<
        Awaited<ReturnType<typeof api.vaultTasks.tasksPartialUpdate>>
      >();
    vi.mocked(api.vaultTasks.tasksPartialUpdate).mockReturnValue(
      updateResult.promise,
    );
    const onClose = vi.fn();
    const rendered = renderEditModal(onClose, originalTask);
    const assigneeInput = await screen.findByRole("combobox", {
      name: "Assignees (optional)",
    });
    const graceOption = await screen.findByTitle("Grace Hopper");
    await act(async () => {
      fireEvent.click(graceOption);
    });
    const assigneeSelect = assigneeInput.parentElement;
    if (assigneeSelect === null) {
      throw new Error("expected assignee select");
    }
    const selectedAda = [
      ...assigneeSelect.querySelectorAll<HTMLElement>(
        ".ant-select-selection-item",
      ),
    ].find((element) => element.textContent?.includes("Ada Lovelace"));
    const removeAda = selectedAda?.querySelector<HTMLElement>(
      ".ant-select-selection-item-remove",
    );
    if (removeAda === null || removeAda === undefined) {
      throw new Error("expected Ada Lovelace to be removable");
    }
    await act(async () => {
      fireEvent.click(removeAda);
    });

    // When
    const saveButton = screen.getByRole("button", {
      name: "vault.tasks.save",
    });
    const form = saveButton.closest("form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("expected task edit form");
    }
    await act(async () => {
      fireEvent.submit(form);
    });
    await mutationStarted.promise;
    const submittedOperation =
      queryMocks.mutationVariables.mock.calls.at(-1)?.[0];
    expect(submittedOperation).toMatchObject({
      vaultId: "vault-1",
      taskId: 11,
    });
    expect(Object.isFrozen(submittedOperation)).toBe(true);
    expect(api.vaultTasks.tasksPartialUpdate).toHaveBeenCalledWith(
      "vault-1",
      11,
      expect.objectContaining({ contact_ids: ["202"] }),
    );
    await act(async () => {
      rendered.rerenderModal("vault-2", rerenderedTask);
    });

    // Then
    const expectedKeys = [
      ["vaults", "vault-1", "all-tasks"],
      ...taskListKeys("vault-1", ["101", "303"]),
      ...taskFeedKeys("vault-1", ["101", "303"]),
    ];
    const completion = queryMocks.mutationCompletion.mock.calls.at(-1)?.[0];
    if (completion === undefined) {
      throw new Error("expected mutation completion");
    }
    await act(async () => {
      updateResult.resolve({
        success: true,
        data: vaultTask(11, "Original task", ["303"]),
      });
      await completion;
    });

    expect(invalidatedKeys()).toEqual(expectedKeys);
    expect(invalidatedKeys()).not.toContainEqual([
      "vaults",
      "vault-1",
      "contacts",
      "202",
      "tasks",
    ]);
    expect(invalidatedKeys()).not.toContainEqual([
      "vaults",
      "vault-2",
      "all-tasks",
    ]);
    expect(invalidatedKeys()).not.toContainEqual([
      "vaults",
      "vault-2",
      "contacts",
      "404",
      "tasks",
    ]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("refreshes task lists without Feed when update assignees are unchanged in a different order", async () => {
    // Given
    const originalTask = vaultTask(11, "Original task", ["101", "202"]);
    const updateResult =
      createDeferred<
        Awaited<ReturnType<typeof api.vaultTasks.tasksPartialUpdate>>
      >();
    vi.mocked(api.vaultTasks.tasksPartialUpdate).mockReturnValue(
      updateResult.promise,
    );
    const onClose = vi.fn();
    renderEditModal(onClose, originalTask);
    await removeAssignee("Ada Lovelace");
    await selectAssignees(["Ada Lovelace"]);

    // When
    await submitUpdate();
    await waitFor(() =>
      expect(api.vaultTasks.tasksPartialUpdate).toHaveBeenCalled(),
    );
    updateResult.resolve({
      success: true,
      data: vaultTask(11, "Original task", ["202", "101"]),
    });

    // Then
    await waitFor(() =>
      expect(invalidatedKeys()).toEqual([
        ["vaults", "vault-1", "all-tasks"],
        ...taskListKeys("vault-1", ["101", "202"]),
      ]),
    );
    expect(invalidatedKeys()).not.toContainEqual(["vaults", "vault-1", "feed"]);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("invalidates snapshotted root and descendant assignees without closing a rerendered delete", async () => {
    // Given
    const rootTask = vaultTask(11, "Root task", ["101"]);
    const childTask = vaultTask(12, "Child task", ["202"], 11);
    const grandchildTask = vaultTask(13, "Grandchild task", ["303"], 12);
    const unrelatedTask = vaultTask(14, "Unrelated task", ["404"]);
    const deleteResult =
      createDeferred<Awaited<ReturnType<typeof api.vaultTasks.tasksDelete>>>();
    vi.mocked(api.vaultTasks.tasksDelete).mockReturnValue(deleteResult.promise);
    const onClose = vi.fn();
    const rendered = renderEditModal(onClose, rootTask, [
      rootTask,
      childTask,
      grandchildTask,
      unrelatedTask,
    ]);

    // When
    await confirmDelete();
    await waitFor(() => {
      expect(api.vaultTasks.tasksDelete).toHaveBeenCalledWith("vault-1", 11);
    });
    rendered.rerenderModal("vault-2", unrelatedTask);
    deleteResult.resolve({ success: true, data: {} });

    // Then
    const expectedKeys = [
      ["vaults", "vault-1", "all-tasks"],
      ...taskListKeys("vault-1", ["101", "202", "303"]),
      ...taskFeedKeys("vault-1", ["101", "202", "303"]),
    ];
    const completion = queryMocks.mutationCompletion.mock.calls.at(-1)?.[0];
    if (completion === undefined) {
      throw new Error("expected mutation completion");
    }
    await completion;

    expect(invalidatedKeys()).toEqual(expectedKeys);
    expect(invalidatedKeys()).not.toContainEqual([
      "vaults",
      "vault-2",
      "all-tasks",
    ]);
    expect(invalidatedKeys()).not.toContainEqual([
      "vaults",
      "vault-2",
      "contacts",
      "404",
      "tasks",
    ]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "update",
      prepare: () => {
        vi.mocked(api.vaultTasks.tasksPartialUpdate).mockResolvedValue({
          success: true,
          data: vaultTask(11, "Original task", ["101"]),
        });
        return submitUpdate;
      },
    },
    {
      name: "delete",
      prepare: () => {
        vi.mocked(api.vaultTasks.tasksDelete).mockResolvedValue({
          success: true,
          data: {},
        });
        return confirmDelete;
      },
    },
  ] as const)(
    "awaits exact invalidations before closing $name",
    async ({ prepare }) => {
      // Given
      const heldInvalidation = createDeferred<void>();
      queryMocks.invalidateQueries.mockImplementation(({ queryKey }) =>
        JSON.stringify(queryKey) ===
        JSON.stringify(["vaults", "vault-1", "all-tasks"])
          ? heldInvalidation.promise
          : Promise.resolve(),
      );
      const submit = prepare();
      const onClose = vi.fn();
      renderEditModal(onClose, vaultTask(11, "Original task", ["101"]));

      // When
      await submit();
      await waitFor(() =>
        expect(invalidatedKeys()).toContainEqual([
          "vaults",
          "vault-1",
          "all-tasks",
        ]),
      );

      // Then
      expect(onClose).not.toHaveBeenCalled();
      heldInvalidation.resolve(undefined);
      const completion = queryMocks.mutationCompletion.mock.calls.at(-1)?.[0];
      if (completion === undefined) {
        throw new Error("expected mutation completion");
      }
      await completion;
      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    {
      name: "update",
      reject: () =>
        vi
          .mocked(api.vaultTasks.tasksPartialUpdate)
          .mockRejectedValue(new Error("update failed")),
      submit: submitUpdate,
    },
    {
      name: "delete",
      reject: () =>
        vi
          .mocked(api.vaultTasks.tasksDelete)
          .mockRejectedValue(new Error("delete failed")),
      submit: confirmDelete,
    },
  ] as const)(
    "keeps the modal open without invalidation when $name rejects",
    async ({ reject, submit }) => {
      // Given
      reject();
      const onClose = vi.fn();
      renderEditModal(onClose, vaultTask(11, "Original task", ["101"]));

      // When
      await submit();
      const completion = queryMocks.mutationCompletion.mock.calls.at(-1)?.[0];
      if (completion === undefined) {
        throw new Error("expected mutation completion");
      }
      await completion;

      // Then
      expect(invalidatedKeys()).toEqual([]);
      expect(onClose).not.toHaveBeenCalled();
      expect(
        screen.getByRole("dialog", {
          name: "vault.tasks.edit_task_modal_title",
        }),
      ).toBeInTheDocument();
    },
  );
});
