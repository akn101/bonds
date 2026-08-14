import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api";
import type { VaultTask } from "@/api";
import type { InvalidateQueryFilters, QueryKey } from "@tanstack/react-query";
import {
  ControlledModalHarness,
  TaskEditModalTestProviders,
} from "@/test/taskEditModalLifecycleTestViews";
import {
  createDeferred,
  createQueryClient,
} from "@/test/taskEditModalLifecycleTestFixtures";
import { vaultTaskListQueryKey } from "@/pages/vault/vaultTaskMutationOperation";

vi.mock("@/api", () => ({
  api: {
    contacts: { contactsList: vi.fn() },
    preferences: { preferencesList: vi.fn() },
    vaultTasks: {
      tasksList: vi.fn(),
      tasksCreate: vi.fn(),
      tasksPartialUpdate: vi.fn(),
      tasksDelete: vi.fn(),
    },
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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "vault.tasks.cancel": "Cancel",
        "vault.tasks.delete": "Delete",
        "vault.tasks.delete_confirm": "Delete this task?",
        "vault.tasks.edit_task_modal_title": "Edit task",
        "vault.tasks.save": "Save",
      })[key] ?? key,
  }),
}));

vi.mock("@/utils/taskStatus", () => ({
  defaultStatusSlug: () => "todo",
  useTaskStatuses: () => ({ data: [] }),
}));
vi.mock("@/utils/nameFormat", () => ({
  formatContactName: () => "Contact",
  useNameOrder: () => "first_last",
}));
vi.mock("@/components/CalendarAwareDatePicker", () => ({
  default: () => <div />,
}));

type TaskListResponse = Awaited<ReturnType<typeof api.vaultTasks.tasksList>>;

function task(
  id: number,
  label: string,
  contactId: string,
  parentTaskId?: number,
): VaultTask {
  return {
    id,
    label,
    status: "todo",
    contacts: [{ id: contactId, name: `Contact ${contactId}` }],
    parent_task_id: parentTaskId,
  };
}

function taskListResponse(tasks: readonly VaultTask[]): TaskListResponse {
  return {
    data: [...tasks],
    success: true,
    meta: { page: 1, per_page: 200, total: tasks.length, total_pages: 1 },
  };
}

function renderModal(
  queryClient: ReturnType<typeof createQueryClient>,
  vaultId: string,
  vaultTask: VaultTask,
  onCloseObserved: () => void,
) {
  return render(
    <TaskEditModalTestProviders queryClient={queryClient}>
      <ControlledModalHarness
        task={vaultTask}
        vaultId={vaultId}
        onCloseObserved={onCloseObserved}
      />
    </TaskEditModalTestProviders>,
  );
}

async function confirmDelete(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Delete/ }));
  await user.click(await screen.findByRole("button", { name: "OK" }));
}

function invalidatedFilters(
  invalidateQueries: ReturnType<typeof vi.fn>,
): readonly InvalidateQueryFilters[] {
  return invalidateQueries.mock.calls.flatMap(([filters]) =>
    filters === undefined ? [] : [filters],
  );
}

function exactFilters(vaultId: string, contactIds: readonly string[]) {
  return [
    { queryKey: ["vaults", vaultId, "all-tasks"], exact: true },
    ...contactIds.flatMap((contactId) => [
      { queryKey: ["vaults", vaultId, "contacts", contactId, "tasks"] },
      {
        queryKey: ["vaults", vaultId, "contacts", contactId, "tasks-completed"],
      },
    ]),
    { queryKey: ["vaults", vaultId, "feed"] },
    ...contactIds.map((contactId) => ({
      queryKey: ["vaults", vaultId, "contacts", contactId, "feed"],
    })),
  ];
}

