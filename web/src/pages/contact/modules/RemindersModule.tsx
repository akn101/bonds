import { useState } from "react";
import { Card, Button, Modal, Form, Input, Select, theme } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import type { Reminder, UserPreferences } from "@/api";
import { useTranslation } from "react-i18next";
import CalendarDatePicker from "@/components/CalendarDatePicker";
import type { CalendarDatePickerValue } from "@/components/CalendarDatePicker";
import type { CalendarType } from "@/utils/calendar";
import { useDateFormat } from "@/utils/dateFormat";
import type { NormalizedFeedSource } from "@/utils/feedSourceLink";
import {
  queryKeyPrefixes,
  type ContactQueryScope,
  type QueryInvalidationScopes,
} from "@/utils/queryInvalidation";
import { useSourceRecordReveal } from "../contactSourceRecord";
import { createContactSaveMutationOperation } from "./contactSaveMutationOperation";
import ReminderList from "./ReminderList";
import {
  useReminderMutations,
  type ReminderSaveFormValues,
} from "./useReminderMutations";

const CONTACT_REMINDER_ALLOWED_DATE_PRECISIONS = ["full", "month_day"] as const;

export default function RemindersModule({
  vaultId,
  contactId,
  target,
}: {
  vaultId: string | number;
  contactId: string | number;
  target?: Extract<NormalizedFeedSource, { readonly module: "reminders" }>;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form] = Form.useForm<ReminderSaveFormValues>();
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const dateFormats = useDateFormat();
  const scope = {
    vaultId: String(vaultId),
    contactId: String(contactId),
  } as const satisfies ContactQueryScope;
  const affectedScopes = {
    vaultIds: [scope.vaultId],
    contacts: [scope],
  } as const satisfies QueryInvalidationScopes;
  const qk = queryKeyPrefixes.reminder.contact(scope);

  const { data: prefs } = useQuery({
    queryKey: ["settings", "preferences"],
    queryFn: async () => {
      const res = await api.preferences.preferencesList();
      return res.data as UserPreferences | undefined;
    },
  });
  const altCalendar = prefs?.enable_alternative_calendar ?? false;

  const frequencyOptions = [
    { value: "one_time", label: t("modules.reminders.freq_one_time") },
    { value: "recurring_week", label: t("modules.reminders.freq_weekly") },
    { value: "recurring_month", label: t("modules.reminders.freq_monthly") },
    { value: "recurring_year", label: t("modules.reminders.freq_yearly") },
  ];

  const { data: reminders = [], isLoading } = useQuery({
    queryKey: qk,
    queryFn: async (): Promise<Reminder[]> => {
      const res = await api.reminders.contactsRemindersList(
        String(vaultId),
        String(contactId),
      );
      return res.data ?? [];
    },
  });
  const targetAvailable =
    target !== undefined &&
    reminders.some((reminder: Reminder) => reminder.id === target.id);

  useSourceRecordReveal(target, targetAvailable);

  function openEdit(r: Reminder) {
    setEditingId(r.id ?? null);
    const ct = (r.calendar_type || "gregorian") as CalendarType;
    const pickerVal: CalendarDatePickerValue =
      ct !== "gregorian" && r.original_day != null && r.original_month != null
        ? {
            calendarType: ct,
            day: r.original_day,
            month: r.original_month,
            year: r.original_year ?? null,
            datePrecision: r.original_year == null ? "month_day" : "full",
          }
        : {
            calendarType: "gregorian",
            day: r.day ?? 1,
            month: r.month ?? 1,
            year: r.year ?? null,
            datePrecision: r.year == null ? "month_day" : "full",
          };
    form.setFieldsValue({
      label: r.label,
      calendarDate: pickerVal,
      frequency: r.type,
    });
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    setEditingId(null);
    form.resetFields();
  }

  const { saveMutation, deleteMutation } = useReminderMutations({
    closeSaveForm: closeModal,
  });

  return (
    <Card
      title={
        <span style={{ fontWeight: 500 }}>{t("modules.reminders.title")}</span>
      }
      styles={{
        header: { borderBottom: `1px solid ${token.colorBorderSecondary}` },
        body: { padding: "16px 24px" },
      }}
      extra={
        <Button
          type="text"
          icon={<PlusOutlined />}
          onClick={() => setOpen(true)}
          style={{ color: token.colorPrimary }}
        >
          {t("modules.reminders.add")}
        </Button>
      }
    >
      <ReminderList
        reminders={reminders}
        isLoading={isLoading}
        alternativeCalendarEnabled={altCalendar}
        dateFormats={dateFormats}
        frequencyOptions={frequencyOptions}
        onEdit={openEdit}
        onDelete={(id) => {
          deleteMutation.mutate({
            kind: "delete",
            source: scope,
            listQueryKey: qk,
            affectedScopes,
            id,
          });
        }}
      />

      <Modal
        title={
          editingId
            ? t("modules.reminders.modal_edit")
            : t("modules.reminders.modal_add")
        }
        open={open}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => {
            saveMutation.mutate({
              ...createContactSaveMutationOperation(editingId, values),
              source: scope,
              listQueryKey: qk,
              affectedScopes,
            });
          }}
        >
          <Form.Item
            name="label"
            label={t("modules.reminders.label")}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="calendarDate"
            label={t("modules.reminders.date")}
            rules={[{ required: true }]}
          >
            <CalendarDatePicker
              enableAlternativeCalendar={altCalendar}
              enableDatePrecision
              allowedDatePrecisions={CONTACT_REMINDER_ALLOWED_DATE_PRECISIONS}
            />
          </Form.Item>
          <Form.Item
            name="frequency"
            label={t("modules.reminders.frequency")}
            rules={[{ required: true }]}
          >
            <Select options={frequencyOptions} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
