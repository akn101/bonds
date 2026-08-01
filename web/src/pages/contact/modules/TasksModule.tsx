import { useState } from "react";
import { Card, List, Button, Divider, Empty, theme } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import type { Task } from "@/api";
import { useTranslation } from "react-i18next";
import type { NormalizedFeedSource } from "@/utils/feedSourceLink";
import {
  taskListQueryKeys,
  type TaskMutationSource,
} from "@/utils/taskQueryInvalidation";
import { useSourceRecordReveal } from "../contactSourceRecord";
import TaskEditor from "./TaskEditor";
import TaskListItem from "./TaskListItem";
import {
  createTaskDeleteMutationOperation,
  createTaskSaveMutationOperation,
  createTaskToggleMutationOperation,
  type TaskMutationTarget,
} from "./taskMutationOperation";
import { useTaskMutations } from "./useTaskMutations";

export default function TasksModule({
  vaultId,
  contactId,
  target,
}: {
  vaultId: string | number;
  contactId: string | number;
  target?: Extract<NormalizedFeedSource, { readonly module: "tasks" }>;
}) {
  const [adding, setAdding] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskMutationTarget | null>(
    null,
  );
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const [showCompleted, setShowCompleted] = useState(false);
  const source: TaskMutationSource = {
    vaultId: String(vaultId),
    contactId: String(contactId),
  };
  const queryKeys = taskListQueryKeys(source);
  const resetSaveForm = () => {
    setAdding(false);
    setEditingTask(null);
    setLabel("");
    setDescription("");
  };
  const { saveMutation, toggleMutation, deleteMutation } = useTaskMutations({
    resetSaveForm,
  });

  const { data: pending = [], isLoading } = useQuery({
    queryKey: queryKeys.pending,
    queryFn: async (): Promise<Task[]> => {
      const res = await api.tasks.contactsTasksList(
        source.vaultId,
        source.contactId,
      );
      return res.data ?? [];
    },
  });

  const { data: completed = [], isLoading: isLoadingCompleted } = useQuery({
    queryKey: queryKeys.completed,
    queryFn: async (): Promise<Task[]> => {
      const res = await api.tasks.contactsTasksCompletedList(
        source.vaultId,
        source.contactId,
      );
      const completedTasks: Task[] = res.data ?? [];
      if (
        target &&
        completedTasks.some((task: Task) => task.id === target.id)
      ) {
        setShowCompleted(true);
      }
      return completedTasks;
    },
    enabled: showCompleted || target !== undefined,
  });
  const targetAvailable =
    target !== undefined &&
    [...pending, ...completed].some((task: Task) => task.id === target.id);

  useSourceRecordReveal(target, targetAvailable);

  function submitForm() {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) return;
    saveMutation.mutate(
      createTaskSaveMutationOperation(source, editingTask, {
        label: trimmedLabel,
        description: description.trim(),
      }),
    );
  }

  function renderItem(task: Task) {
    if (editingTask?.id === task.id) {
      return (
        <TaskEditor
          mode="update"
          values={{ label, description }}
          pending={saveMutation.isPending}
          onChange={(values) => {
            setLabel(values.label);
            setDescription(values.description);
          }}
          onSubmit={submitForm}
          onCancel={resetSaveForm}
        />
      );
    }

    return (
      <TaskListItem
        task={task}
        routeContactId={source.contactId}
        onEdit={(selectedTask) => {
          if (selectedTask.id === undefined) return;
          setEditingTask({
            id: selectedTask.id,
            contacts: selectedTask.contacts,
          });
          setLabel(selectedTask.label ?? "");
          setDescription(selectedTask.description ?? "");
          setAdding(false);
        }}
        onToggle={(selectedTask) => {
          if (selectedTask.id === undefined) return;
          toggleMutation.mutate(
            createTaskToggleMutationOperation(source, {
              id: selectedTask.id,
              completed: selectedTask.completed ?? false,
              contacts: selectedTask.contacts,
            }),
          );
        }}
        onDelete={(selectedTask) => {
          if (selectedTask.id === undefined) return;
          deleteMutation.mutate(
            createTaskDeleteMutationOperation(source, {
              id: selectedTask.id,
              contacts: selectedTask.contacts,
            }),
          );
        }}
      />
    );
  }

  return (
    <Card
      title={
        <span style={{ fontWeight: 500 }}>{t("modules.tasks.title")}</span>
      }
      styles={{
        header: { borderBottom: `1px solid ${token.colorBorderSecondary}` },
        body: { padding: "16px 24px" },
      }}
      extra={
        !adding &&
        editingTask === null && (
          <Button
            type="text"
            icon={<PlusOutlined />}
            onClick={() => {
              setAdding(true);
              setLabel("");
              setDescription("");
            }}
            style={{ color: token.colorPrimary }}
          >
            {t("modules.tasks.add")}
          </Button>
        )
      }
    >
      {adding && (
        <TaskEditor
          mode="create"
          values={{ label, description }}
          pending={saveMutation.isPending}
          onChange={(values) => {
            setLabel(values.label);
            setDescription(values.description);
          }}
          onSubmit={submitForm}
          onCancel={resetSaveForm}
        />
      )}

      <List
        loading={isLoading}
        dataSource={pending}
        locale={{
          emptyText: <Empty description={t("modules.tasks.no_pending")} />,
        }}
        split={false}
        renderItem={renderItem}
      />

      <Divider
        orientationMargin={0}
        plain
        style={{ fontSize: 12, color: token.colorTextQuaternary }}
      >
        <Button
          type="text"
          size="small"
          onClick={() => setShowCompleted(!showCompleted)}
          style={{ fontSize: 12, color: token.colorTextQuaternary }}
        >
          {showCompleted
            ? t("modules.tasks.hide_completed")
            : t("modules.tasks.show_completed")}
        </Button>
      </Divider>

      {showCompleted && (
        <List
          loading={isLoadingCompleted}
          dataSource={completed}
          split={false}
          renderItem={renderItem}
          locale={{
            emptyText: (
              <Empty description={t("modules.tasks.completed", { count: 0 })} />
            ),
          }}
        />
      )}
    </Card>
  );
}
