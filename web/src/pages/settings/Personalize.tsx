import { useState, useMemo } from "react";
import {
  Card,
  Typography,
  Button,
  List,
  Collapse,
  Input,
  Space,
  Popconfirm,
  App,
  Empty,
  Badge,
  theme,
  Select,
  Switch,
  Modal,
} from "antd";
import { PlusOutlined, DeleteOutlined, EditOutlined, RightOutlined, DownOutlined, ArrowUpOutlined, ArrowDownOutlined, SyncOutlined } from "@ant-design/icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/api";
import type { PersonalizeItem, APIError, Currency } from "@/api";
import { SUPPORTED_LANGUAGES } from "@/i18n";

const { Title, Text } = Typography;

const sectionKeys = [
  "genders", "pronouns", "address-types", "pet-categories",
  "contact-info-types", "relationship-types",
  "currencies", "religions", "call-reasons",
  "gift-occasions", "gift-states", "post-templates", "group-types",
  "task-statuses",
];

const sectionI18nMap: Record<string, string> = {
  "genders": "settings.personalize.genders",
  "pronouns": "settings.personalize.pronouns",
  "address-types": "settings.personalize.address_types",
  "pet-categories": "settings.personalize.pet_categories",
  "contact-info-types": "settings.personalize.contact_info_types",
  "relationship-types": "settings.personalize.relationship_types",
  "currencies": "settings.personalize.currencies",
  "religions": "settings.personalize.religions",
  "call-reasons": "settings.personalize.call_reasons",
  "activity-categories": "settings.personalize.activity_categories",
  "gift-occasions": "settings.personalize.gift_occasions",
  "gift-states": "settings.personalize.gift_states",
  "post-templates": "settings.personalize.post_templates",
  "group-types": "settings.personalize.group_types",
  "task-statuses": "settings.personalize.task_statuses",
};

const sortableTopLevelSections = new Set([
  "religions",
  "gift-occasions",
  "gift-states",
  "group-types",
  "post-templates",
  "task-statuses",
]);

interface SubItemConfig {
  labelKey: string;
  addKey: string;
  fields: Array<{ key: string; placeholder: string; optional?: boolean }>;
  list: (parentId: number) => Promise<{ data?: Array<Record<string, unknown>> }>;
  create: (parentId: number, body: Record<string, string>) => Promise<unknown>;
  update: (parentId: number, itemId: number, body: Record<string, string>) => Promise<unknown>;
  remove: (parentId: number, itemId: number) => Promise<unknown>;
  position?: (parentId: number, itemId: number, position: number) => Promise<unknown>;
}

