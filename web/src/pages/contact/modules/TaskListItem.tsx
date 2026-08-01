import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { Button, Checkbox, List, Popconfirm, Tag, theme } from "antd";
import { useTranslation } from "react-i18next";
import type { Task } from "@/api";
import { sourceRecordKey } from "../contactSourceRecord";

type TaskListItemProps = {
  readonly task: Task;
  readonly routeContactId: string;
  readonly onEdit: (task: Task) => void;
  readonly onToggle: (task: Task) => void;
  readonly onDelete: (task: Task) => void;
};

export default function TaskListItem({
  task,
  routeContactId,
  onEdit,
  onToggle,
  onDelete,
}: TaskListItemProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const sharedAssignees = (task.contacts ?? []).filter(
    (contact) => String(contact.id) !== routeContactId,
  );

  return (
    <List.Item
      data-source-record={
        task.id === undefined
          ? undefined
          : sourceRecordKey("ContactTask", task.id)
      }
      style={{
        borderRadius: token.borderRadius,
        padding: "8px 12px",
        marginBottom: 4,
        transition: "background 0.2s",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = token.colorFillQuaternary;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "transparent";
      }}
      actions={[
        <Button
          key="edit"
          type="text"
          size="small"
          icon={<EditOutlined />}
          onClick={() => onEdit(task)}
        />,
        <Popconfirm
          key="delete"
          title={t("modules.tasks.delete_confirm")}
          onConfirm={() => {
            if (task.id !== undefined) onDelete(task);
          }}
        >
          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>,
      ]}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <Checkbox
          checked={task.completed}
          onChange={() => {
            if (task.id !== undefined) {
              onToggle(task);
            }
          }}
          style={{ display: "flex", alignItems: "flex-start" }}
        >
          <span
            style={{
              textDecoration: task.completed ? "line-through" : undefined,
              color: task.completed
                ? token.colorTextQuaternary
                : token.colorText,
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
          >
            {task.label}
          </span>
        </Checkbox>
        {task.description && (
          <div
            style={{
              marginLeft: 24,
              marginTop: 4,
              fontSize: 13,
              color: token.colorTextSecondary,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              textDecoration: task.completed ? "line-through" : undefined,
            }}
          >
            {task.description}
          </div>
        )}
        {sharedAssignees.length > 0 && (
          <div
            style={{
              marginLeft: 24,
              marginTop: 6,
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
            }}
          >
            {sharedAssignees.map((contact) => (
              <Tag key={contact.id} color="blue" style={{ marginRight: 0 }}>
                {contact.name || contact.id}
              </Tag>
            ))}
          </div>
        )}
      </div>
    </List.Item>
  );
}
