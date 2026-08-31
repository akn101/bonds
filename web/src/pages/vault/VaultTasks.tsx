import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Card,
  Typography,
  Button,
  Spin,
  Segmented,
  theme,
} from "antd";
import {
  ArrowLeftOutlined,
  CheckSquareOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type { UserPreferences, VaultTask } from "@/api";
import { useTranslation } from "react-i18next";
import { useDateFormat } from "@/utils/dateFormat";
import TasksKanban from "./TasksKanban";
import TaskEditModal from "./TaskEditModal";
import { VaultTaskList } from "./VaultTaskList";
import { createVaultTaskCompletionOperation } from "./vaultTaskMutationOperation";
import { invalidateSetVaultTaskCompletion } from "./vaultTaskMutationInvalidation";
import {
  sortTasksForListView,
  type TaskSortMode,
} from "./taskSort";

const { Title } = Typography;

type ViewMode = "list" | "kanban";

function normalizeViewMode(value: string | undefined): ViewMode {
  return value === "kanban" ? "kanban" : "list";
}

function normalizeTaskSortMode(value: string | undefined): TaskSortMode {
  return value === "due_date" ? "due_date" : "custom";
}

export default function VaultTasks() {
  const { id } = useParams<{ id: string }>();
  const vaultId = id!;
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const dateFormats = useDateFormat();
  const queryClient = useQueryClient();
  const [viewOverride, setViewOverride] = useState<ViewMode | null>(null);
  const [sortOverride, setSortOverride] = useState<TaskSortMode | null>(null);

  const { data: preferences } = useQuery<UserPreferences>({
    queryKey: ["settings", "preferences"],
    queryFn: async () => (await api.preferences.preferencesList()).data!,
  });
  const view = viewOverride ?? normalizeViewMode(preferences?.task_view);
  const sortMode =
    sortOverride ?? normalizeTaskSortMode(preferences?.task_sort);

  const preferenceMutation = useMutation({
    mutationFn: (next: Partial<UserPreferences>) =>
      api.preferences.preferencesUpdate(next),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["settings", "preferences"] }),
  });

  const updateView = (next: ViewMode) => {
    setViewOverride(next);
    preferenceMutation.mutate({ task_view: next });
  };

  const updateSortMode = (next: TaskSortMode) => {
    setSortOverride(next);
    preferenceMutation.mutate({ task_sort: next });
  };

  // Modal state owned by VaultTasks for the list view's row clicks. The
  // kanban view has its own modal instance for "+ create" and card clicks.
  // `createSubParent` lets the modal stay open in create-mode with a
  // parent_task_id pre-filled when the user clicks "+ Add sub-task".
  const [editTask, setEditTask] = useState<VaultTask | null>(null);
  const [createSubParent, setCreateSubParent] = useState<number | null>(null);
  const modalOpen = editTask !== null || createSubParent !== null;
  const closeModal = () => {
    setEditTask(null);
    setCreateSubParent(null);
  };

  const { data: tasks = [], isLoading } = useQuery<VaultTask[]>({
    queryKey: ["vaults", vaultId, "all-tasks"],
    queryFn: async () => {
      const res = await api.vaultTasks.tasksList(String(vaultId));
      return (res.data ?? []) as VaultTask[];
    },
    enabled: !!vaultId,
  });

  const completionMutation = useMutation({
    mutationFn: (
      operation: ReturnType<typeof createVaultTaskCompletionOperation>,
    ) =>
      api.vaultTasks.tasksStatusPartialUpdate(
        operation.vaultId,
        operation.taskId,
        { status: operation.status },
      ),
    onSuccess: (_response, operation) =>
      invalidateSetVaultTaskCompletion(queryClient, operation),
  });

  const pending = useMemo(
    () => sortTasksForListView(tasks.filter((task) => !task.completed), sortMode),
    [sortMode, tasks],
  );
  const completed = useMemo(
    () => sortTasksForListView(tasks.filter((task) => task.completed), sortMode),
    [sortMode, tasks],
  );

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ width: "100%", margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 24,
          flexWrap: "wrap",
        }}
      >
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(`/vaults/${vaultId}`)}
          style={{ color: token.colorTextSecondary }}
        />
        <CheckSquareOutlined style={{ fontSize: 20, color: token.colorPrimary }} />
        <Title level={4} style={{ margin: 0, flex: 1 }}>
          {t("vault.tasks.title")}
        </Title>
        <Segmented
          value={view}
          onChange={(v) => updateView(v as ViewMode)}
          options={[
            { label: t("vault.tasks.view_list"), value: "list" },
            { label: t("vault.tasks.view_kanban"), value: "kanban" },
          ]}
        />
        {view === "list" && (
          <Segmented
            value={sortMode}
            onChange={(value) => updateSortMode(value as TaskSortMode)}
            options={[
              { label: t("vault.tasks.sort_custom"), value: "custom" },
              { label: t("vault.tasks.sort_due_date"), value: "due_date" },
            ]}
          />
        )}
      </div>

      {view === "kanban" ? (
        <TasksKanban vaultId={vaultId} tasks={tasks} />
      ) : (
        <Card
          style={{
            boxShadow: token.boxShadowTertiary,
            borderRadius: token.borderRadiusLG,
          }}
        >
          <VaultTaskList
            pendingTasks={pending}
            completedTasks={completed}
            dateFormats={dateFormats}
            onSelectTask={(task) => setEditTask(task)}
            onToggleTask={(task) => {
              if (task.id === undefined) return;
              completionMutation.mutate(
                createVaultTaskCompletionOperation({
                  vaultId,
                  task: { ...task, id: task.id },
                }),
              );
            }}
            onNavigateToContact={(contactId) => navigate(`/vaults/${vaultId}/contacts/${contactId}`)}
            completionPending={completionMutation.isPending}
          />
        </Card>
      )}

      <TaskEditModal
        vaultId={vaultId}
        open={modalOpen}
        task={editTask}
        defaultParentTaskId={createSubParent ?? undefined}
        onClose={closeModal}
        onSelectTask={(t) => {
          setCreateSubParent(null);
          setEditTask(t);
        }}
        onCreateSubTask={(parentId) => {
          setEditTask(null);
          setCreateSubParent(parentId);
        }}
      />
    </div>
  );
}