const subItemConfigs: Record<string, SubItemConfig> = {
  "post-templates": {
    labelKey: "settings.personalize.sections",
    addKey: "settings.personalize.add_section",
    fields: [{ key: "label", placeholder: "common.label" }],
    list: (id) => api.postTemplateSections.personalizePostTemplatesSectionsList(id),
    create: (id, b) => api.postTemplateSections.personalizePostTemplatesSectionsCreate(id, { label: b.label }),
    update: (id, itemId, b) => api.postTemplateSections.personalizePostTemplatesSectionsUpdate(id, itemId, { label: b.label }),
    remove: (id, itemId) => api.postTemplateSections.personalizePostTemplatesSectionsDelete(id, itemId),
    position: (id, itemId, pos) => api.postTemplateSections.personalizePostTemplatesSectionsPositionCreate(id, itemId, { position: pos }),
  },
  "group-types": {
    labelKey: "settings.personalize.roles",
    addKey: "settings.personalize.add_role",
    fields: [{ key: "label", placeholder: "common.label" }],
    list: (id) => api.groupTypeRoles.personalizeGroupTypesRolesList(id),
    create: (id, b) => api.groupTypeRoles.personalizeGroupTypesRolesCreate(id, { label: b.label }),
    update: (id, itemId, b) => api.groupTypeRoles.personalizeGroupTypesRolesUpdate(id, itemId, { label: b.label }),
    remove: (id, itemId) => api.groupTypeRoles.personalizeGroupTypesRolesDelete(id, itemId),
    position: (id, itemId, pos) => api.groupTypeRoles.personalizeGroupTypesRolesPositionCreate(id, itemId, { position: pos }),
  },
  "call-reasons": {
    labelKey: "settings.personalize.reasons",
    addKey: "settings.personalize.add_reason",
    fields: [{ key: "label", placeholder: "common.label" }],
    list: (id) => api.callReasons.personalizeCallReasonsReasonsList(id),
    create: (id, b) => api.callReasons.personalizeCallReasonsReasonsCreate(id, { label: b.label }),
    update: (id, itemId, b) => api.callReasons.personalizeCallReasonsReasonsUpdate(id, itemId, { label: b.label }),
    remove: (id, itemId) => api.callReasons.personalizeCallReasonsReasonsDelete(id, itemId),
  },
  "relationship-types": {
    labelKey: "settings.personalize.types",
    addKey: "settings.personalize.add_type",
    fields: [
      { key: "name", placeholder: "common.name" },
      { key: "name_reverse_relationship", placeholder: "settings.personalize.name_reverse" },
      { key: "degree", placeholder: "settings.personalize.degree_placeholder", optional: true },
    ],
    list: (id) => api.relationshipTypes.personalizeRelationshipTypesTypesList(id),
    create: (id, b) => api.relationshipTypes.personalizeRelationshipTypesTypesCreate(id, { name: b.name, name_reverse_relationship: b.name_reverse_relationship, degree: b.degree ? Number(b.degree) : undefined }),
    update: (id, itemId, b) => api.relationshipTypes.personalizeRelationshipTypesTypesUpdate(id, itemId, { name: b.name, name_reverse_relationship: b.name_reverse_relationship, degree: b.degree ? Number(b.degree) : undefined }),
    remove: (id, itemId) => api.relationshipTypes.personalizeRelationshipTypesTypesDelete(id, itemId),
  },
};

function SubItemsPanel({ parentId, sectionKey }: { parentId: number; sectionKey: string }) {
  const config = subItemConfigs[sectionKey];
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { t } = useTranslation();
  const qk = ["settings", "personalize", sectionKey, "sub-items", parentId];

  const { data: items = [], isLoading } = useQuery({
    queryKey: qk,
    queryFn: async () => {
      const res = await config.list(parentId);
      return (res.data ?? []) as Array<Record<string, unknown>>;
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (editingId) {
        return config.update(parentId, editingId, formValues);
      }
      return config.create(parentId, formValues);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk });
      resetForm();
    },
    onError: (e: APIError) => message.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: number) => config.remove(parentId, itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk }),
    onError: (e: APIError) => message.error(e.message),
  });

  const subPositionMutation = useMutation({
    mutationFn: ({ itemId, position }: { itemId: number; position: number }) => {
      if (!config.position) throw new Error("No position API");
      return config.position(parentId, itemId, position);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk }),
    onError: (e: APIError) => message.error(e.message),
  });
  function resetForm() {
    setAdding(false);
    setEditingId(null);
    setFormValues({});
  }

  function startEdit(item: Record<string, unknown>) {
    setEditingId((item.id as number) ?? null);
    const vals: Record<string, string> = {};
    for (const f of config.fields) {
      vals[f.key] = String(item[f.key] ?? "");
    }
    setFormValues(vals);
    setAdding(false);
  }

  function updateField(key: string, value: string) {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  }

  const hasValues = config.fields.filter((f) => !f.optional).every((f) => (formValues[f.key] ?? "").trim());
  const showForm = adding || editingId !== null;
  const hasPosition = !!config.position;

  function getDisplayLabel(item: Record<string, unknown>): string {
    const primary = String(item[config.fields[0].key] ?? item.label ?? "");
    if (sectionKey === "relationship-types" && item.name_reverse_relationship) {
      const degree = item.degree ? ` (${item.degree})` : "";
      return `${primary} ↔ ${item.name_reverse_relationship}${degree}`;
    }
    return primary;
  }

  return (
    <div style={{ paddingLeft: 16, paddingTop: 8, paddingBottom: 4, borderLeft: "2px solid #f0f0f0" }}>
      <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: "block" }}>
        {t(config.labelKey)}
      </Text>

      {!showForm && (
        <Button
          type="dashed"
          size="small"
          icon={<PlusOutlined />}
          onClick={() => setAdding(true)}
          style={{ marginBottom: 8 }}
          block
        >
          {t(config.addKey)}
        </Button>
      )}

      {showForm && (
        <div style={{ marginBottom: 8 }}>
          <Space.Compact style={{ width: "100%" }}>
            {config.fields.map((f) => (
              <Input
                key={f.key}
                size="small"
                placeholder={t(f.placeholder)}
                value={formValues[f.key] ?? ""}
                onChange={(e) => updateField(f.key, e.target.value)}
                onPressEnter={() => hasValues && saveMutation.mutate()}
              />
            ))}
            <Button
              type="primary"
              size="small"
              onClick={() => hasValues && saveMutation.mutate()}
              loading={saveMutation.isPending}
            >
              {editingId ? t("common.update") : t("common.add")}
            </Button>
          </Space.Compact>
          <Button type="text" size="small" onClick={resetForm} style={{ marginTop: 2 }}>
            {t("common.cancel")}
          </Button>
        </div>
      )}

      <List
        loading={isLoading}
        dataSource={items}
        locale={{ emptyText: <Empty description={t("settings.personalize.no_items")} image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        size="small"
        renderItem={(item: Record<string, unknown>, index: number) => (
          <div>
            <List.Item
              style={{ padding: "4px 0" }}
              actions={[
                ...(hasPosition ? [
                  <Button
                    key="up"
                    type="text"
                    size="small"
                    icon={<ArrowUpOutlined />}
                    title={t("settings.personalize.move_up")}
                    disabled={index === 0}
                    onClick={() => subPositionMutation.mutate({ itemId: item.id as number, position: index - 1 })}
                  />,
                  <Button
                    key="down"
                    type="text"
                    size="small"
                    icon={<ArrowDownOutlined />}
                    title={t("settings.personalize.move_down")}
                    disabled={index === items.length - 1}
                    onClick={() => subPositionMutation.mutate({ itemId: item.id as number, position: index + 1 })}
                  />,
                ] : []),
                <Button key="e" type="text" size="small" icon={<EditOutlined />} onClick={() => startEdit(item)} />,
                <Popconfirm key="d" title={t("settings.personalize.delete_confirm")} onConfirm={() => deleteMutation.mutate(item.id as number)}>
                  <Button
                    type="text"
                    size="small"
                    danger
                    disabled={item.can_be_deleted === false}
                    icon={<DeleteOutlined />}
                  />
                </Popconfirm>,
              ]}
            >
              <span style={{ fontSize: 13 }}>{getDisplayLabel(item)}</span>
            </List.Item>
          </div>
        )}
      />
    </div>
  );
}

