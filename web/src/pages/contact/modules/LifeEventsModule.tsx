import { useState, useCallback, useMemo } from "react";
import {
  Card,
  Button,
  Modal,
  Form,
  Input,
  DatePicker,
  Popconfirm,
  App,
  Empty,
  Timeline,
  Typography,
  Collapse,
  Space,
  Tag,
  theme,
  Select,
} from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  StarOutlined,
  StarFilled,
} from "@ant-design/icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import type {
  TimelineEvent as TEvent,
  PaginationMeta,
  APIError,
  LifeEventCategoryResponse,
  UserPreferences,
  Contact,
} from "@/api";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useDateFormat, formatDate, formatMonthYear } from "@/utils/dateFormat";
import { formatContactName, useVaultNameOrder } from "@/utils/nameFormat";
import dayjs from "dayjs";
import CalendarAwareDatePicker from "@/components/CalendarAwareDatePicker";
import { buildCalendarAwareValue } from "@/components/calendarAwareDateValue";
import type { CalendarAwareDateValue } from "@/components/calendarAwareDateValue";
import type { NormalizedFeedSource } from "@/utils/feedSourceLink";
import { invalidateFeedQueries } from "@/utils/queryInvalidation";
import {
  scanTargetRecordPages,
  sourceRecordKey,
  useSourceRecordReveal,
} from "../contactSourceRecord";

const { Text } = Typography;

type TimelineEventsQueryKey = readonly [
  "vaults",
  string | number,
  "contacts",
  string | number,
  "timelineEvents",
];

type TimelineFormValues = {
  readonly label: string;
  readonly started_at: dayjs.Dayjs;
  readonly participants?: string[];
};

type CreateTimelineMutationOperation = {
  readonly vaultId: string;
  readonly contactId: string;
  readonly queryKey: TimelineEventsQueryKey;
  readonly values: TimelineFormValues;
};

type DeleteTimelineMutationOperation = {
  readonly timelineId: number;
  readonly source: {
    readonly vaultId: string;
    readonly contactId: string;
  };
  readonly listQueryKey: TimelineEventsQueryKey;
};

