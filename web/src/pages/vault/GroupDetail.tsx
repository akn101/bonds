import { useMemo, useState } from "react";
import {
  ArrowLeftOutlined,
  PlusOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { App, Button, Card, Spin, Typography, theme } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "@/api";
import type { APIError, GroupContact } from "@/api";
import GroupMemberAddPanel from "@/components/groups/GroupMemberAddPanel";
import type { SelectableGroupContact } from "@/components/groups/GroupMemberAddPanel";
import GroupMemberList from "@/components/groups/GroupMemberList";
import type { GroupMemberListItem } from "@/components/groups/GroupMemberList";
import { getGroupMemberFeedbackKey } from "@/components/groups/groupMemberFeedback";
import { formatContactName, useNameOrder } from "@/utils/nameFormat";

const { Title } = Typography;

function hasGroupMemberId(
  member: GroupContact,
): member is GroupContact & { readonly id: string } {
  return typeof member.id === "string";
}

export default function GroupDetail() {
  const { id: vaultId, groupId } = useParams<{
    id: string;
    groupId: string;
  }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const nameOrder = useNameOrder();
  const [adding, setAdding] = useState(false);
  const [contactsToAdd, setContactsToAdd] = useState<SelectableGroupContact[]>(
    [],
  );
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(
    new Set(),
  );
  const numericGroupId = Number(groupId);
  const hasRouteIdentity =
    typeof vaultId === "string" &&
    typeof groupId === "string" &&
    Number.isInteger(numericGroupId);

  const { data: group, isLoading } = useQuery({
    queryKey: ["vaults", vaultId, "groups", groupId],
    queryFn: async () => {
      if (!vaultId || !Number.isInteger(numericGroupId)) return null;
      const response = await api.groups.groupsDetail(vaultId, numericGroupId);
      return response.data ?? null;
    },
    enabled: hasRouteIdentity,
  });
  const members = useMemo<GroupMemberListItem[]>(
    () =>
      (group?.contacts ?? [])
        .filter((member: GroupContact) => hasGroupMemberId(member))
        .map((member: GroupContact & { readonly id: string }) => {
          const backendName = member.name?.trim();
          return {
            id: member.id,
            name: backendName || formatContactName(nameOrder, member),
            firstName: member.first_name,
            lastName: member.last_name,
          };
        }),
    [group?.contacts, nameOrder],
  );
  const memberIds = useMemo(
    () => new Set(members.map((member) => member.id)),
    [members],
  );

  const invalidateGroupQueries = async () => {
    if (!vaultId || !groupId) return;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["vaults", vaultId, "groups", groupId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["vaults", vaultId, "groups"],
      }),
    ]);
  };

  const addMutation = useMutation({
    mutationFn: (contactIds: readonly string[]) => {
      if (!vaultId || !Number.isInteger(numericGroupId)) {
        return Promise.reject(new Error("Missing group route identity"));
      }
      return api.groups.groupsMembersCreate(vaultId, numericGroupId, {
        contact_ids: [...contactIds],
      });
    },
    onSuccess: async (response, contactIds) => {
      const affectedCount = response.data?.affected_count ?? contactIds.length;
      await invalidateGroupQueries();
      setContactsToAdd([]);
      setAdding(false);
      message.success(
        t(getGroupMemberFeedbackKey("added", affectedCount), {
          count: affectedCount,
        }),
      );
    },
    onError: (error: APIError) => {
      message.error(error.message || t("common.error"));
    },
  });
  const removeMutation = useMutation({
    mutationFn: (contactIds: readonly string[]) => {
      if (!vaultId || !Number.isInteger(numericGroupId)) {
        return Promise.reject(new Error("Missing group route identity"));
      }
      return api.groups.groupsMembersDelete(vaultId, numericGroupId, {
        contact_ids: [...contactIds],
      });
    },
    onSuccess: async (response, contactIds) => {
      const affectedCount = response.data?.affected_count ?? contactIds.length;
      await invalidateGroupQueries();
      setSelectedMemberIds((currentIds) => {
        const remainingIds = new Set(currentIds);
        for (const contactId of contactIds) remainingIds.delete(contactId);
        return remainingIds;
      });
      message.success(
        t(getGroupMemberFeedbackKey("removed", affectedCount), {
          count: affectedCount,
        }),
      );
    },
    onError: (error: APIError) => {
      message.error(error.message || t("common.error"));
    },
  });
  const updateMutation = useMutation({
    mutationFn: (name: string) => {
      if (!vaultId || !Number.isInteger(numericGroupId)) {
        return Promise.reject(new Error("Missing group route identity"));
      }
      return api.groups.groupsUpdate(vaultId, numericGroupId, { name });
    },
    onSuccess: async () => {
      await invalidateGroupQueries();
      message.success(t("vault.group_detail.name_updated"));
    },
    onError: (error: APIError) => {
      message.error(error.message || t("common.error"));
    },
  });

  if (isLoading) {
    return (
      <div style={{ padding: token.paddingXL, textAlign: "center" }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!group || !vaultId) return null;

  return (
    <div style={{ maxWidth: 840, margin: "0 auto" }}>
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: token.marginSM,
          marginBottom: token.marginLG,
        }}
      >
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          aria-label={t("vault.group_detail.back")}
          onClick={() => navigate(`/vaults/${vaultId}/groups`)}
          style={{ color: token.colorTextSecondary }}
        />
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: token.borderRadiusLG,
            background: token.colorPrimaryBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <TeamOutlined
            style={{ fontSize: token.fontSizeLG, color: token.colorPrimary }}
          />
        </div>
        <Title
          level={4}
          style={{ margin: 0, flex: 1, minWidth: 0 }}
          editable={{
            onChange: (value) => {
              const name = value.trim();
              if (name) updateMutation.mutate(name);
            },
            triggerType: ["text"],
            tooltip: t("vault.group_detail.edit_name"),
          }}
        >
          {group.name}
        </Title>
        {!adding && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setAdding(true)}
          >
            {t("vault.group_detail.add_members")}
          </Button>
        )}
      </header>

      {adding && (
        <GroupMemberAddPanel
          vaultId={vaultId}
          groupId={numericGroupId}
          memberIds={memberIds}
          selectedContacts={contactsToAdd}
          submitting={addMutation.isPending}
          onSelectionChange={setContactsToAdd}
          onSubmit={() =>
            addMutation.mutate(contactsToAdd.map((contact) => contact.id))
          }
          onCancel={() => {
            setContactsToAdd([]);
            setAdding(false);
          }}
        />
      )}

      <Card
        title={t("vault.group_detail.members")}
        styles={{ body: { padding: token.paddingSM } }}
      >
        <GroupMemberList
          vaultId={vaultId}
          members={members}
          selectedIds={selectedMemberIds}
          removing={removeMutation.isPending}
          onSelectionChange={setSelectedMemberIds}
          onRemove={(ids) => removeMutation.mutate(ids)}
        />
      </Card>
    </div>
  );
}