function CurrenciesPanel() {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { t } = useTranslation();

  const allQk = ["settings", "currencies", "all"];
  const activeQk = ["settings", "personalize", "currencies"];

  const { data: allCurrencies = [], isLoading: loadingAll } = useQuery({
    queryKey: allQk,
    queryFn: async () => {
      const res = await api.currencies.currenciesList();
      return (res.data ?? []) as Currency[];
    },
  });

  const { data: activeCurrencies = [] } = useQuery({
    queryKey: activeQk,
    queryFn: async () => {
      const res = await api.personalize.personalizeDetail("currencies");
      return (res.data ?? []) as PersonalizeItem[];
    },
  });

  const activeIds = useMemo(
    () => new Set(activeCurrencies.map((c) => c.id)),
    [activeCurrencies],
  );

  const filtered = useMemo(
    () =>
      search.trim()
        ? allCurrencies.filter((c) =>
            (c.code ?? "").toLowerCase().includes(search.trim().toLowerCase()),
          )
        : allCurrencies,
    [allCurrencies, search],
  );

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: allQk });
    queryClient.invalidateQueries({ queryKey: activeQk });
  };

  const toggleMutation = useMutation({
    mutationFn: (currencyId: number) =>
      api.personalize.personalizeCurrenciesToggleUpdate(currencyId),
    onSuccess: () => {
      invalidateAll();
      message.success(t("settings.personalize.currency_toggled"));
    },
    onError: (e: APIError) => message.error(e.message),
  });

  const enableAllMutation = useMutation({
    mutationFn: () => api.personalize.personalizeCurrenciesEnableAllCreate(),
    onSuccess: () => {
      invalidateAll();
      message.success(t("settings.personalize.all_enabled"));
    },
    onError: (e: APIError) => message.error(e.message),
  });

  const disableAllMutation = useMutation({
    mutationFn: () => api.personalize.personalizeCurrenciesDisableAllDelete(),
    onSuccess: () => {
      invalidateAll();
      message.success(t("settings.personalize.all_disabled"));
    },
    onError: (e: APIError) => message.error(e.message),
  });

  return (
    <div>
      <Space style={{ width: "100%", marginBottom: 12 }} direction="vertical" size={8}>
        <Input.Search
          placeholder={t("settings.personalize.search_currencies")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        <Space>
          <Button
            size="small"
            onClick={() => enableAllMutation.mutate()}
            loading={enableAllMutation.isPending}
          >
            {t("settings.personalize.enable_all")}
          </Button>
          <Button
            size="small"
            danger
            onClick={() => disableAllMutation.mutate()}
            loading={disableAllMutation.isPending}
          >
            {t("settings.personalize.disable_all")}
          </Button>
        </Space>
      </Space>

      <List
        loading={loadingAll}
        dataSource={filtered}
        locale={{
          emptyText: (
            <Empty
              description={t("settings.personalize.no_items")}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ),
        }}
        size="small"
        renderItem={(item: Currency) => (
          <List.Item
            style={{ padding: "6px 0" }}
            actions={[
              <Switch
                key="toggle"
                size="small"
                checked={activeIds.has(item.id)}
                loading={toggleMutation.isPending}
                onChange={() => item.id != null && toggleMutation.mutate(item.id)}
              />,
            ]}
          >
            <span style={{ fontSize: 13, fontWeight: 500 }}>{item.code}</span>
          </List.Item>
        )}
      />
    </div>
  );
}