export default function LifeEventsModule({
  vaultId,
  contactId,
  target,
}: {
  vaultId: string | number;
  contactId: string | number;
  target?: Extract<NormalizedFeedSource, { readonly module: "life_events" }>;
}) {
  const [tlOpen, setTlOpen] = useState(false);
  const [leOpen, setLeOpen] = useState(false);
  const [selectedTimeline, setSelectedTimeline] = useState<number | null>(null);
  const [editingLeId, setEditingLeId] = useState<number | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(
    null,
  );
  const [page, setPage] = useState(1);
  const [lastLoadedPage, setLastLoadedPage] = useState(0);
  const [paginatedTimelines, setPaginatedTimelines] = useState<TEvent[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [activeTimelineKeys, setActiveTimelineKeys] = useState<
    (string | number)[]
  >([]);
  const [tlForm] = Form.useForm();
  const [leForm] = Form.useForm();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const dateFormats = useDateFormat();
  const nameOrder = useVaultNameOrder(String(vaultId));
  const qk = [
    "vaults",
    vaultId,
    "contacts",
    contactId,
    "timelineEvents",
  ] as const satisfies TimelineEventsQueryKey;

  const [contactSearch, setContactSearch] = useState("");

  const { data: contactsData = [] } = useQuery({
    queryKey: ["vaults", vaultId, "contacts", "for-le-modal", contactSearch],
    queryFn: async () => {
      const params: Parameters<typeof api.contacts.contactsList>[1] = {
        per_page: 200,
      };
      if (contactSearch.length > 2) {
        params.search = contactSearch;
      }
      const res = await api.contacts.contactsList(String(vaultId), params);
      return (res.data ?? []) as Contact[];
    },
  });

  // Fetch life event categories to get a valid type ID (instead of hardcoded 1)
  const { data: lifeEventCategories = [] } = useQuery({
    queryKey: ["vault", vaultId, "lifeEventCategories"],
    queryFn: async () => {
      const res = await api.vaultSettings.settingsLifeEventCategoriesList(
        String(vaultId),
      );
      return (res.data ?? []) as LifeEventCategoryResponse[];
    },
  });

  const filteredTypes =
    lifeEventCategories.find((c) => c.id === selectedCategoryId)?.types ?? [];

  const resetPagination = useCallback(() => {
    setPage(1);
    setLastLoadedPage(0);
    setPaginatedTimelines([]);
  }, []);

  const {
    data: timelineQueryResult,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: [...qk, page, target?.id],
    queryFn: async () => {
      const res = await api.lifeEvents.contactsTimelineEventsList(
        String(vaultId),
        String(contactId),
        { page, per_page: 15 },
      );
      const newItems: TEvent[] = res.data ?? [];
      const meta = res.meta as PaginationMeta | undefined;
      const initialPage = {
        page: meta?.page ?? page,
        items: newItems,
        totalPages: meta?.total_pages ?? page,
      };

      if (page === 1 && target) {
        // Scan inside one query: effect-driven page increments raced isFetching and could stop after page 1.
        const scan = await scanTargetRecordPages({
          targetId: target.id,
          initialPage,
          loadPage: async (nextPage) => {
            const response = await api.lifeEvents.contactsTimelineEventsList(
              String(vaultId),
              String(contactId),
              {
                page: nextPage,
                per_page: 15,
              },
            );
            return {
              page: nextPage,
              items: response.data ?? [],
              totalPages: response.meta?.total_pages ?? nextPage,
            };
          },
          getRecordId: (timeline: TEvent) => timeline.id,
        });
        return {
          items: [...scan.items],
          lastPage: scan.lastPage,
          totalPages: scan.totalPages,
        };
      }

      setPaginatedTimelines((previousTimelines) =>
        page === 1 ? newItems : [...previousTimelines, ...newItems],
      );
      setLastLoadedPage(initialPage.page);
      setHasMore(initialPage.page < initialPage.totalPages);
      return {
        items: newItems,
        lastPage: initialPage.page,
        totalPages: initialPage.totalPages,
      };
    },
  });
  const allTimelines = useMemo(
    () =>
      target ? (timelineQueryResult?.items ?? []) : paginatedTimelines,
    [paginatedTimelines, target, timelineQueryResult?.items],
  );
  const displayedLastPage = target
    ? (timelineQueryResult?.lastPage ?? 0)
    : lastLoadedPage;
  const displayedHasMore = target
    ? (timelineQueryResult?.lastPage ?? 0) <
      (timelineQueryResult?.totalPages ?? 0)
    : hasMore;
  const targetAvailable =
    target !== undefined &&
    allTimelines.some((timeline) => timeline.id === target.id);
  const displayedTimelineKeys =
    targetAvailable && !activeTimelineKeys.includes(target.id)
      ? [...activeTimelineKeys, target.id]
      : activeTimelineKeys;

  useSourceRecordReveal(target, targetAvailable);

  const getForcedParticipantIds = useCallback(
    (timelineId?: number) => {
      const forced = new Set<string>();
      forced.add(String(contactId));
      if (timelineId !== undefined) {
        const timeline = allTimelines.find(
          (candidate) => candidate.id === timelineId,
        );
        timeline?.participants?.forEach((participant) => {
          if (participant.id) forced.add(String(participant.id));
        });
      }
      return forced;
    },
    [contactId, allTimelines],
  );

  const contactOptions = (() => {
    const forcedIds = getForcedParticipantIds(selectedTimeline ?? undefined);
    const optionsMap = new Map<string, { value: string; label: string }>();

    contactsData.forEach((contact) => {
      if (contact.id && !forcedIds.has(String(contact.id))) {
        optionsMap.set(String(contact.id), {
          value: String(contact.id),
          label: formatContactName(nameOrder, contact),
        });
      }
    });

    if (editingLeId && selectedTimeline) {
      const timeline = allTimelines.find(
        (candidate) => candidate.id === selectedTimeline,
      );
      const lifeEvent = timeline?.life_events?.find(
        (candidate) => candidate.id === editingLeId,
      );
      lifeEvent?.participants?.forEach((participant) => {
        const participantId = participant.id ? String(participant.id) : "";
        if (
          participantId &&
          !forcedIds.has(participantId) &&
          !optionsMap.has(participantId)
        ) {
          optionsMap.set(participantId, {
            value: participantId,
            label: participant.name || participantId,
          });
        }
      });
    }

    return Array.from(optionsMap.values());
  })();

  const createTimelineMutation = useMutation({
    mutationFn: (operation: CreateTimelineMutationOperation) =>
      api.lifeEvents.contactsTimelineEventsCreate(
        operation.vaultId,
        operation.contactId,
        {
          label: operation.values.label,
          started_at: operation.values.started_at.toISOString(),
          participants: operation.values.participants,
        },
      ),
    onSuccess: async (_data, operation) => {
      // Clear accumulated pages before invalidation so the refetch repopulates them instead of being erased afterward.
      resetPagination();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: operation.queryKey }),
        invalidateFeedQueries(queryClient, {
          vaultIds: [operation.vaultId],
          contacts: [
            { vaultId: operation.vaultId, contactId: operation.contactId },
          ],
        }),
      ]);
      setTlOpen(false);
      tlForm.resetFields();
      message.success(t("modules.life_events.timeline_created"));
    },
    onError: (e: APIError) => message.error(e.message),
  });

  const deleteTimelineMutation = useMutation({
    // Freeze route-derived identity at submit time so pending rerenders cannot redirect this operation.
    mutationFn: (operation: DeleteTimelineMutationOperation) =>
      api.lifeEvents.contactsTimelineEventsDelete(
        operation.source.vaultId,
        operation.source.contactId,
        operation.timelineId,
      ),
    onSuccess: async (_data, operation) => {
      resetPagination();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: operation.listQueryKey }),
        invalidateFeedQueries(queryClient, {
          vaultIds: [operation.source.vaultId],
          contacts: [operation.source],
        }),
      ]);
      message.success(t("modules.life_events.timeline_deleted"));
    },
    onError: (e: APIError) => message.error(e.message),
  });

  const { data: prefs } = useQuery({
    queryKey: ["settings", "preferences"],
    queryFn: async () => {
      const res = await api.preferences.preferencesList();
      return res.data as UserPreferences | undefined;
    },
  });
  const altCalendar = prefs?.enable_alternative_calendar ?? false;

  const createLifeEventMutation = useMutation({
    mutationFn: (values: {
      life_event_type_id: number;
      label: string;
      happened_at: CalendarAwareDateValue;
      description?: string;
      participants?: string[];
    }) => {
      if (!selectedTimeline) throw new Error("No timeline");
      const data = {
        summary: values.label,
        happened_at: values.happened_at.date.toISOString(),
        description: values.description,
        life_event_type_id: values.life_event_type_id,
        calendar_type: values.happened_at.calendarType,
        original_day: values.happened_at.originalDay ?? undefined,
        original_month: values.happened_at.originalMonth ?? undefined,
        original_year: values.happened_at.originalYear ?? undefined,
        participants: values.participants,
      };
      if (editingLeId) {
        return api.lifeEvents.contactsTimelineEventsLifeEventsUpdate(
          String(vaultId),
          String(contactId),
          selectedTimeline,
          editingLeId,
          data,
        );
      }
      return api.lifeEvents.contactsTimelineEventsLifeEventsCreate(
        String(vaultId),
        String(contactId),
        selectedTimeline,
        data,
      );
    },
    onSuccess: () => {
      resetPagination();
      queryClient.invalidateQueries({ queryKey: qk });
      setLeOpen(false);
      setEditingLeId(null);
      setSelectedCategoryId(null);
      leForm.resetFields();
      message.success(
        editingLeId
          ? t("modules.life_events.event_updated")
          : t("modules.life_events.event_added"),
      );
    },
    onError: (e: APIError) => message.error(e.message),
  });

  const deleteLifeEventMutation = useMutation({
    mutationFn: ({
      timelineId,
      lifeEventId,
    }: {
      timelineId: number;
      lifeEventId: number;
    }) =>
      api.lifeEvents.contactsTimelineEventsLifeEventsDelete(
        String(vaultId),
        String(contactId),
        timelineId,
        lifeEventId,
      ),
    onSuccess: () => {
      resetPagination();
      queryClient.invalidateQueries({ queryKey: qk });
      message.success(t("modules.life_events.event_deleted"));
    },
    onError: (e: APIError) => message.error(e.message),
  });

  const toggleTimelineMutation = useMutation({
    mutationFn: (timelineId: number) =>
      api.lifeEvents.contactsTimelineEventsToggleUpdate(
        String(vaultId),
        String(contactId),
        timelineId,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk });
      message.success(t("modules.life_events.timeline_toggled"));
    },
    onError: (e: APIError) => message.error(e.message),
  });

  const toggleLifeEventMutation = useMutation({
    mutationFn: ({
      timelineId,
      lifeEventId,
    }: {
      timelineId: number;
      lifeEventId: number;
    }) =>
      api.lifeEvents.contactsTimelineEventsLifeEventsToggleUpdate(
        String(vaultId),
        String(contactId),
        timelineId,
        lifeEventId,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk });
      message.success(t("modules.life_events.event_toggled"));
    },
    onError: (e: APIError) => message.error(e.message),
  });

  if (isLoading && page === 1) return <Card loading />;

  const collapseItems = allTimelines.map((tl: TEvent) => ({
    key: tl.id,
    label: (
      <div
        data-source-record={
          tl.id ? sourceRecordKey("TimelineEvent", tl.id) : undefined
        }
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 500, opacity: tl.collapsed ? 0.5 : 1 }}>
            {tl.label} —{" "}
            <span style={{ color: token.colorTextSecondary, fontWeight: 400 }}>
              {formatMonthYear(tl.started_at, dateFormats)}
            </span>
          </span>
          {tl.participants && tl.participants.length > 0 && (
            <div
              style={{
                display: "flex",
                gap: 4,
                flexWrap: "wrap",
                marginTop: 2,
              }}
            >
              {tl.participants.map((p) => (
                <Link
                  key={p.id}
                  to={`/vaults/${vaultId}/contacts/${p.id}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Tag
                    bordered={false}
                    style={{ margin: 0, fontSize: 12, cursor: "pointer" }}
                  >
                    {p.name}
                  </Tag>
                </Link>
              ))}
            </div>
          )}
        </div>
        <Space>
          <Button
            type="text"
            size="small"
            icon={tl.collapsed ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            style={{
              color: tl.collapsed
                ? token.colorTextDisabled
                : token.colorPrimary,
            }}
            onClick={(e) => {
              e.stopPropagation();
              toggleTimelineMutation.mutate(tl.id!);
            }}
            title={t("modules.life_events.toggle_timeline")}
          />
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            style={{ color: token.colorPrimary }}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedTimeline(tl.id ?? null);
              setEditingLeId(null);
              setSelectedCategoryId(null);
              leForm.resetFields();
              leForm.setFieldsValue({
                happened_at: buildCalendarAwareValue(
                  dayjs(),
                  "gregorian",
                  null,
                  null,
                  null,
                ),
              });
              setLeOpen(true);
            }}
          >
            {t("modules.life_events.event")}
          </Button>
          <Popconfirm
            title={t("modules.life_events.delete_timeline_confirm")}
            onConfirm={(e) => {
              e?.stopPropagation();
              if (tl.id === undefined) return;
              deleteTimelineMutation.mutate({
                timelineId: tl.id,
                source: {
                  vaultId: String(vaultId),
                  contactId: String(contactId),
                },
                listQueryKey: qk,
              });
            }}
            onCancel={(e) => e?.stopPropagation()}
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={(e) => e.stopPropagation()}
            />
          </Popconfirm>
        </Space>
      </div>
    ),
    children: tl.life_events?.length ? (
      <Timeline
        items={tl.life_events.map((le) => ({
          color: token.colorPrimary,
          children: (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <div style={{ opacity: le.collapsed ? 0.5 : 1 }}>
                <strong style={{ fontWeight: 500 }}>
                  {le.summary ?? le.description}
                </strong>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {formatDate(le.happened_at, dateFormats)}
                  {le.calendar_type && le.calendar_type !== "gregorian" && (
                    <Tag style={{ marginLeft: 6 }} color="processing">
                      {t(`calendar.${le.calendar_type}`)}
                    </Tag>
                  )}
                </Text>
                {le.description && (
                  <div
                    style={{ marginTop: 4, color: token.colorTextSecondary }}
                  >
                    {le.description}
                  </div>
                )}
                {le.participants && le.participants.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      gap: 4,
                      flexWrap: "wrap",
                      marginTop: 6,
                    }}
                  >
                    {le.participants.map((p) => (
                      <Link
                        key={p.id}
                        to={`/vaults/${vaultId}/contacts/${p.id}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Tag
                          bordered={false}
                          style={{ margin: 0, fontSize: 12, cursor: "pointer" }}
                        >
                          {p.name}
                        </Tag>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <Button
                  type="text"
                  size="small"
                  icon={
                    le.collapsed ? (
                      <StarFilled style={{ color: token.colorWarning }} />
                    ) : (
                      <StarOutlined />
                    )
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLifeEventMutation.mutate({
                      timelineId: tl.id!,
                      lifeEventId: le.id!,
                    });
                  }}
                  title={t("modules.life_events.toggle_event")}
                />
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTimeline(tl.id ?? null);
                    setEditingLeId(le.id!);

                    const catId = lifeEventCategories.find((c) =>
                      c.types?.some((t) => t.id === le.life_event_type_id),
                    )?.id;
                    setSelectedCategoryId(catId ?? null);

                    leForm.setFieldsValue({
                      category_id: catId,
                      life_event_type_id: le.life_event_type_id,
                      label: le.summary,
                      happened_at: buildCalendarAwareValue(
                        le.happened_at,
                        le.calendar_type,
                        le.original_day,
                        le.original_month,
                        le.original_year,
                      ),
                      description: le.description,
                      participants: (() => {
                        const forcedIds = getForcedParticipantIds(tl.id);
                        return (
                          le.participants?.flatMap((p) => {
                            if (!p.id) return [];
                            const participantId = String(p.id);
                            return forcedIds.has(participantId)
                              ? []
                              : [participantId];
                          }) || []
                        );
                      })(),
                    });
                    setLeOpen(true);
                  }}
                />
                <Popconfirm
                  title={t("modules.life_events.delete_event_confirm")}
                  onConfirm={() =>
                    deleteLifeEventMutation.mutate({
                      timelineId: tl.id!,
                      lifeEventId: le.id!,
                    })
                  }
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                  />
                </Popconfirm>
              </div>
            </div>
          ),
        }))}
      />
    ) : (
      <Empty
        description={t("modules.life_events.no_events")}
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    ),
  }));

  return (
    <Card
      title={
        <span style={{ fontWeight: 500 }}>
          {t("modules.life_events.title")}
        </span>
      }
      styles={{
        header: { borderBottom: `1px solid ${token.colorBorderSecondary}` },
        body: { padding: "16px 24px" },
      }}
      extra={
        <Button
          type="text"
          icon={<PlusOutlined />}
          onClick={() => {
            setSelectedTimeline(null);
            setEditingLeId(null);
            setContactSearch("");
            tlForm.resetFields();
            setTlOpen(true);
          }}
          style={{ color: token.colorPrimary }}
        >
          {t("modules.life_events.new_timeline")}
        </Button>
      }
    >
      {allTimelines.length === 0 ? (
        <Empty description={t("modules.life_events.no_timelines")} />
      ) : (
        <>
          <Collapse
            items={collapseItems}
            activeKey={displayedTimelineKeys}
            onChange={(keys) =>
              setActiveTimelineKeys(Array.isArray(keys) ? keys : [keys])
            }
          />
          {displayedHasMore && allTimelines.length > 0 && (
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <Button
                onClick={() => setPage(displayedLastPage + 1)}
                loading={isFetching}
              >
                {t("common.load_more")}
              </Button>
            </div>
          )}
        </>
      )}

      <Modal
        title={t("modules.life_events.timeline_modal")}
        open={tlOpen}
        onCancel={() => {
          setTlOpen(false);
          tlForm.resetFields();
        }}
        onOk={() => tlForm.submit()}
        confirmLoading={createTimelineMutation.isPending}
      >
        <Form
          form={tlForm}
          layout="vertical"
          onFinish={(values: TimelineFormValues) =>
            createTimelineMutation.mutate({
              vaultId: String(vaultId),
              contactId: String(contactId),
              queryKey: qk,
              values,
            })
          }
        >
          <Form.Item
            name="label"
            label={t("modules.life_events.label")}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="started_at"
            label={t("modules.life_events.started_at")}
            rules={[{ required: true }]}
          >
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="participants"
            label={t("modules.life_events.participants")}
          >
            <Select
              mode="multiple"
              allowClear
              placeholder={t("modules.life_events.participants_placeholder")}
              showSearch
              onSearch={setContactSearch}
              filterOption={false}
              options={contactOptions}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          editingLeId
            ? t("modules.life_events.edit_event")
            : t("modules.life_events.event_modal")
        }
        open={leOpen}
        onCancel={() => {
          setLeOpen(false);
          setEditingLeId(null);
          setSelectedCategoryId(null);
          leForm.resetFields();
        }}
        onOk={() => leForm.submit()}
        confirmLoading={createLifeEventMutation.isPending}
      >
        <Form
          form={leForm}
          layout="vertical"
          onFinish={(v) => createLifeEventMutation.mutate(v)}
        >
          <Form.Item
            name="category_id"
            label={t("vault.dashboard.select_category")}
            rules={[{ required: true, message: t("common.required") }]}
          >
            <Select
              placeholder={t("vault.dashboard.select_category")}
              onChange={(v: number) => {
                setSelectedCategoryId(v);
                leForm.setFieldValue("life_event_type_id", undefined);
              }}
              options={lifeEventCategories.map((c) => ({
                label: c.label,
                value: c.id,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="life_event_type_id"
            label={t("vault.dashboard.select_type")}
            rules={[{ required: true, message: t("common.required") }]}
          >
            <Select
              placeholder={t("vault.dashboard.select_type")}
              disabled={!selectedCategoryId}
              options={filteredTypes.map((tp) => ({
                label: tp.label,
                value: tp.id,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="label"
            label={t("modules.life_events.label")}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="happened_at"
            label={t("modules.life_events.happened_at")}
            rules={[{ required: true }]}
          >
            <CalendarAwareDatePicker enableAlternativeCalendar={altCalendar} />
          </Form.Item>
          <Form.Item name="description" label={t("common.description")}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item
            name="participants"
            label={t("modules.life_events.participants")}
          >
            <Select
              mode="multiple"
              allowClear
              placeholder={t("modules.life_events.participants_placeholder")}
              showSearch
              onSearch={setContactSearch}
              filterOption={false}
              options={contactOptions}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
