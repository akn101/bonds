import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { Button, Empty, List, Popconfirm, Tag, theme } from "antd";
import { useTranslation } from "react-i18next";
import type { Reminder } from "@/api";
import type { DateFormatVariants } from "@/utils/dateFormat";
import { sourceRecordKey } from "../contactSourceRecord";
import { formatReminderDate } from "./reminderDateDisplay";

const frequencyColors: Readonly<Record<string, string>> = {
  one_time: "blue",
  recurring_week: "green",
  recurring_month: "orange",
  recurring_year: "purple",
};

export type ReminderFrequencyOption = {
  readonly value: string;
  readonly label: string;
};

type ReminderListProps = {
  readonly reminders: Reminder[];
  readonly isLoading: boolean;
  readonly alternativeCalendarEnabled: boolean;
  readonly dateFormats: DateFormatVariants;
  readonly frequencyOptions: readonly ReminderFrequencyOption[];
  readonly onEdit: (reminder: Reminder) => void;
  readonly onDelete: (id: number) => void;
};

export default function ReminderList({
  reminders,
  isLoading,
  alternativeCalendarEnabled,
  dateFormats,
  frequencyOptions,
  onEdit,
  onDelete,
}: ReminderListProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  return (
    <List
      loading={isLoading}
      dataSource={reminders}
      locale={{
        emptyText: <Empty description={t("modules.reminders.no_reminders")} />,
      }}
      split={false}
      renderItem={(reminder: Reminder) => (
        <List.Item
          data-source-record={
            reminder.id
              ? sourceRecordKey("ContactReminder", reminder.id)
              : undefined
          }
          style={{
            borderRadius: token.borderRadius,
            padding: "10px 12px",
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
              onClick={() => onEdit(reminder)}
            />,
            <Popconfirm
              key="delete"
              title={t("modules.reminders.delete_confirm")}
              onConfirm={() => {
                if (reminder.id !== undefined) {
                  onDelete(reminder.id);
                }
              }}
            >
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
              />
            </Popconfirm>,
          ]}
        >
          <List.Item.Meta
            title={<span style={{ fontWeight: 500 }}>{reminder.label}</span>}
            description={
              <>
                <span style={{ color: token.colorTextSecondary }}>
                  {formatReminderDate(reminder, dateFormats)}
                </span>{" "}
                <Tag
                  color={
                    reminder.type
                      ? (frequencyColors[reminder.type] ?? "default")
                      : "default"
                  }
                >
                  {frequencyOptions.find(
                    (option) => option.value === reminder.type,
                  )?.label ?? reminder.type}
                </Tag>
                {alternativeCalendarEnabled &&
                  reminder.calendar_type &&
                  reminder.calendar_type !== "gregorian" && (
                    <Tag color="volcano">{reminder.calendar_type}</Tag>
                  )}
              </>
            }
          />
        </List.Item>
      )}
    />
  );
}
