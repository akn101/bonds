import type { ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api";
import {
  ControlledCreateModalHarness,
  ControlledModalHarness,
  ReopenModalHarness,
  TaskEditModalTestProviders,
} from "@/test/taskEditModalLifecycleTestViews";
import {
  createDeferred,
  createQueryClient,
  sameIdTaskInVaultB,
  taskA,
} from "@/test/taskEditModalLifecycleTestFixtures";

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
}));

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  return {
    ...actual,
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
    App: Object.assign(
      ({ children }: { readonly children: ReactNode }) => <>{children}</>,
      { useApp: () => ({ message: { error: vi.fn() } }) },
    ),
    Select: () => <div />,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "vault.tasks.cancel": "Cancel",
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
  useVaultNameOrder: () => "first_last",
}));

vi.mock("@/components/CalendarAwareDatePicker", () => ({
  default: () => <div />,
}));

async function submitCurrentTask(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => {
    expect(api.vaultTasks.tasksPartialUpdate).toHaveBeenCalled();
  });
}

describe("TaskEditModal mutation completion lifecycle", () => {
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
    vi.mocked(api.vaultTasks.tasksList).mockResolvedValue({
      data: [],
      success: true,
      meta: { page: 1, per_page: 200, total: 0, total_pages: 1 },
    });
  });

  it("does not let task A completion close task B after Cancel unmounted A", async () => {
    const queryClient = createQueryClient();
    const invalidationSpy = vi.spyOn(queryClient, "invalidateQueries");
    const updateResult =
      createDeferred<
        Awaited<ReturnType<typeof api.vaultTasks.tasksPartialUpdate>>
      >();
    vi.mocked(api.vaultTasks.tasksPartialUpdate).mockReturnValue(
      updateResult.promise,
    );
    const onCloseObserved = vi.fn();
    const user = userEvent.setup();
    render(
      <TaskEditModalTestProviders queryClient={queryClient}>
        <ReopenModalHarness onCloseObserved={onCloseObserved} />
      </TaskEditModalTestProviders>,
    );
    await screen.findByDisplayValue("Task A");

    await submitCurrentTask();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Open task B" }));
    await screen.findByDisplayValue("Task B");
    await act(async () => {
      updateResult.resolve({ success: true, data: taskA });
      await updateResult.promise;
    });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));

    expect(invalidationSpy).toHaveBeenCalledWith({
      queryKey: ["vaults", "vault-a", "all-tasks"],
      exact: true,
    });
    expect(onCloseObserved).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue("Task B")).toBeInTheDocument();
  });

  it("does not let vault A completion close the same task ID mounted for vault B", async () => {
    const queryClient = createQueryClient();
    const invalidationSpy = vi.spyOn(queryClient, "invalidateQueries");
    const updateResult =
      createDeferred<
        Awaited<ReturnType<typeof api.vaultTasks.tasksPartialUpdate>>
      >();
    vi.mocked(api.vaultTasks.tasksPartialUpdate).mockReturnValue(
      updateResult.promise,
    );
    const onCloseObserved = vi.fn();
    const rendered = render(
      <TaskEditModalTestProviders queryClient={queryClient}>
        <ControlledModalHarness
          task={taskA}
          vaultId="vault-a"
          onCloseObserved={onCloseObserved}
        />
      </TaskEditModalTestProviders>,
    );
    await screen.findByDisplayValue("Task A");

    await submitCurrentTask();
    rendered.rerender(
      <TaskEditModalTestProviders queryClient={queryClient}>
        <ControlledModalHarness
          task={sameIdTaskInVaultB}
          vaultId="vault-b"
          onCloseObserved={onCloseObserved}
        />
      </TaskEditModalTestProviders>,
    );
    await waitFor(() => {
      expect(api.vaultTasks.tasksList).toHaveBeenCalledWith("vault-b", {});
    });
    await act(async () => {
      updateResult.resolve({ success: true, data: taskA });
      await updateResult.promise;
    });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));

    expect(invalidationSpy).toHaveBeenCalledWith({
      queryKey: ["vaults", "vault-a", "all-tasks"],
      exact: true,
    });
    expect(onCloseObserved).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Edit task" }),
    ).toBeInTheDocument();
  });

  it("closes the active instance exactly once after its held invalidation resolves", async () => {
    const queryClient = createQueryClient();
    const heldInvalidation = createDeferred<void>();
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation((filters) =>
      filters?.queryKey?.[1] === "vault-a"
        ? heldInvalidation.promise
        : Promise.resolve(),
    );
    vi.mocked(api.vaultTasks.tasksPartialUpdate).mockResolvedValue({
      success: true,
      data: taskA,
    });
    const onCloseObserved = vi.fn();
    render(
      <TaskEditModalTestProviders queryClient={queryClient}>
        <ControlledModalHarness
          task={taskA}
          vaultId="vault-a"
          onCloseObserved={onCloseObserved}
        />
      </TaskEditModalTestProviders>,
    );
    await screen.findByDisplayValue("Task A");

    await submitCurrentTask();
    expect(queryClient.isMutating()).toBe(1);
    expect(onCloseObserved).not.toHaveBeenCalled();

    await act(async () => {
      heldInvalidation.resolve(undefined);
      await heldInvalidation.promise;
    });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(onCloseObserved).toHaveBeenCalledTimes(1);
  });
});

describe("TaskEditModal create rejection lifecycle", () => {
  it("keeps create open without invalidation after the rejected mutation completes", async () => {
    const queryClient = createQueryClient();
    const invalidationSpy = vi.spyOn(queryClient, "invalidateQueries");
    const createResult =
      createDeferred<Awaited<ReturnType<typeof api.vaultTasks.tasksCreate>>>();
    vi.mocked(api.vaultTasks.tasksCreate).mockImplementation(() =>
      createResult.promise.then((result) => result),
    );
    const onCloseObserved = vi.fn();
    const user = userEvent.setup();
    render(
      <TaskEditModalTestProviders queryClient={queryClient}>
        <ControlledCreateModalHarness onCloseObserved={onCloseObserved} />
      </TaskEditModalTestProviders>,
    );

    await user.type(
      screen.getByPlaceholderText("vault.tasks.new_task_label_placeholder"),
      "Rejected task",
    );
    await user.click(
      screen.getByRole("button", { name: "vault.tasks.create" }),
    );
    await waitFor(() => expect(queryClient.isMutating()).toBe(1));
    await act(async () => {
      createResult.reject(new Error("create failed"));
      await createResult.promise.catch(() => undefined);
    });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));

    expect(invalidationSpy).not.toHaveBeenCalled();
    expect(onCloseObserved).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
