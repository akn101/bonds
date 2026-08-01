import { useMemo, useRef, useState } from "react";
import { Card, Tag, Typography, Button, Grid, Spin, theme } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import {
  DndContext,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/api";
import type { VaultTask } from "@/api";
import { useDateFormat, formatShortDate } from "@/utils/dateFormat";
import {
  useTaskStatuses,
  defaultStatusSlug,
  type TaskStatus,
} from "@/utils/taskStatus";
import {
  captureAuthenticationSubjectRevision,
  isAuthenticationSubjectRevisionCurrent,
  type AuthenticationSubjectRevision,
} from "@/utils/authenticationSubjectRevision";
import {
  invalidateVaultTaskImpactQueries,
  vaultTaskListQueryKey,
} from "@/utils/taskQueryInvalidation";
import TaskEditModal from "./TaskEditModal";

const { Text } = Typography;
const { useBreakpoint } = Grid;

interface TasksKanbanProps {
  vaultId: string;
  tasks: VaultTask[];
}

type PositionMoveVariables = {
  readonly vaultId: string;
  readonly id: number;
  readonly position: number;
  readonly status: string;
  readonly authenticationSubjectRevision: AuthenticationSubjectRevision;
};

type PositionMoveContext = {
  readonly queryKey: ReturnType<typeof vaultTaskListQueryKey>;
  readonly previous: VaultTask[] | undefined;
  readonly authenticationSubjectRevision: AuthenticationSubjectRevision;
};

class StalePositionMoveError extends Error {
  override readonly name = "StalePositionMoveError";
}

export default function TasksKanban({ vaultId, tasks }: TasksKanbanProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const queryClient = useQueryClient();
  const dateFormats = useDateFormat();
  const screens = useBreakpoint();
  const isWide = !!screens.lg;

  const { data: statuses = [], isLoading: loadingStatuses } = useTaskStatuses();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<VaultTask | null>(null);
  const [defaultStatus, setDefaultStatus] = useState<string>("todo");
  const [createSubParent, setCreateSubParent] = useState<number | null>(null);
  const positionMoveInFlightRef = useRef(false);

  const moveMutation = useMutation({
    mutationFn: ({
      vaultId: submittedVaultId,
      id,
      position,
      status,
      authenticationSubjectRevision,
    }: PositionMoveVariables) => {
      // onMutate awaits cancellation, so verify the submission's subject again before any request can escape.
      if (!isAuthenticationSubjectRevisionCurrent(authenticationSubjectRevision)) {
        throw new StalePositionMoveError();
      }
      return api.vaultTasks.tasksPositionPartialUpdate(submittedVaultId, id, {
        position,
        status,
      });
    },
    onMutate: async ({
      vaultId: submittedVaultId,
      id,
      position,
      status,
      authenticationSubjectRevision,
    }) => {
      const queryKey = vaultTaskListQueryKey(submittedVaultId);
      await queryClient.cancelQueries({ queryKey });
      if (
        !isAuthenticationSubjectRevisionCurrent(authenticationSubjectRevision)
      ) {
        return {
          queryKey,
          previous: undefined,
          authenticationSubjectRevision,
        } satisfies PositionMoveContext;
      }
      const previous = queryClient.getQueryData<VaultTask[]>(queryKey);
      if (previous) {
        queryClient.setQueryData<VaultTask[]>(queryKey, (cur) => {
          if (!cur) return cur;
          return reorderInCache(cur, id, status, position);
        });
      }
      return {
        queryKey,
        previous,
        authenticationSubjectRevision,
      } satisfies PositionMoveContext;
    },
    onError: (error, _vars, ctx) => {
      if (error instanceof StalePositionMoveError) {
        return;
      }
      // Old callbacks must not restore or invalidate after a newer authentication subject owns the QueryClient.
      if (
        ctx === undefined ||
        ctx.previous === undefined ||
        !isAuthenticationSubjectRevisionCurrent(
          ctx.authenticationSubjectRevision,
        )
      ) {
        return;
      }
      queryClient.setQueryData(ctx.queryKey, ctx.previous);
    },
    // Mutation options update on rerender, so completion must use the submitted Vault identity instead of current props.
    onSuccess: (_data, { vaultId: submittedVaultId }, ctx) => {
      if (
        ctx === undefined ||
        !isAuthenticationSubjectRevisionCurrent(
          ctx.authenticationSubjectRevision,
        )
      ) {
        return;
      }
      return invalidateVaultTaskImpactQueries(queryClient, [submittedVaultId]);
    },
    onSettled: () => {
      positionMoveInFlightRef.current = false;
    },
  });

  // Bucket tasks by status slug. Tasks whose slug doesn't match any
  // configured status get placed in the default column as a safety net
  // (the cascade-delete on the server should prevent this from happening).
  const columns = useMemo(() => {
    const fallback = defaultStatusSlug(statuses);
    const grouped: Record<string, VaultTask[]> = {};
    for (const s of statuses) grouped[s.slug] = [];
    for (const task of tasks) {
      const slug = task.status && grouped[task.status] ? task.status : fallback;
      if (!grouped[slug]) grouped[slug] = [];
      grouped[slug].push(task);
    }
    return grouped;
  }, [statuses, tasks]);

  const handleDragEnd = (event: DragEndEvent) => {
    if (positionMoveInFlightRef.current) return;
    const { active, over } = event;
    if (!over) return;
    const activeId = Number(active.id);
    const activeTask = tasks.find((t) => t.id === activeId);
    if (!activeTask) return;

    const overId = String(over.id);
    let destStatus: string;
    let destPosition: number;

    if (overId.startsWith("col:")) {
      destStatus = overId.slice(4);
      destPosition = (columns[destStatus] ?? []).length;
    } else {
      const overTask = tasks.find((t) => t.id === Number(overId));
      if (!overTask) return;
      destStatus = overTask.status ?? defaultStatusSlug(statuses);
      const destColumn = columns[destStatus] ?? [];
      destPosition = destColumn.findIndex((t) => t.id === overTask.id);
      if (destPosition < 0) destPosition = destColumn.length;
    }

    const srcStatus = activeTask.status ?? defaultStatusSlug(statuses);
    const srcPosition = (columns[srcStatus] ?? []).findIndex(
      (t) => t.id === activeId,
    );
    if (srcStatus === destStatus && srcPosition === destPosition) return;

    // Mutation render state can lag, so lock before mutate prevents pre-rerender reentry.
    positionMoveInFlightRef.current = true;
    moveMutation.mutate({
      vaultId,
      id: activeId,
      position: destPosition,
      status: destStatus,
      authenticationSubjectRevision: captureAuthenticationSubjectRevision(),
    });
  };

  const openCreateModal = (slug: string) => {
    setEditingTask(null);
    setDefaultStatus(slug);
    setModalOpen(true);
  };
  const openEditModal = (task: VaultTask) => {
    setEditingTask(task);
    setModalOpen(true);
  };

  if (loadingStatuses) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <Spin />
      </div>
    );
  }

  // No statuses configured (shouldn't happen post-seed, but guard anyway).
  if (statuses.length === 0) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: "center",
          color: token.colorTextSecondary,
        }}
      >
        {t("vault.tasks.no_statuses_configured")}
      </div>
    );
  }

  const columnGrid = isWide
    ? {
        display: "grid",
        gridTemplateColumns: `repeat(${statuses.length}, minmax(0, 1fr))`,
        gap: 16,
      }
    : { display: "flex", flexDirection: "column" as const, gap: 16 };

  const renderColumns = () => (
    <div style={columnGrid}>
      {statuses.map((status) => (
        <KanbanColumn
          key={status.slug}
          status={status}
          tasks={columns[status.slug] ?? []}
          token={token}
          dateFormats={dateFormats}
          dueLabel={t("vault.tasks.due", { date: "" }).replace(/\s*$/, "")}
          emptyLabel={t("vault.tasks.empty_column")}
          onAdd={() => openCreateModal(status.slug)}
          onTaskClick={openEditModal}
          addLabel={t("vault.tasks.new_task")}
          interactive={isWide}
          dragDisabled={moveMutation.isPending}
        />
      ))}
    </div>
  );

  return (
    <div>
      {isWide ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragEnd={handleDragEnd}
        >
          {renderColumns()}
        </DndContext>
      ) : (
        renderColumns()
      )}

      <TaskEditModal
        vaultId={vaultId}
        open={modalOpen}
        task={editingTask}
        defaultStatus={defaultStatus}
        defaultParentTaskId={createSubParent ?? undefined}
        statuses={statuses}
        onClose={() => {
          setModalOpen(false);
          setCreateSubParent(null);
        }}
        onSelectTask={(t) => {
          setCreateSubParent(null);
          setEditingTask(t);
          setModalOpen(true);
        }}
        onCreateSubTask={(parentId) => {
          setEditingTask(null);
          setCreateSubParent(parentId);
          setModalOpen(true);
        }}
      />
    </div>
  );
}

