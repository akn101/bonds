import { useRef, useState } from "react";
import {
  Card,
  List,
  Upload,
  Button,
  App,
  Empty,
  Tag,
  theme,
  Popconfirm,
  Pagination,
} from "antd";
import type { UploadProps } from "antd";
import {
  InboxOutlined,
  FileOutlined,
  DownloadOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { api } from "@/api";
import type { Document, PaginationMeta, APIError } from "@/api";
import { useTranslation } from "react-i18next";
import type { NormalizedFeedSource } from "@/utils/feedSourceLink";
import {
  invalidateFeedQueries,
  type ContactQueryScope,
} from "@/utils/queryInvalidation";
import {
  findTargetRecordPage,
  sourceRecordKey,
  useSourceRecordReveal,
  useTargetRecordPageSelection,
} from "../contactSourceRecord";

const { Dragger } = Upload;

type PendingDocumentUpload = {
  readonly contactScope: ContactQueryScope;
  readonly listQueryKey: QueryKey;
};

type DeleteDocumentOperation = {
  readonly recordId: number;
  readonly source: ContactQueryScope;
  readonly listQueryKey: QueryKey;
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsModule({
  vaultId,
  contactId,
  target,
}: {
  vaultId: string | number;
  contactId: string | number;
  target?: Extract<NormalizedFeedSource, { readonly module: "documents" }>;
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(15);
  const pendingUploads = useRef(new Map<string, PendingDocumentUpload>());
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const qk = ["vaults", vaultId, "contacts", contactId, "documents"];

  const { data: documentsResponse, isLoading } = useQuery({
    queryKey: [...qk, currentPage, pageSize],
    queryFn: async () => {
      const res = await api.contactDocuments.contactsDocumentsList(
        String(vaultId),
        String(contactId),
        { page: currentPage, per_page: pageSize },
      );
      return {
        items: res.data ?? [],
        meta: res.meta as PaginationMeta | undefined,
      };
    },
  });
  const documents: Document[] = documentsResponse?.items ?? [];
  const total = documentsResponse?.meta?.total ?? documents.length;
  const targetAvailable =
    target !== undefined &&
    documents.some((document: Document) => document.id === target.id);

  useSourceRecordReveal(target, targetAvailable);

  const { data: targetPage } = useQuery({
    queryKey: [...qk, "source-target", target?.id],
    enabled: target !== undefined && documentsResponse !== undefined,
    queryFn: async () => {
      if (!target || !documentsResponse) return null;
      const targetPage = await findTargetRecordPage({
        targetId: target.id,
        initialPage: {
          page: documentsResponse.meta?.page ?? currentPage,
          items: documentsResponse.items,
          totalPages: documentsResponse.meta?.total_pages ?? currentPage,
        },
        loadPage: async (page) => {
          const response = await api.contactDocuments.contactsDocumentsList(
            String(vaultId),
            String(contactId),
            {
              page,
              per_page: pageSize,
            },
          );
          return {
            page,
            items: response.data ?? [],
            totalPages: response.meta?.total_pages ?? page,
          };
        },
        getRecordId: (document: Document) => document.id,
      });
      return targetPage?.page ?? null;
    },
  });
  useTargetRecordPageSelection(
    target ? sourceRecordKey(target.kind, target.id) : null,
    targetPage,
    setCurrentPage,
  );

  // Mutation variables retain the clicked file route because props may change before deletion completes.
  const deleteMutation = useMutation({
    mutationFn: (operation: DeleteDocumentOperation) =>
      api.contactDocuments.contactsDocumentsDelete(
        operation.source.vaultId,
        operation.source.contactId,
        operation.recordId,
      ),
    onSuccess: async (_data, operation) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: operation.listQueryKey }),
        invalidateFeedQueries(queryClient, {
          vaultIds: [operation.source.vaultId],
          contacts: [operation.source],
        }),
      ]);
      message.success(t("modules.documents.deleted"));
    },
    onError: (e: APIError) => message.error(e.message),
  });

  const beforeUpload: UploadProps["beforeUpload"] = (file) => {
    // Upload completion may arrive after navigation, so retain the initiating contact scope per file.
    pendingUploads.current.set(file.uid, {
      contactScope: {
        vaultId: String(vaultId),
        contactId: String(contactId),
      },
      listQueryKey: qk,
    });
    return true;
  };

  return (
    <Card
      title={
        <span style={{ fontWeight: 500 }}>{t("modules.documents.title")}</span>
      }
      styles={{
        header: { borderBottom: `1px solid ${token.colorBorderSecondary}` },
        body: { padding: "16px 24px" },
      }}
      loading={isLoading}
    >
      <Dragger
        name="file"
        action={`/api/vaults/${vaultId}/contacts/${contactId}/documents`}
        beforeUpload={beforeUpload}
        headers={{
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        }}
        onChange={async (info) => {
          if (info.file.status === "done") {
            const pendingUpload = pendingUploads.current.get(info.file.uid);
            if (pendingUpload === undefined) return;
            pendingUploads.current.delete(info.file.uid);
            setCurrentPage(1);
            await Promise.all([
              queryClient.invalidateQueries({
                queryKey: pendingUpload.listQueryKey,
              }),
              invalidateFeedQueries(queryClient, {
                vaultIds: [pendingUpload.contactScope.vaultId],
                contacts: [pendingUpload.contactScope],
              }),
            ]);
            message.success(t("modules.documents.uploaded"));
          } else if (info.file.status === "error") {
            pendingUploads.current.delete(info.file.uid);
            message.error(t("modules.documents.upload_failed"));
          }
        }}
        showUploadList={false}
        style={{
          marginBottom: 16,
          borderRadius: token.borderRadius,
          border: `1px dashed ${token.colorBorderSecondary}`,
          background: token.colorFillQuaternary,
        }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined style={{ color: token.colorPrimary }} />
        </p>
        <p
          className="ant-upload-text"
          style={{ color: token.colorTextSecondary }}
        >
          {t("modules.documents.upload_text")}
        </p>
      </Dragger>

      <List
        dataSource={documents as Document[]}
        locale={{
          emptyText: (
            <Empty description={t("modules.documents.no_documents")} />
          ),
        }}
        split={false}
        renderItem={(doc: Document) => (
          <List.Item
            data-source-record={
              doc.id ? sourceRecordKey("File", doc.id) : undefined
            }
            style={{
              borderRadius: token.borderRadius,
              padding: "10px 12px",
              marginBottom: 4,
              transition: "background 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = token.colorFillQuaternary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
            actions={[
              <Button
                key="dl"
                type="text"
                size="small"
                icon={<DownloadOutlined />}
                href={`/api/vaults/${vaultId}/files/${doc.id}/download?token=${localStorage.getItem("token")}`}
                target="_blank"
              />,
              <Popconfirm
                key="del"
                title={t("modules.documents.delete_confirm")}
                onConfirm={() => {
                  if (doc.id === undefined) return;
                  deleteMutation.mutate({
                    recordId: doc.id,
                    source: {
                      vaultId: String(vaultId),
                      contactId: String(contactId),
                    },
                    listQueryKey: qk,
                  });
                }}
              >
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                />
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              avatar={
                <FileOutlined
                  style={{ fontSize: 18, color: token.colorPrimary }}
                />
              }
              title={<span style={{ fontWeight: 500 }}>{doc.name}</span>}
              description={
                <span style={{ color: token.colorTextSecondary }}>
                  <Tag>{doc.mime_type}</Tag> {formatSize(doc.size!)}
                </span>
              }
            />
          </List.Item>
        )}
      />
      <Pagination
        current={currentPage}
        pageSize={pageSize}
        total={total}
        onChange={(page) => setCurrentPage(page)}
        size="small"
        style={{ marginTop: 12, textAlign: "center" }}
        hideOnSinglePage
      />
    </Card>
  );
}
