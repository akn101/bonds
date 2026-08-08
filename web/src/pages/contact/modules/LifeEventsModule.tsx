import { useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  DatePicker,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Timeline,
  Typography,
} from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";
import { api } from "@/api";
import type {
  APIError,
  Contact,
  LifeEvent,
  LifeEventCategoryResponse,
  PaginationMeta,
} from "@/api";
import ContactMentionEditor from "@/components/journal/ContactMentionEditor";
import ContactMentionText from "@/components/journal/ContactMentionText";
import CalendarDatePicker from "@/components/CalendarDatePicker";
import type { CalendarDatePickerValue } from "@/components/CalendarDatePicker";
import { getCalendarSystem } from "@/utils/calendar";
import { formatDate, formatMonthYear, useDateFormat } from "@/utils/dateFormat";

const { Text } = Typography;

type Precision = "day" | "month" | "year";
type EndStatus = "none" | "known" | "ongoing" | "unknown";
type FormValues = {
  life_event_type_id: number;
  title: string;
  description: string;
  start_calendar: CalendarDatePickerValue;
  end_status: EndStatus;
  end_precision?: Precision;
  end_date?: Dayjs;
  parent_id?: number;
  participant_ids: string[];
  duration_in_minutes?: number;
  place?: string;
};

export default function LifeEventsModule({
  vaultId,
  contactId,
  initiallyOpen = false,
  onModalClose,
}: {
  vaultId: string | number;
  contactId?: string | number;
  initiallyOpen?: boolean;
  onModalClose?: () => void;
  target?: unknown;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const dateFormats = useDateFormat();
  const [form] = Form.useForm<FormValues>();
  const [open, setOpen] = useState(initiallyOpen);
  const [editing, setEditing] = useState<LifeEvent | null>(null);
  const [description, setDescription] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<LifeEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const queryKey = ["vaults", vaultId, "lifeEvents", contactId] as const;

  const { isLoading, isFetching } = useQuery({
    queryKey: [...queryKey, page],
    queryFn: async () => {
      const response = await api.lifeEvents.lifeEventsList(String(vaultId), {
        contact_id: contactId == null ? undefined : String(contactId),
        page,
        per_page: 15,
      });
      const next = response.data ?? [];
      setItems((current) => (page === 1 ? next : [...current, ...next]));
      const meta = response.meta as PaginationMeta | undefined;
      setHasMore((meta?.page ?? page) < (meta?.total_pages ?? page));
      return next;
    },
  });

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["vaults", vaultId, "contacts", "life-event-picker"],
    queryFn: async () => (await api.contacts.contactsList(String(vaultId), { per_page: 9999 })).data ?? [],
  });
  const contactOptions = contacts.map((contact) => ({
    value: String(contact.id),
    label: [contact.first_name, contact.last_name].filter(Boolean).join(" ") || String(contact.id),
  }));

  const { data: categories = [] } = useQuery({
    queryKey: ["vault", vaultId, "lifeEventCategories"],
    queryFn: async () => {
      const response = await api.vaultSettings.settingsLifeEventCategoriesList(
        String(vaultId),
      );
      return (response.data ?? []) as LifeEventCategoryResponse[];
    },
  });

  const typeOptions = useMemo(
    () =>
      categories.map((category) => ({
        label: category.label,
        options: (category.types ?? []).map((type) => ({
          value: type.id,
          label: type.label,
        })),
      })),
    [categories],
  );
  const parentOptions = useMemo(
    () =>
      items
        .filter((item) => !item.parent_id && item.id !== editing?.id)
        .map((item) => ({ value: item.id, label: item.title })),
    [editing?.id, items],
  );

  const resetList = async () => {
    setPage(1);
    setItems([]);
    await queryClient.invalidateQueries({ queryKey });
  };

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const start = values.start_calendar;
      const startPrecision =
        start.datePrecision === "year"
          ? "year"
          : start.datePrecision === "month"
            ? "month"
            : "day";
      const gregorianStart =
        start.year == null
          ? undefined
          : getCalendarSystem(start.calendarType).toGregorian({
              year: start.year,
              month: start.month ?? 1,
              day: start.day ?? 1,
            });
      const payload = {
        primary_contact_id: values.participant_ids[0],
        participant_ids: values.participant_ids.slice(1),
        parent_id: values.parent_id,
        life_event_type_id: values.life_event_type_id,
        title: values.title,
        description,
        start_date: gregorianStart
          ? dayjs(
              `${gregorianStart.year}-${String(gregorianStart.month).padStart(2, "0")}-${String(gregorianStart.day).padStart(2, "0")}`,
            ).toISOString()
          : undefined,
        start_precision: startPrecision as Precision,
        calendar_type: start.calendarType,
        original_day:
          start.calendarType === "gregorian"
            ? undefined
            : (start.day ?? undefined),
        original_month:
          start.calendarType === "gregorian"
            ? undefined
            : (start.month ?? undefined),
        original_year:
          start.calendarType === "gregorian"
            ? undefined
            : (start.year ?? undefined),
        end_status: values.end_status,
        end_date:
          values.end_status === "known"
            ? values.end_date?.toISOString()
            : undefined,
        end_precision:
          values.end_status === "known" ? values.end_precision : undefined,
        duration_in_minutes: values.duration_in_minutes,
        place: values.place,
      };
      return editing?.id
        ? api.lifeEvents.lifeEventsUpdate(String(vaultId), editing.id, payload)
        : api.lifeEvents.lifeEventsCreate(String(vaultId), payload);
    },
    onSuccess: async () => {
      await resetList();
      setOpen(false);
      onModalClose?.();
      setEditing(null);
      setDescription("");
      form.resetFields();
      message.success(t("modules.life_events.saved"));
    },
    onError: (error: APIError) => message.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      api.lifeEvents.lifeEventsDelete(String(vaultId), id),
    onSuccess: async () => {
      await resetList();
      message.success(t("modules.life_events.event_deleted"));
    },
    onError: (error: APIError) => message.error(error.message),
  });

  const startCreate = () => {
    setEditing(null);
    setDescription("");
    form.setFieldsValue({
      start_calendar: {
        calendarType: "gregorian",
        year: dayjs().year(),
        month: dayjs().month() + 1,
        day: dayjs().date(),
        datePrecision: "full",
      },
      end_status: "none",
      participant_ids: contactId == null ? [] : [String(contactId)],
    });
    setOpen(true);
  };
  const startEdit = (event: LifeEvent) => {
    setEditing(event);
    setDescription(event.description ?? "");
    form.setFieldsValue({
      life_event_type_id: event.life_event_type_id,
      title: event.title,
      description: event.description,
      parent_id: event.parent_id,
      start_calendar: {
        calendarType: event.calendar_type === "lunar" ? "lunar" : "gregorian",
        year:
          event.calendar_type !== "gregorian" && event.original_year
            ? event.original_year
            : event.start_date
              ? dayjs(event.start_date).year()
              : null,
        month:
          event.calendar_type !== "gregorian" && event.original_month
            ? event.original_month
            : event.start_date
              ? dayjs(event.start_date).month() + 1
              : null,
        day:
          event.calendar_type !== "gregorian" && event.original_day
            ? event.original_day
            : event.start_date
              ? dayjs(event.start_date).date()
              : null,
        datePrecision:
          event.start_precision === "year"
            ? "year"
            : event.start_precision === "month"
              ? "month"
              : "full",
      },
      end_status: (event.end_status as EndStatus) || "none",
      end_precision: (event.end_precision as Precision) || "day",
      end_date: event.end_date ? dayjs(event.end_date) : undefined,
      participant_ids: (event.participants ?? []).flatMap((contact) => contact.id ? [contact.id] : []),
      duration_in_minutes: event.duration_in_minutes,
      place: event.place,
    });
    setOpen(true);
  };

  const endStatus = Form.useWatch("end_status", form) ?? "none";
  const endPrecision = Form.useWatch("end_precision", form) ?? "day";
  const formatEventTime = (event: LifeEvent) => {
    if (!event.start_date) return t("modules.life_events.date_unknown");
    const start =
      event.start_precision === "year"
        ? dayjs(event.start_date).year().toString()
        : event.start_precision === "month"
          ? formatMonthYear(event.start_date, dateFormats)
          : formatDate(event.start_date, dateFormats);
    if (event.end_status === "ongoing")
      return `${start} – ${t("modules.life_events.present")}`;
    if (event.end_status === "unknown")
      return `${start} – ${t("modules.life_events.end_unknown")}`;
    if (event.end_status !== "known" || !event.end_date) return start;
    const end =
      event.end_precision === "year"
        ? dayjs(event.end_date).year().toString()
        : event.end_precision === "month"
          ? formatMonthYear(event.end_date, dateFormats)
          : formatDate(event.end_date, dateFormats);
    return `${start} – ${end}`;
  };
  const descriptionContacts = (event: LifeEvent) => {
    const byId = new Map(
      [...(event.participants ?? []), ...(event.mentioned_contacts ?? [])].flatMap(
        (contact) => (contact.id ? [[contact.id, contact] as const] : []),
      ),
    );
    return [...byId.values()];
  };

  return (
    <Card
      title={t("modules.life_events.title")}
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={startCreate}>
          {t("modules.life_events.add_event")}
        </Button>
      }
      loading={isLoading && items.length === 0}
    >
      {items.length === 0 ? (
        <Empty description={t("modules.life_events.empty_description")}>
          <Button type="primary" onClick={startCreate}>
            {t("modules.life_events.add_first_event")}
          </Button>
        </Empty>
      ) : (
        <Timeline
          items={items.map((event) => ({
            children: (
              <div>
                <Space
                  style={{ width: "100%", justifyContent: "space-between" }}
                >
                  <div>
                    <Text strong>{event.title}</Text>
                    <Text type="secondary" style={{ display: "block" }}>
                      {formatEventTime(event)}
                    </Text>
                    {event.life_event_type?.label && <Text type="secondary">{event.life_event_type.label}</Text>}
                  </div>
                  <Space size={0}>
                    <Button
                      type="text"
                      icon={<EditOutlined />}
                      onClick={() => startEdit(event)}
                    />
                    <Popconfirm
                      title={t("modules.life_events.delete_event_confirm")}
                      onConfirm={() =>
                        event.id && deleteMutation.mutate(event.id)
                      }
                    >
                      <Button type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                </Space>
                {event.description && (
                  <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
                    <ContactMentionText
                      vaultId={String(vaultId)}
                      contacts={descriptionContacts(event)}
                    >
                      {event.description}
                    </ContactMentionText>
                  </div>
                )}
              </div>
            ),
          }))}
        />
      )}
      {hasMore && (
        <div style={{ textAlign: "center" }}>
          <Button
            loading={isFetching}
            onClick={() => setPage((value) => value + 1)}
          >
            {t("common.load_more")}
          </Button>
        </div>
      )}

      <Modal
        title={
          editing
            ? t("modules.life_events.edit_event")
            : t("modules.life_events.add_event")
        }
        open={open}
        onCancel={() => { setOpen(false); onModalClose?.(); }}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            start_calendar: { calendarType: "gregorian", year: dayjs().year(), month: dayjs().month() + 1, day: dayjs().date(), datePrecision: "full" },
            end_status: "none",
            participant_ids: contactId == null ? [] : [String(contactId)],
          }}
          onFinish={(values) => saveMutation.mutate(values)}
        >
          <Form.Item
            name="life_event_type_id"
            label={t("modules.life_events.type")}
            rules={[{ required: true }]}
          >
            <Select showSearch options={typeOptions} optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="participant_ids" label={t("modules.life_events.participants")} rules={[{ required: true }]}>
            <Select mode="multiple" showSearch options={contactOptions} placeholder={t("modules.life_events.participants_placeholder")} optionFilterProp="label" />
          </Form.Item>
          <Form.Item
            name="title"
            label={t("modules.life_events.label")}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="start_calendar"
            label={t("modules.life_events.happened_at")}
            rules={[{ required: true }]}
          >
            <CalendarDatePicker
              enableAlternativeCalendar
              enableDatePrecision
              allowedDatePrecisions={["full", "month", "year"]}
            />
          </Form.Item>
          <Form.Item name="end_status" label={t("modules.life_events.until")}>
            <Select
              options={(
                ["none", "ongoing", "known", "unknown"] as EndStatus[]
              ).map((value) => ({
                value,
                label: t(`modules.life_events.end_${value}`),
              }))}
            />
          </Form.Item>
          {endStatus === "known" && (
            <Form.Item label={t("modules.life_events.end_date")} required>
              <Space.Compact style={{ width: "100%" }}>
                <Form.Item name="end_precision" noStyle initialValue="day">
                  <Select
                    style={{ width: 110 }}
                    options={(["day", "month", "year"] as Precision[]).map(
                      (value) => ({
                        value,
                        label: t(`modules.life_events.precision_${value}`),
                      }),
                    )}
                  />
                </Form.Item>
                <Form.Item name="end_date" noStyle rules={[{ required: true }]}>
                  <DatePicker
                    picker={endPrecision === "day" ? "date" : endPrecision}
                    style={{ width: "100%" }}
                  />
                </Form.Item>
              </Space.Compact>
            </Form.Item>
          )}
          <Form.Item label={t("modules.life_events.description")}>
            <ContactMentionEditor
              vaultId={String(vaultId)}
              value={description}
              onChange={setDescription}
              ariaLabel={t("modules.life_events.description")}
              placeholder={t("modules.life_events.description_placeholder")}
              rows={4}
              showHint
            />
          </Form.Item>
          <Form.Item name="place" label={t("modules.life_events.place")}><Input /></Form.Item>
          <Form.Item name="duration_in_minutes" label={t("modules.life_events.duration_minutes")}><Input type="number" min={0} /></Form.Item>
          <Form.Item
            name="parent_id"
            label={t("modules.life_events.related_experience")}
          >
            <Select allowClear options={parentOptions} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