function reorderInCache(
  tasks: VaultTask[],
  id: number,
  status: string,
  position: number,
): VaultTask[] {
  const moved = tasks.find((t) => t.id === id);
  if (!moved) return tasks;
  const filtered = tasks.filter((t) => t.id !== id);
  const sameStatus = filtered.filter((t) => t.status === status);
  const others = filtered.filter((t) => t.status !== status);
  const insertAt = Math.min(position, sameStatus.length);
  const updatedMoved: VaultTask = { ...moved, status };
  const newSameStatus = [
    ...sameStatus.slice(0, insertAt),
    updatedMoved,
    ...sameStatus.slice(insertAt),
  ];
  return [...others, ...newSameStatus];
}

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: VaultTask[];
  token: ReturnType<typeof theme.useToken>["token"];
  dateFormats: ReturnType<typeof useDateFormat>;
  dueLabel: string;
  emptyLabel: string;
  addLabel: string;
  onAdd: () => void;
  onTaskClick: (task: VaultTask) => void;
  interactive: boolean;
  dragDisabled: boolean;
}

function KanbanColumn(props: KanbanColumnProps) {
  const {
    status,
    tasks,
    token,
    dateFormats,
    dueLabel,
    emptyLabel,
    addLabel,
    onAdd,
    onTaskClick,
    interactive,
    dragDisabled,
  } = props;

  return (
    <div
      data-status={status.slug}
      style={{
        background: token.colorFillQuaternary,
        borderRadius: token.borderRadiusLG,
        padding: 12,
        minHeight: 200,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text strong style={{ fontSize: 13 }}>
          {status.label}{" "}
          <Text type="secondary" style={{ fontWeight: 400 }}>
            · {tasks.length}
          </Text>
        </Text>
        <Button
          type="text"
          size="small"
          icon={<PlusOutlined />}
          onClick={onAdd}
          aria-label={addLabel}
        />
      </div>

      {interactive ? (
        <DroppableColumnArea
          slug={status.slug}
          token={token}
          empty={tasks.length === 0}
          emptyLabel={emptyLabel}
          disabled={dragDisabled}
        >
          <SortableContext
            items={tasks.map((t) => String(t.id))}
            strategy={verticalListSortingStrategy}
          >
            {tasks.map((task) => (
              <SortableTaskCard
                key={task.id}
                task={task}
                token={token}
                dateFormats={dateFormats}
                dueLabel={dueLabel}
                onClick={() => onTaskClick(task)}
                dragDisabled={dragDisabled}
              />
            ))}
          </SortableContext>
        </DroppableColumnArea>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minHeight: 60,
          }}
        >
          {tasks.length === 0 ? (
            <EmptyColumnPlaceholder token={token} label={emptyLabel} />
          ) : (
            tasks.map((task) => (
              <PlainTaskCard
                key={task.id}
                task={task}
                token={token}
                dateFormats={dateFormats}
                dueLabel={dueLabel}
                onClick={() => onTaskClick(task)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function DroppableColumnArea(props: {
  slug: string;
  token: ReturnType<typeof theme.useToken>["token"];
  empty: boolean;
  emptyLabel: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${props.slug}`,
    disabled: props.disabled,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minHeight: 60,
        outline: isOver ? `2px solid ${props.token.colorPrimary}` : undefined,
        outlineOffset: -2,
        transition: "outline 120ms ease",
        borderRadius: props.token.borderRadius,
      }}
    >
      {props.empty ? (
        <EmptyColumnPlaceholder token={props.token} label={props.emptyLabel} />
      ) : (
        props.children
      )}
    </div>
  );
}

function EmptyColumnPlaceholder(props: {
  token: ReturnType<typeof theme.useToken>["token"];
  label: string;
}) {
  return (
    <div
      style={{
        border: `1px dashed ${props.token.colorBorder}`,
        borderRadius: props.token.borderRadius,
        padding: "24px 12px",
        textAlign: "center",
        color: props.token.colorTextTertiary,
        fontSize: 12,
      }}
    >
      {props.label}
    </div>
  );
}

interface TaskCardCommonProps {
  task: VaultTask;
  token: ReturnType<typeof theme.useToken>["token"];
  dateFormats: ReturnType<typeof useDateFormat>;
  dueLabel: string;
  onClick: () => void;
}

function TaskCardBody({
  task,
  token,
  dateFormats,
  dueLabel,
}: Omit<TaskCardCommonProps, "onClick">) {
  const contacts = task.contacts ?? [];
  const hasMeta = contacts.length > 0 || task.due_at;
  return (
    <Card
      size="small"
      styles={{ body: { padding: 12 } }}
      style={{ borderRadius: token.borderRadius }}
    >
      <div
        style={{
          fontWeight: 500,
          marginBottom: hasMeta ? 6 : 0,
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        {task.label}
      </div>
      {hasMeta && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            alignItems: "center",
          }}
        >
          {contacts.map((c) => (
            <Tag key={c.id} color="blue" style={{ marginRight: 0 }}>
              {c.name || c.id}
            </Tag>
          ))}
          {task.due_at && (
            <Tag color="orange" style={{ marginRight: 0 }}>
              {dueLabel} {formatShortDate(task.due_at, dateFormats)}
            </Tag>
          )}
        </div>
      )}
    </Card>
  );
}

function SortableTaskCard(
  props: TaskCardCommonProps & { readonly dragDisabled: boolean },
) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: String(props.task.id),
    disabled: props.dragDisabled,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: props.dragDisabled ? "pointer" : "grab",
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      aria-disabled={undefined}
      {...listeners}
      onClick={props.onClick}
    >
      <TaskCardBody {...props} />
    </div>
  );
}

function PlainTaskCard(props: TaskCardCommonProps) {
  return (
    <div onClick={props.onClick} style={{ cursor: "pointer" }}>
      <TaskCardBody {...props} />
    </div>
  );
}