function SectionPanel({ sectionKey }: { sectionKey: string }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { t } = useTranslation();
  const qk = ["settings", "personalize", sectionKey];
  const hasSubItems = sectionKey in subItemConfigs;

  const isTopLevelSortable = sortableTopLevelSections.has(sectionKey);

  const { data: items = [], isLoading } = useQuery({
    queryKey: qk,
    queryFn: async () => {
      const res = await api.personalize.personalizeDetail(sectionKey);
      return res.data ?? [];
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (editingId) {
        return api.personalize.personalizeUpdate(sectionKey, editingId, { label });
      }
      return api.personalize.personalizeCreate(sectionKey, { label });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk });
      resetForm();
    },
    onError: (e: APIError) => message.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.personalize.personalizeDelete(sectionKey, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk }),
    onError: (e: APIError) => message.error(e.message),
  });

  const positionMutation = useMutation({
    mutationFn: ({ id, position }: { id: number; position: number }) =>
      api.personalize.personalizePositionCreate(sectionKey, id, { position }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk }),
    onError: (e: APIError) => message.error(e.message),
  });

  function resetForm() {
    setAdding(false);
    setEditingId(null);
    setLabel("");
  }

  function startEdit(item: PersonalizeItem) {
    setEditingId(item.id ?? null);
    setLabel(item.label ?? '');
    setAdding(false);
  }

  function toggleExpand(id: number) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  const showForm = adding || editingId !== null;

  return (
    <div>
      {!showForm && (
        <Button
          type="dashed"
          icon={<PlusOutlined />}
          onClick={() => setAdding(true)}
          style={{ marginBottom: 12 }}
          block
        >
          {t("settings.personalize.add_item")}
        </Button>
      )}

      {showForm && (
        <div style={{ marginBottom: 12 }}>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              placeholder={t("common.label")}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onPressEnter={() => label.trim() && saveMutation.mutate()}
            />
            <Button
              type="primary"
              onClick={() => label.trim() && saveMutation.mutate()}
              loading={saveMutation.isPending}
            >
              {editingId ? t("common.update") : t("common.add")}
            </Button>
          </Space.Compact>
          <Button type="text" size="small" onClick={resetForm} style={{ marginTop: 4 }}>
            {t("common.cancel")}
          </Button>
        </div>
      )}

      <List
        loading={isLoading}
        dataSource={items}
        locale={{ emptyText: <Empty description={t("settings.personalize.no_items")} image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        size="small"
        renderItem={(item: PersonalizeItem, index: number) => (
          <div>
            <List.Item
              actions={[
                ...(isTopLevelSortable ? [
                  <Button
                    key="up"
                    type="text"
                    size="small"
                    icon={<ArrowUpOutlined />}
                    title={t("settings.personalize.move_up")}
                    disabled={index === 0}
                    onClick={() => positionMutation.mutate({ id: item.id!, position: index - 1 })}
                  />,
                  <Button
                    key="down"
                    type="text"
                    size="small"
                    icon={<ArrowDownOutlined />}
                    title={t("settings.personalize.move_down")}
                    disabled={index === items.length - 1}
                    onClick={() => positionMutation.mutate({ id: item.id!, position: index + 1 })}
                  />
                ] : []),
                <Button key="e" type="text" size="small" icon={<EditOutlined />} onClick={() => startEdit(item)} />,
                <Popconfirm key="d" title={t("settings.personalize.delete_confirm")} onConfirm={() => deleteMutation.mutate(item.id!)}>
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>,
              ]}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {hasSubItems && (
                  <Button
                    type="text"
                    size="small"
                    icon={expandedId === item.id ? <DownOutlined /> : <RightOutlined />}
                    onClick={() => toggleExpand(item.id!)}
                    style={{ padding: 0, width: 20, height: 20, minWidth: 20 }}
                  />
                )}
                {item.label}
              </span>
            </List.Item>
            {hasSubItems && expandedId === item.id && (
              <SubItemsPanel parentId={item.id!} sectionKey={sectionKey} />
            )}
          </div>
        )}
      />
    </div>
  );
}

function SectionCollapseLabel({
  sectionKey,
  label,
}: {
  sectionKey: string;
  label: string;
}) {
  const { token } = theme.useToken();
  const { data: items = [] } = useQuery({
    queryKey: ["settings", "personalize", sectionKey],
    queryFn: async () => {
      const res = await api.personalize.personalizeDetail(sectionKey);
      return res.data ?? [];
    },
  });

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontWeight: 500 }}>{label}</span>
      <Badge
        count={items.length}
        showZero
        color={token.colorBorderSecondary}
        style={{ color: token.colorTextTertiary, fontSize: 11 }}
      />
    </span>
  );
}