async function expectFallbackInvalidations(
  filters: readonly InvalidateQueryFilters[],
  vaultId: string,
): Promise<void> {
  expect(filters).toHaveLength(3);
  expect(filters.filter((filter) => filter.predicate === undefined)).toEqual([
    { queryKey: ["vaults", vaultId, "all-tasks"], exact: true },
    { queryKey: ["vaults", vaultId, "feed"] },
  ]);
  expect(filters.filter((filter) => filter.predicate !== undefined)).toEqual([
    { predicate: expect.any(Function) },
  ]);

  const staleQueryKeys = [
    ["vaults", vaultId, "all-tasks"],
    ["vaults", vaultId, "contacts", "101", "tasks"],
    ["vaults", vaultId, "contacts", "202", "tasks-completed", { page: 2 }],
    ["vaults", vaultId, "feed", { page: 2 }],
  ] as const satisfies readonly QueryKey[];
  const freshQueryKeys = [
    ["vaults", vaultId, "all-tasks", { page: 2 }],
    ["vaults", vaultId, "contacts", "101"],
    ["vaults", vaultId, "contacts", "101", "feed"],
    ["vaults", vaultId, "contacts", "101", "reminders"],
    ["vaults", vaultId, "contacts", "101", "relationships"],
    ["vaults", vaultId, "contacts", null, null, 1, 20],
  ] as const satisfies readonly QueryKey[];
  const predicateProofClient = createQueryClient();
  for (const queryKey of [...staleQueryKeys, ...freshQueryKeys]) {
    predicateProofClient.setQueryData(queryKey, { cached: true });
  }
  for (const filter of filters) {
    await predicateProofClient.invalidateQueries(filter);
  }
  for (const queryKey of staleQueryKeys) {
    expect(predicateProofClient.getQueryState(queryKey)?.isInvalidated).toBe(
      true,
    );
  }
  for (const queryKey of freshQueryKeys) {
    expect(predicateProofClient.getQueryState(queryKey)?.isInvalidated).toBe(
      false,
    );
  }
}

