import { useState, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Typography, Button, List, Tag, Spin, Empty, theme } from "antd";
import {
  ArrowLeftOutlined,
  HistoryOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import type { FeedItem, PaginationMeta } from "@/api";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { buildContactSourcePath } from "@/utils/feedSourceLink";
import { queryKeyPrefixes } from "@/utils/queryInvalidation";

dayjs.extend(relativeTime);

const { Title, Text } = Typography;

export default function VaultFeed() {
  const { id } = useParams<{ id: string }>();
  const vaultId = id ?? "";
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const [page, setPage] = useState(1);
  const [allItems, setAllItems] = useState<FeedItem[]>([]);
  const [hasMore, setHasMore] = useState(true);

  function getActionColor(action: string): string {
    if (action.includes("created")) return "green";
    if (action.includes("updated")) return "blue";
    if (action.includes("deleted")) return "red";
    return "default";
  }

  const { isLoading, isFetching } = useQuery({
    queryKey: [...queryKeyPrefixes.feed.vault(vaultId), page],
    queryFn: async () => {
      const res = await api.feed.feedList(String(vaultId), {
        page,
        per_page: 15,
      });
      const newItems = (res.data ?? []) as FeedItem[];
      const meta = res.meta as PaginationMeta | undefined;
      setAllItems((prev) => (page === 1 ? newItems : [...prev, ...newItems]));
      setHasMore(
        meta
          ? (meta.page ?? page) < (meta.total_pages ?? 1)
          : newItems.length >= 15,
      );
      return newItems;
    },
    enabled: !!vaultId,
  });

  const handleLoadMore = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  if (isLoading && page === 1) {
    return (
      <div style={{ textAlign: "center", padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 24,
        }}
      >
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(`/vaults/${vaultId}`)}
          style={{ color: token.colorTextSecondary }}
        />
        <HistoryOutlined style={{ fontSize: 20, color: token.colorPrimary }} />
        <Title level={4} style={{ margin: 0 }}>
          {t("vault.feed.title")}
        </Title>
      </div>

      <div
        style={{
          background: token.colorBgContainer,
          borderRadius: token.borderRadiusLG,
          boxShadow: token.boxShadowTertiary,
          padding: "8px 0",
        }}
      >
        <List
          dataSource={allItems}
          locale={{
            emptyText: (
              <Empty
                description={t("vault.feed.no_activity")}
                style={{ padding: 32 }}
              />
            ),
          }}
          renderItem={(item: FeedItem, index: number) => {
            const contactPath = item.contact_id
              ? `/vaults/${vaultId}/contacts/${item.contact_id}`
              : null;
            const sourcePath = contactPath
              ? buildContactSourcePath(
                  vaultId,
                  item.contact_id ?? "",
                  item.source,
                )
              : null;
            const sourceLink =
              item.contact_linkable === true &&
              contactPath !== null &&
              sourcePath !== contactPath
                ? sourcePath
                : null;
            const contactLabel = item.contact_name || item.contact_id;
            const actionTag = (
              <Tag
                color={getActionColor(item.action ?? "")}
                style={{ borderRadius: 12, fontSize: 11, margin: 0 }}
              >
                {item.action}
              </Tag>
            );
            const description = item.description ? (
              <Text type="secondary" style={{ display: "block", marginTop: 4 }}>
                {item.description}
              </Text>
            ) : null;

            return (
              <List.Item
                style={{
                  margin: "0 16px",
                  paddingLeft: 20,
                  borderLeft: `2px solid ${index === 0 ? token.colorPrimary : token.colorBorderSecondary}`,
                  position: "relative",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: -5,
                    top: 18,
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background:
                      index === 0 ? token.colorPrimary : token.colorBorder,
                  }}
                />
                <List.Item.Meta
                  title={
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      {sourceLink ? (
                        <Link to={sourceLink}>{actionTag}</Link>
                      ) : (
                        actionTag
                      )}
                      {contactLabel &&
                        (item.contact_linkable === true && contactPath ? (
                          <Link to={contactPath} style={{ fontWeight: 600 }}>
                            {contactLabel}
                          </Link>
                        ) : (
                          <Text strong>{contactLabel}</Text>
                        ))}
                    </div>
                  }
                  description={
                    <>
                      {description &&
                        (sourceLink ? (
                          <Link to={sourceLink}>{description}</Link>
                        ) : (
                          description
                        ))}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          marginTop: 6,
                        }}
                      >
                        <ClockCircleOutlined
                          style={{
                            fontSize: 11,
                            color: token.colorTextQuaternary,
                          }}
                        />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {dayjs(item.created_at).fromNow()}
                        </Text>
                      </div>
                    </>
                  }
                />
              </List.Item>
            );
          }}
        />
        {hasMore && allItems.length > 0 && (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <Button onClick={handleLoadMore} loading={isFetching}>
              {t("common.load_more")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
