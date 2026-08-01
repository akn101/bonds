import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Space,
  Spin,
  Typography,
  theme,
} from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/api";
import type { SearchResult } from "@/api";

const { Text } = Typography;

export type SelectableGroupContact = {
  readonly id: string;
  readonly name: string;
};

type GroupMemberAddPanelProps = {
  readonly vaultId: string;
  readonly groupId: number;
  readonly memberIds: ReadonlySet<string>;
  readonly selectedContacts: readonly SelectableGroupContact[];
  readonly submitting: boolean;
  readonly onSelectionChange: (contacts: SelectableGroupContact[]) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
};

function hasContactIdentity(
  contact: SearchResult,
): contact is SearchResult & { readonly id: string; readonly name: string } {
  return typeof contact.id === "string" && typeof contact.name === "string";
}

export default function GroupMemberAddPanel({
  vaultId,
  groupId,
  memberIds,
  selectedContacts,
  submitting,
  onSelectionChange,
  onSubmit,
  onCancel,
}: GroupMemberAddPanelProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const [searchTerm, setSearchTerm] = useState("");
  const {
    data: searchResults = [],
    isError,
    isFetching,
  } = useQuery({
    queryKey: [
      "vaults",
      vaultId,
      "contacts",
      "selectable-for-group",
      groupId,
      searchTerm,
    ],
    queryFn: async (): Promise<SelectableGroupContact[]> => {
      const response = await api.contacts.contactsSelectableList(vaultId, {
        search: searchTerm,
      });
      return (response.data ?? [])
        .filter((contact: SearchResult) => hasContactIdentity(contact))
        .filter(
          (
            contact: SearchResult & {
              readonly id: string;
              readonly name: string;
            },
          ) => !memberIds.has(contact.id),
        )
        .map(
          (
            contact: SearchResult & {
              readonly id: string;
              readonly name: string;
            },
          ) => ({ id: contact.id, name: contact.name }),
        );
    },
  });
  const selectedContactIds = useMemo(
    () => new Set(selectedContacts.map((contact) => contact.id)),
    [selectedContacts],
  );
  const visibleSelectedCount = searchResults.filter((contact) =>
    selectedContactIds.has(contact.id),
  ).length;
  const allVisibleSelected =
    searchResults.length > 0 && visibleSelectedCount === searchResults.length;
  const someVisibleSelected =
    visibleSelectedCount > 0 && visibleSelectedCount < searchResults.length;

  const toggleVisibleContacts = () => {
    const visibleContactIds = new Set(
      searchResults.map((contact) => contact.id),
    );
    const nextContacts = allVisibleSelected
      ? selectedContacts.filter((contact) => !visibleContactIds.has(contact.id))
      : [
          ...selectedContacts,
          ...searchResults.filter(
            (contact) => !selectedContactIds.has(contact.id),
          ),
        ];
    onSelectionChange(nextContacts);
  };

  const toggleContact = (contact: SelectableGroupContact, checked: boolean) => {
    onSelectionChange(
      checked
        ? [...selectedContacts, contact]
        : selectedContacts.filter(
            (selectedContact) => selectedContact.id !== contact.id,
          ),
    );
  };

  return (
    <section role="region" aria-label={t("vault.group_detail.select_contacts")}>
      <Card
        size="small"
        style={{
          marginBottom: token.margin,
          background: token.colorPrimaryBg,
          borderColor: token.colorPrimaryBorder,
          boxShadow: token.boxShadowTertiary,
        }}
      >
        <Space
          orientation="vertical"
          size={token.paddingSM}
          style={{ width: "100%" }}
        >
          <Input
            aria-label={t("contact.list.search_placeholder")}
            type="search"
            prefix={<SearchOutlined />}
            value={searchTerm}
            disabled={submitting}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder={t("contact.list.search_placeholder")}
          />
          <Space wrap>
            <Checkbox
              aria-label={t("vault.group_detail.select_all_visible")}
              checked={allVisibleSelected}
              indeterminate={someVisibleSelected}
              disabled={
                submitting ||
                isFetching ||
                isError ||
                searchResults.length === 0
              }
              onChange={toggleVisibleContacts}
            >
              {t("vault.group_detail.select_all_visible")}
            </Checkbox>
            <Text type="secondary">
              {t("vault.group_detail.selected_count", {
                count: selectedContacts.length,
              })}
            </Text>
          </Space>
          {isError ? (
            <Alert type="error" showIcon message={t("common.error")} />
          ) : isFetching ? (
            <div
              role="status"
              aria-label={t("common.loading")}
              style={{ padding: token.paddingLG, textAlign: "center" }}
            >
              <Spin />
            </div>
          ) : searchResults.length === 0 ? (
            <Empty
              description={
                searchTerm.trim()
                  ? t("contact.list.no_match")
                  : t("contact.list.no_contacts")
              }
              style={{ padding: token.paddingLG }}
            />
          ) : (
            <ul
              aria-label={t("vault.group_detail.select_contacts")}
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                borderRadius: token.borderRadiusLG,
                overflow: "hidden",
              }}
            >
              {searchResults.map((contact) => (
                <li
                  key={contact.id}
                  style={{
                    padding: `${token.paddingXS}px ${token.paddingSM}px`,
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                  }}
                >
                  <Checkbox
                    aria-label={t("vault.group_detail.select_member", {
                      name: contact.name,
                    })}
                    checked={selectedContactIds.has(contact.id)}
                    disabled={submitting}
                    onChange={(event) =>
                      toggleContact(contact, event.target.checked)
                    }
                    style={{ width: "100%" }}
                  >
                    <Text strong>{contact.name}</Text>
                  </Checkbox>
                </li>
              ))}
            </ul>
          )}
          <Space wrap style={{ justifyContent: "flex-end", width: "100%" }}>
            <Button disabled={submitting} onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button
              type="primary"
              loading={submitting}
              disabled={selectedContacts.length === 0}
              onClick={onSubmit}
            >
              {t("vault.group_detail.add_selected")}
            </Button>
          </Space>
        </Space>
      </Card>
    </section>
  );
}
