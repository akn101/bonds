import type { MouseEvent, SyntheticEvent } from "react";
import { Button, Checkbox, Divider, List, Tag, theme } from "antd";
import { CheckSquareOutlined, UserOutlined } from "@ant-design/icons";
import { Virtuoso } from "react-virtuoso";
import { useTranslation } from "react-i18next";
import type { VaultTask } from "@/api";
import { formatShortDate, type DateFormatVariants } from "@/utils/dateFormat";

interface VaultTaskListProps {
  readonly pendingTasks: readonly VaultTask[];
  readonly completedTasks: readonly VaultTask[];
  readonly dateFormats: DateFormatVariants;
  readonly onSelectTask: (task: VaultTask) => void;
  readonly onToggleTask: (task: VaultTask) => void;
  readonly onNavigateToContact: (contactId: string) => void;
  readonly completionPending?: boolean;
}

type VaultTaskListRow =
  | { readonly kind: "pending-task"; readonly task: VaultTask }
  | { readonly kind: "completed-divider"; readonly count: number }
  | { readonly kind: "completed-task"; readonly task: VaultTask };

function assertNever(value: never): never {
  throw new Error(`Unexpected vault task row: ${JSON.stringify(value)}`);
}

export function VaultTaskList({
  pendingTasks,
  completedTasks,
  dateFormats,
  onSelectTask,
  onToggleTask,
  onNavigateToContact,
  completionPending = false,
}: VaultTaskListProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  const stop = (event: MouseEvent | SyntheticEvent) => event.stopPropagation();

  function renderContactLink(task: VaultTask) {
    const contacts = task.contacts ?? [];
    if (contacts.length === 0) return null;

    return (
      <div
        style={{
          marginLeft: 24,
          marginTop: 4,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
        }}
        onClick={stop}
      >
        {contacts.map((contact) => (
          <Button
            key={contact.id}
            type="link"
            size="small"
            icon={<UserOutlined />}
            style={{
              padding: 0,
              height: "auto",
              fontSize: 12,
              color: token.colorTextSecondary,
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (contact.id) {
                onNavigateToContact(contact.id);
              }
            }}
          >
            {contact.name || contact.id}
          </Button>
        ))}
      </div>
    );
  }

  function renderPendingTask(task: VaultTask) {
    return (
      <List.Item
        onClick={() => onSelectTask(task)}
        style={{
          borderLeft: `3px solid ${token.colorSuccess}`,
          paddingLeft: 12,
          borderRadius: `0 ${token.borderRadius}px ${token.borderRadius}px 0`,
          background: token.colorFillQuaternary,
          display: "block",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span onClick={stop} style={{ minWidth: 0, flex: 1 }}>
            <Checkbox
              checked={false}
              disabled={completionPending}
              onChange={() => onToggleTask(task)}
              style={{ display: "flex", alignItems: "flex-start" }}
            >
              <span
                style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
              >
                {task.label}
              </span>
            </Checkbox>
          </span>
          {task.due_at && (
            <Tag
              color="orange"
              style={{ marginLeft: "auto", borderRadius: 12, flexShrink: 0 }}
            >
              {t("vault.tasks.due", {
                date: formatShortDate(task.due_at, dateFormats),
              })}
            </Tag>
          )}
        </div>
        {renderContactLink(task)}
        {task.description && (
          <div
            style={{
              marginLeft: 24,
              marginTop: 4,
              fontSize: 13,
              color: token.colorTextSecondary,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {task.description}
          </div>
        )}
      </List.Item>
    );
  }

  function renderCompletedTask(task: VaultTask) {
    return (
      <List.Item
        onClick={() => onSelectTask(task)}
        style={{
          borderLeft: `3px solid ${token.colorBorder}`,
          paddingLeft: 12,
          borderRadius: `0 ${token.borderRadius}px ${token.borderRadius}px 0`,
          opacity: 0.6,
          display: "block",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span onClick={stop} style={{ minWidth: 0, flex: 1 }}>
            <Checkbox
              checked
              disabled={completionPending}
              onChange={() => onToggleTask(task)}
              style={{ display: "flex", alignItems: "flex-start" }}
            >
              <span
                style={{
                  textDecoration: "line-through",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                }}
              >
                {task.label}
              </span>
            </Checkbox>
          </span>
        </div>
        {renderContactLink(task)}
      </List.Item>
    );
  }

  if (pendingTasks.length === 0 && completedTasks.length === 0) {
    return (
      <div className="bonds-empty-hero">
        <div
          className="bonds-empty-hero-icon"
          style={{ background: token.colorPrimaryBg }}
        >
          <CheckSquareOutlined
            style={{ fontSize: 32, color: token.colorPrimary }}
          />
        </div>
        <div className="bonds-empty-hero-title">
          {t("vault.tasks.no_pending")}
        </div>
        <div
          className="bonds-empty-hero-desc"
          style={{ color: token.colorTextSecondary }}
        >
          {t("empty.tasks")}
        </div>
      </div>
    );
  }

  const rows: readonly VaultTaskListRow[] = [
    ...pendingTasks.map((task) => ({ kind: "pending-task" as const, task })),
    ...(completedTasks.length > 0
      ? [
          { kind: "completed-divider" as const, count: completedTasks.length },
          ...completedTasks.map((task) => ({
            kind: "completed-task" as const,
            task,
          })),
        ]
      : []),
  ];

  return (
    <Virtuoso
      useWindowScroll
      // The Card has no intrinsic list height before Virtuoso estimates a row,
      // so seed rendering and sizing instead of waiting on a zero-height viewport.
      initialItemCount={1}
      defaultItemHeight={72}
      data={rows}
      computeItemKey={(index, row) => {
        switch (row.kind) {
          case "pending-task":
            return `pending-${row.task.id ?? index}`;
          case "completed-divider":
            return "completed-divider";
          case "completed-task":
            return `completed-${row.task.id ?? index}`;
          default:
            return assertNever(row);
        }
      }}
      itemContent={(_, row) => {
        switch (row.kind) {
          case "pending-task":
            // Virtuoso excludes vertical margins from ResizeObserver item
            // measurements, so spacing stays inside the measured wrapper.
            return (
              <div style={{ paddingBottom: token.paddingXXS }}>
                {renderPendingTask(row.task)}
              </div>
            );
          case "completed-divider":
            return (
              <div style={{ paddingBlock: token.paddingLG }}>
                <Divider
                  plain
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: token.colorTextSecondary,
                    borderColor: token.colorBorderSecondary,
                  }}
                >
                  {t("vault.tasks.completed", { count: row.count })}
                </Divider>
              </div>
            );
          case "completed-task":
            return (
              <div style={{ paddingBottom: token.paddingXXS }}>
                {renderCompletedTask(row.task)}
              </div>
            );
          default:
            return assertNever(row);
        }
      }}
    />
  );
}