export default function Personalize() {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [syncOpen, setSyncOpen] = useState(false);
  const [sharedLocale, setSharedLocale] = useState<
    (typeof SUPPORTED_LANGUAGES)[number]["code"]
  >("en");

  const syncMutation = useMutation({
    mutationFn: () =>
      api.personalize.personalizeSyncCreate({ locale: sharedLocale }),
    onSuccess: () => {
      setSyncOpen(false);
      message.success(t("settings.personalize.sync_success"));
      queryClient.invalidateQueries({ queryKey: ["settings", "personalize"] });
    },
    onError: (e: APIError) => message.error(e.message),
  });

  const collapseItems = sectionKeys.map((key) => ({
    key,
    label: (
      <SectionCollapseLabel
        sectionKey={key}
        label={t(sectionI18nMap[key])}
      />
    ),
    children: key === "currencies" ? <CurrenciesPanel /> : <SectionPanel sectionKey={key} />,
  }));

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <Title level={4} style={{ marginBottom: 4 }}>
            {t("settings.personalize.title")}
          </Title>
          <Text type="secondary" style={{ display: "block" }}>
            {t("settings.personalize.description")}
          </Text>
        </div>
        <Button
          icon={<SyncOutlined />}
          loading={syncMutation.isPending}
          onClick={() => setSyncOpen(true)}
        >
          {t("settings.personalize.sync_translations")}
        </Button>
      </div>

      <Card
        styles={{
          body: { padding: 0 },
        }}
      >
        <Collapse
          items={collapseItems}
          bordered={false}
          style={{ background: token.colorBgContainer }}
        />
      </Card>
      <Modal
        title={t("settings.personalize.sync_translations")}
        open={syncOpen}
        onCancel={() => setSyncOpen(false)}
        onOk={() => syncMutation.mutate()}
        confirmLoading={syncMutation.isPending}
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          {t("settings.personalize.sync_confirm")}
        </Text>
        <Select
          style={{ width: "100%" }}
          value={sharedLocale}
          onChange={setSharedLocale}
          options={SUPPORTED_LANGUAGES.map((language) => ({
            value: language.code,
            label: language.label,
          }))}
        />
      </Modal>
    </div>
  );
}
