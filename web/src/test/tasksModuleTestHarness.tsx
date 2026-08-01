import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import type { InvalidateQueryFilters } from "@tanstack/react-query";
import type { Task, VaultTask } from "@/api";
import { taskListQueryKeys } from "@/utils/taskQueryInvalidation";
import { vaultTaskListQueryKey } from "@/utils/taskQueryInvalidation";
import { TasksModuleTestTree } from "./tasksModuleTestTree";

const hoistedMocks = vi.hoisted(() => ({
  taskApiMocks: {
    contactsTasksList: vi.fn(),
    contactsTasksCompletedList: vi.fn(),
    contactsTasksCreate: vi.fn(),
    contactsTasksUpdate: vi.fn(),
    contactsTasksToggleUpdate: vi.fn(),
    contactsTasksDelete: vi.fn(),
  },
  vaultTaskApiMocks: {
    tasksList: vi.fn(),
  },
  taskMessageMocks: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

export const taskApiMocks = hoistedMocks.taskApiMocks;
export const vaultTaskApiMocks = hoistedMocks.vaultTaskApiMocks;
export const taskMessageMocks = hoistedMocks.taskMessageMocks;

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  return {
    ...actual,
    App: Object.assign(actual.App, {
      useApp: () => ({ message: hoistedMocks.taskMessageMocks }),
    }),
  };
});

vi.mock("@/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api")>();
  return {
    ...actual,
    api: {
      tasks: hoistedMocks.taskApiMocks,
      vaultTasks: hoistedMocks.vaultTaskApiMocks,
    },
  };
});

export const sourceTask: Task = {
  id: 11,
  label: "Route contact task",
  description: "Task details",
  completed: false,
  contacts: [
    { id: "202", name: "Route Contact" },
    { id: "303", name: "Shared Assignee" },
  ],
};

type TasksModuleTestProps = {
  readonly vaultId?: string;
  readonly contactId?: string;
  readonly pendingTasks?: readonly Task[];
  readonly completedTasks?: readonly Task[];
  readonly cachedAllTasks?: readonly VaultTask[];
  readonly allTasksCacheInvalidated?: boolean;
  readonly preloadTaskLists?: boolean;
};

beforeEach(() => {
  vi.clearAllMocks();
  taskApiMocks.contactsTasksList.mockResolvedValue({ data: [] });
  taskApiMocks.contactsTasksCompletedList.mockResolvedValue({ data: [] });
  taskApiMocks.contactsTasksCreate.mockResolvedValue({
    data: { ...sourceTask, id: 12 },
  });
  taskApiMocks.contactsTasksUpdate.mockResolvedValue({ data: sourceTask });
  taskApiMocks.contactsTasksToggleUpdate.mockResolvedValue({
    data: { ...sourceTask, completed: true },
  });
  taskApiMocks.contactsTasksDelete.mockResolvedValue(undefined);
  vaultTaskApiMocks.tasksList.mockResolvedValue({
    data: [],
    success: true,
    meta: { page: 1, per_page: 200, total: 0, total_pages: 1 },
  });
});

export function renderTasksModule({
  vaultId = "101",
  contactId = "202",
  pendingTasks = [],
  completedTasks = [],
  cachedAllTasks,
  allTasksCacheInvalidated = false,
  preloadTaskLists = false,
}: TasksModuleTestProps = {}) {
  taskApiMocks.contactsTasksList.mockResolvedValue({ data: pendingTasks });
  taskApiMocks.contactsTasksCompletedList.mockResolvedValue({
    data: completedTasks,
  });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: cachedAllTasks === undefined ? 0 : Infinity,
      },
      mutations: { retry: false },
    },
  });
  if (preloadTaskLists) {
    const taskQueryKeys = taskListQueryKeys({ vaultId, contactId });
    queryClient.setQueryData(taskQueryKeys.pending, [...pendingTasks]);
    queryClient.setQueryData(taskQueryKeys.completed, [...completedTasks]);
  }
  if (cachedAllTasks !== undefined) {
    const allTasksQueryKey = vaultTaskListQueryKey(vaultId);
    queryClient.setQueryData(allTasksQueryKey, [...cachedAllTasks]);
    if (allTasksCacheInvalidated) {
      queryClient
        .getQueryCache()
        .find({ queryKey: allTasksQueryKey, exact: true })
        ?.invalidate();
    }
  }
  vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
  const rendered = render(
    <TasksModuleTestTree
      queryClient={queryClient}
      vaultId={vaultId}
      contactId={contactId}
    />,
  );

  return {
    queryClient,
    rerenderModule(nextVaultId: string, nextContactId: string) {
      rendered.rerender(
        <TasksModuleTestTree
          queryClient={queryClient}
          vaultId={nextVaultId}
          contactId={nextContactId}
        />,
      );
    },
  };
}

export function invalidatedQueryKeys(
  queryClient: QueryClient,
): readonly (readonly unknown[])[] {
  return vi
    .mocked(queryClient.invalidateQueries)
    .mock.calls.flatMap(([filters]) =>
      filters?.queryKey === undefined ? [] : [filters.queryKey],
    );
}

export function invalidatedQueryFilters(
  queryClient: QueryClient,
): readonly InvalidateQueryFilters[] {
  return vi
    .mocked(queryClient.invalidateQueries)
    .mock.calls.flatMap(([filters]) =>
      filters === undefined ? [] : [filters],
    );
}
