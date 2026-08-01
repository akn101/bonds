import { useMemo, useState } from "react";
import { DeleteOutlined, SearchOutlined } from "@ant-design/icons";
import {
  Button,
  Checkbox,
  Empty,
  Input,
  Popconfirm,
  Space,
  Typography,
  theme,
} from "antd";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ContactAvatar from "@/components/ContactAvatar";

const { Text } = Typography;

export type GroupMemberListItem = {
  readonly id: string;
  readonly name: string;
  readonly firstName?: string;
  readonly lastName?: string;
};

type GroupMemberListProps = {
  readonly vaultId: string;
  readonly members: readonly GroupMemberListItem[];
  readonly selectedIds: ReadonlySet<string>;
  readonly removing: boolean;
  readonly onSelectionChange: (ids: Set<string>) => void;
  readonly onRemove: (ids: readonly string[]) => void;
};

export default function GroupMemberList({
  vaultId,
  members,
  selectedIds,
  removing,
  onSelectionChange,
  onRemove,
}: GroupMemberListProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const [searchTerm, setSearchTerm] = useState("");
  const visibleMembers = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) return members;
    return members.filter((member) =>
      member.name.toLowerCase().includes(normalizedSearch),
    );
  }, [members, searchTerm]);
  const visibleSelectedCount = visibleMembers.filter((member) =>
    selectedIds.has(member.id),
  ).length;
  const allVisibleSelected =
    visibleMembers.length > 0 && visibleSelectedCount === visibleMembers.length;
  const someVisibleSelected =
    visibleSelectedCount > 0 && visibleSelectedCount < visibleMembers.length;

  const toggleVisibleMembers = () => {
    const nextIds = new Set(selectedIds);
    for (const member of visibleMembers) {
      if (allVisibleSelected) nextIds.delete(member.id);
      else nextIds.add(member.id);
    }
    onSelectionChange(nextIds);
  };

  return (
    <Space
      orientation="vertical"
      size={token.paddingSM}
      style={{ width: "100%" }}
    >
      <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
        <Input
          aria-label={t("vault.group_detail.search_members")}
          type="search"
          prefix={<SearchOutlined />}
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder={t("vault.group_detail.search_members")}
          style={{ maxWidth: 320 }}
        />
        <Popconfirm
          title={t("vault.group_detail.remove_selected_confirm", {
            count: selectedIds.size,
          })}
          onConfirm={() => onRemove(Array.from(selectedIds))}
          disabled={selectedIds.size === 0}
        >
          <Button
            danger
            loading={removing}
            disabled={selectedIds.size === 0}
            icon={<DeleteOutlined />}
          >
            {t("vault.group_detail.remove_selected")}
          </Button>
        </Popconfirm>
      </Space>
      <Space wrap>
        <Checkbox
          aria-label={t("vault.group_detail.select_all_visible")}
          checked={allVisibleSelected}
          indeterminate={someVisibleSelected}
          disabled={visibleMembers.length === 0}
          onChange={toggleVisibleMembers}
        >
          {t("vault.group_detail.select_all_visible")}
        </Checkbox>
        <Text type="secondary">
          {t("vault.group_detail.selected_count", { count: selectedIds.size })}
        </Text>
      </Space>
      {visibleMembers.length === 0 ? (
        <Empty
          description={
            members.length === 0
              ? t("vault.group_detail.no_members")
              : t("vault.group_detail.no_matching_members")
          }
          style={{ padding: token.paddingLG }}
        />
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            borderRadius: token.borderRadiusLG,
            overflow: "hidden",
          }}
        >
          {visibleMembers.map((member) => (
            <li
              key={member.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: token.marginSM,
                padding: `${token.paddingXS}px ${token.paddingSM}px`,
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <Checkbox
                aria-label={t("vault.group_detail.select_member", {
                  name: member.name,
                })}
                checked={selectedIds.has(member.id)}
                onChange={(event) => {
                  const nextIds = new Set(selectedIds);
                  if (event.target.checked) nextIds.add(member.id);
                  else nextIds.delete(member.id);
                  onSelectionChange(nextIds);
                }}
              />
              <ContactAvatar
                vaultId={vaultId}
                contactId={member.id}
                firstName={member.firstName}
                lastName={member.lastName}
                size={36}
              />
              <Link
                to={`/vaults/${vaultId}/contacts/${member.id}`}
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: token.colorText,
                  fontWeight: token.fontWeightStrong,
                  overflowWrap: "anywhere",
                }}
              >
                {member.name}
              </Link>
              <Popconfirm
                title={t("vault.group_detail.remove_confirm")}
                onConfirm={() => onRemove([member.id])}
              >
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  loading={removing}
                  aria-label={t("vault.group_detail.remove_member", {
                    name: member.name,
                  })}
                />
              </Popconfirm>
            </li>
          ))}
        </ul>
      )}
    </Space>
  );
}
