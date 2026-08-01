import type { KeyboardEventHandler, ReactNode } from "react";
import { Button, Input, List, Space, theme } from "antd";
import { useTranslation } from "react-i18next";
import type { TaskSaveValues } from "./taskMutationOperation";

type TaskEditorProps = {
  readonly mode: "create" | "update";
  readonly values: TaskSaveValues;
  readonly pending: boolean;
  readonly onChange: (values: TaskSaveValues) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
};

export default function TaskEditor({
  mode,
  values,
  pending,
  onChange,
  onSubmit,
  onCancel,
}: TaskEditorProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const handleLabelKeyDown: KeyboardEventHandler<HTMLInputElement> = (
    event,
  ) => {
    if (mode === "update" && event.key === "Escape") onCancel();
  };
  const fields = (
    <Space direction="vertical" style={{ width: "100%" }} size={8}>
      <Input
        autoFocus
        value={values.label}
        onChange={(event) => onChange({ ...values, label: event.target.value })}
        onPressEnter={onSubmit}
        onKeyDown={handleLabelKeyDown}
        placeholder={t("modules.tasks.new_task_placeholder")}
      />
      <Input.TextArea
        value={values.description}
        onChange={(event) =>
          onChange({ ...values, description: event.target.value })
        }
        placeholder={t("modules.tasks.description_placeholder")}
        autoSize={{ minRows: 2, maxRows: 6 }}
      />
      <Space>
        <Button type="primary" onClick={onSubmit} loading={pending}>
          {mode === "create" ? t("common.add") : t("common.save")}
        </Button>
        <Button
          type={mode === "create" ? "text" : "default"}
          onClick={onCancel}
        >
          {t("common.cancel")}
        </Button>
      </Space>
    </Space>
  );

  switch (mode) {
    case "create":
      return (
        <div
          style={{
            marginBottom: 16,
            padding: 16,
            background: token.colorFillQuaternary,
            borderRadius: token.borderRadius,
          }}
        >
          {fields}
        </div>
      );
    case "update":
      return (
        <List.Item style={{ padding: "8px 12px", display: "block" }}>
          {fields}
        </List.Item>
      );
    default: {
      const exhaustiveMode: never = mode;
      return exhaustiveMode satisfies ReactNode;
    }
  }
}