describe("TaskEditModal delete impact acquisition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.contacts.contactsList).mockResolvedValue({
      data: [],
      success: true,
      meta: { page: 1, per_page: 200, total: 0, total_pages: 1 },
    });
    vi.mocked(api.preferences.preferencesList).mockResolvedValue({
      data: { enable_alternative_calendar: false },
      success: true,
    });
    vi.mocked(api.vaultTasks.tasksDelete).mockResolvedValue({
      success: true,
      data: {},
    });
  });

  it("waits for missing-cache impact and invalidates recursive assignees exactly", async () => {
    const root = task(11, "Root", "101");
    const child = task(12, "Child", "202", 11);
    const grandchild = task(13, "Grandchild", "303", 12);
    const mountedFetch = createDeferred<TaskListResponse>();
    const impactFetch = createDeferred<TaskListResponse>();
    vi.mocked(api.vaultTasks.tasksList)
      .mockReturnValueOnce(mountedFetch.promise)
      .mockReturnValueOnce(impactFetch.promise);
    const queryClient = createQueryClient();
    const invalidations = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderModal(queryClient, "vault-a", root, onClose);
    await screen.findByDisplayValue("Root");

    await confirmDelete();
    await waitFor(() =>
      expect(api.vaultTasks.tasksList).toHaveBeenCalledTimes(2),
    );
    expect(api.vaultTasks.tasksDelete).not.toHaveBeenCalled();
    impactFetch.resolve(taskListResponse([root, child, grandchild]));
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));

    expect(api.vaultTasks.tasksDelete).toHaveBeenCalledWith("vault-a", 11);
    expect(invalidatedFilters(invalidations)).toEqual(
      exactFilters("vault-a", ["101", "202", "303"]),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores invalidated cache and uses fresh descendant impact", async () => {
    const root = task(11, "Root", "101");
    const staleChild = task(12, "Stale", "999", 11);
    const freshChild = task(13, "Fresh", "202", 11);
    const mountedFetch = createDeferred<TaskListResponse>();
    const impactFetch = createDeferred<TaskListResponse>();
    vi.mocked(api.vaultTasks.tasksList)
      .mockReturnValueOnce(mountedFetch.promise)
      .mockReturnValueOnce(impactFetch.promise);
    const queryClient = createQueryClient();
    const queryKey = vaultTaskListQueryKey("vault-a");
    queryClient.setQueryData(queryKey, [root, staleChild]);
    await queryClient.invalidateQueries({ queryKey, refetchType: "none" });
    const invalidations = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    renderModal(queryClient, "vault-a", root, vi.fn());
    await screen.findByDisplayValue("Root");

    await confirmDelete();
    await waitFor(() =>
      expect(api.vaultTasks.tasksList).toHaveBeenCalledTimes(2),
    );
    expect(api.vaultTasks.tasksDelete).not.toHaveBeenCalled();
    impactFetch.resolve(taskListResponse([root, freshChild]));
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));

    const filters = invalidatedFilters(invalidations);
    expect(filters).toContainEqual({
      queryKey: ["vaults", "vault-a", "contacts", "202", "tasks"],
    });
    expect(filters).not.toContainEqual({
      queryKey: ["vaults", "vault-a", "contacts", "999", "tasks"],
    });
  });

  it("falls back only for a plain API impact error", async () => {
    const root = task(11, "Root", "101");
    const mountedFetch = createDeferred<TaskListResponse>();
    const impactFetch = createDeferred<TaskListResponse>();
    vi.mocked(api.vaultTasks.tasksList)
      .mockReturnValueOnce(mountedFetch.promise)
      .mockReturnValueOnce(impactFetch.promise);
    const queryClient = createQueryClient();
    const invalidations = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    renderModal(queryClient, "vault-a", root, vi.fn());
    await screen.findByDisplayValue("Root");

    await confirmDelete();
    await waitFor(() =>
      expect(api.vaultTasks.tasksList).toHaveBeenCalledTimes(2),
    );
    impactFetch.reject({ code: "NETWORK_ERROR", message: "offline" });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));

    expect(api.vaultTasks.tasksDelete).toHaveBeenCalledWith("vault-a", 11);
    await expectFallbackInvalidations(
      invalidatedFilters(invalidations),
      "vault-a",
    );
  });

  it("retains TypeError identity and aborts every delete side effect", async () => {
    const root = task(11, "Root", "101");
    const mountedFetch = createDeferred<TaskListResponse>();
    const impactFetch = createDeferred<TaskListResponse>();
    vi.mocked(api.vaultTasks.tasksList)
      .mockReturnValueOnce(mountedFetch.promise)
      .mockReturnValueOnce(impactFetch.promise);
    const queryClient = createQueryClient();
    const invalidations = vi.spyOn(queryClient, "invalidateQueries");
    const onClose = vi.fn();
    renderModal(queryClient, "vault-a", root, onClose);
    await screen.findByDisplayValue("Root");
    const impactError = new TypeError("invalid impact response");

    await confirmDelete();
    await waitFor(() =>
      expect(api.vaultTasks.tasksList).toHaveBeenCalledTimes(2),
    );
    impactFetch.reject(impactError);
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));

    expect(api.vaultTasks.tasksDelete).not.toHaveBeenCalled();
    expect(invalidations).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(queryClient.getMutationCache().getAll().at(-1)?.state.error).toBe(
      impactError,
    );
  });

  it("freezes old scope and cannot close a replacement while impact is pending", async () => {
    const oldRoot = task(11, "Old root", "101");
    const oldChild = task(12, "Old child", "202", 11);
    const replacement = task(22, "Replacement", "404");
    const mountedFetch = createDeferred<TaskListResponse>();
    const impactFetch = createDeferred<TaskListResponse>();
    vi.mocked(api.vaultTasks.tasksList).mockImplementation((vaultId) =>
      vaultId === "vault-b"
        ? Promise.resolve(taskListResponse([replacement]))
        : vi.mocked(api.vaultTasks.tasksList).mock.calls.length === 1
          ? mountedFetch.promise
          : impactFetch.promise,
    );
    const queryClient = createQueryClient();
    const invalidations = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    const onClose = vi.fn();
    const rendered = renderModal(queryClient, "vault-a", oldRoot, onClose);
    await screen.findByDisplayValue("Old root");

    await confirmDelete();
    await waitFor(() =>
      expect(api.vaultTasks.tasksList).toHaveBeenCalledTimes(2),
    );
    rendered.rerender(
      <TaskEditModalTestProviders queryClient={queryClient}>
        <ControlledModalHarness
          task={replacement}
          vaultId="vault-b"
          onCloseObserved={onClose}
        />
      </TaskEditModalTestProviders>,
    );
    await screen.findByDisplayValue("Replacement");
    await act(async () => {
      impactFetch.resolve(taskListResponse([oldRoot, oldChild]));
      await impactFetch.promise;
    });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));

    expect(api.vaultTasks.tasksDelete).toHaveBeenCalledWith("vault-a", 11);
    expect(invalidatedFilters(invalidations)).toEqual(
      exactFilters("vault-a", ["101", "202"]),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Replacement")).toBeInTheDocument();
  });

  it("trusts present non-invalidated cache without an impact fetch", async () => {
    const root = task(11, "Root", "101");
    const child = task(12, "Child", "202", 11);
    const mountedFetch = createDeferred<TaskListResponse>();
    vi.mocked(api.vaultTasks.tasksList).mockReturnValue(mountedFetch.promise);
    const queryClient = createQueryClient();
    queryClient.setQueryData(vaultTaskListQueryKey("vault-a"), [root, child]);
    const invalidations = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderModal(queryClient, "vault-a", root, onClose);
    await screen.findByDisplayValue("Root");

    await confirmDelete();
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));

    expect(api.vaultTasks.tasksList).toHaveBeenCalledTimes(1);
    expect(api.vaultTasks.tasksDelete).toHaveBeenCalledWith("vault-a", 11);
    expect(invalidatedFilters(invalidations)).toEqual(
      exactFilters("vault-a", ["101", "202"]),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
