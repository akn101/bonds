import { useParams, useNavigate } from "react-router-dom";
import { Card, Typography, Button, Space, Tag, theme } from "antd";
import { ArrowLeftOutlined, ShareAltOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { httpClient } from "@/api";
import NetworkGraph from "@/components/NetworkGraph";
import { vaultGraphQueryKey } from "@/components/networkGraphQueryKey";

const { Title, Text } = Typography;

interface VaultGraphSummary {
  nodes?: { id: string }[];
  components?: number;
  isolated_contacts?: number;
  external_relationships?: number;
  truncated?: boolean;
}

export default function VaultGraph() {
  const { id } = useParams<{ id: string }>();
  const vaultId = id!;
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { token } = theme.useToken();

  // Same query key as the canvas below, so the page and the drawing share one
  // request rather than each fetching the vault graph separately.
  const { data: summary } = useQuery({
    queryKey: vaultGraphQueryKey(vaultId),
    queryFn: async () => {
      const res = await httpClient.instance.get<{
        success: boolean;
        data: VaultGraphSummary;
      }>(`/vaults/${vaultId}/relationships/graph`);
      return (res.data?.data ?? res.data) as VaultGraphSummary;
    },
  });

  const drawnContacts = summary?.nodes?.length ?? 0;
  const isolatedContacts = summary?.isolated_contacts ?? 0;
  const externalRelationships = summary?.external_relationships ?? 0;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", paddingBottom: 48 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(`/vaults/${vaultId}`)}
          style={{ color: token.colorTextSecondary }}
        />
        <ShareAltOutlined style={{ fontSize: 20, color: token.colorPrimary }} />
        <Title level={4} style={{ margin: 0 }}>
          {t("vault.graph.title")}
        </Title>
      </div>
      <Text type="secondary" style={{ display: "block", marginBottom: 20 }}>
        {t("vault.graph.description")}
      </Text>

      <Card styles={{ body: { paddingTop: 12 } }}>
        <NetworkGraph
          vaultId={vaultId}
          height={620}
          emptyDescription={t("vault.graph.empty")}
        />

        {/* What is not on the canvas matters as much as what is, so the counts
            that were left out are stated rather than silently dropped. */}
        <Space size={[8, 8]} wrap style={{ marginTop: 4 }}>
          <Tag color="blue">
            {t("vault.graph.drawn", { count: drawnContacts })}
          </Tag>
          {(summary?.components ?? 0) > 1 && (
            <Tag>
              {t("vault.graph.clusters", { count: summary?.components ?? 0 })}
            </Tag>
          )}
          {isolatedContacts > 0 && (
            <Tag>
              {t("vault.graph.isolated", { count: isolatedContacts })}
            </Tag>
          )}
          {externalRelationships > 0 && (
            <Tag>
              {t("vault.graph.external", { count: externalRelationships })}
            </Tag>
          )}
          {summary?.truncated && (
            <Tag color="orange">{t("vault.graph.truncated")}</Tag>
          )}
        </Space>
      </Card>
    </div>
  );
}
