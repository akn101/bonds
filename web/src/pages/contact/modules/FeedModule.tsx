import { useState, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import { List, Typography, Tag, Empty, theme, Card, Spin, Button } from "antd";
import { HistoryOutlined, ClockCircleOutlined } from "@ant-design/icons";
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

interface FeedModuleProps {
  vaultId: string;
  contactId: string;
}

export default function FeedModule({ vaultId, contactId }: FeedModuleProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const location = useLocation();
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
    queryKey: [...queryKeyPrefixes.feed.contact({ vaultId, contactId }), page],
    queryFn: async () => {
      const res = await api.feed.contactsFeedList(
        String(vaultId),
        String(contactId),
        { page, per_page: 15 },
      );
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
  });

  const handleLoadMore = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  if (isLoading && page === 1) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <Spin />
      </div>
    );
  }

  return (
    <Card
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <HistoryOutlined style={{ color: token.colorPrimary }} />
          <Title level={5} style={{ margin: 0 }}>
            {t("contact.detail.feed.title")}
          </Title>
        </div>
      }
    >
      <List
        dataSource={allItems}
        locale={{
          emptyText: (
            <Empty description={t("contact.detail.feed.no_activity")} />
          ),
        }}
        renderItem={(item: FeedItem, index: number) => {
          const contactPath = item.contact_id
            ? `/vaults/${vaultId}/contacts/${item.contact_id}`
            : null;
          const sourcePath = item.contact_id
            ? buildContactSourcePath(vaultId, item.contact_id, item.source)
            : null;
          const sourceLink =
            item.contact_linkable === true &&
            contactPath !== null &&
            sourcePath !== contactPath
              ? sourcePath
              : null;
          const detailState = {
            activityReturnTo: `${location.pathname}${location.search}`,
          };
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
            <Text style={{ display: "block", marginTop: 4 }}>
              {item.description}
            </Text>
          ) : null;

          return (
            <List.Item
              style={{
                paddingLeft: 20,
                borderLeft: `2px solid ${index === 0 ? token.colorPrimary : token.colorBorderSecondary}`,
                position: "relative",
                paddingBottom: 24,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: -5,
                  top: 22,
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
                      <Link to={sourceLink} state={detailState}>
                        {actionTag}
                      </Link>
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
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 4 }}
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
                  </div>
                }
                description={
                  description &&
                  (sourceLink ? (
                    <Link to={sourceLink} state={detailState}>
                      {description}
                    </Link>
                  ) : (
                    description
                  ))
                }
              />
            </List.Item>
          );
        }}
      />
      {hasMore && allItems.length > 0 && (
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <Button onClick={handleLoadMore} loading={isFetching}>
            {t("common.load_more")}
          </Button>
        </div>
      )}
    </Card>
  );
}
