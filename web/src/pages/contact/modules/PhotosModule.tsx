import { useRef, useState } from "react";
import {
  Card,
  Upload,
  Image,
  Empty,
  App,
  theme,
  Button,
  Popconfirm,
  Pagination,
} from "antd";
import type { UploadProps } from "antd";
import { InboxOutlined, DeleteOutlined } from "@ant-design/icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { api } from "@/api";
import type { Photo, PaginationMeta, APIError } from "@/api";
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

type PendingPhotoUpload = {
  readonly contactScope: ContactQueryScope;
  readonly listQueryKey: QueryKey;
};

type DeletePhotoOperation = {
  readonly recordId: number;
  readonly source: ContactQueryScope;
  readonly listQueryKey: QueryKey;
};

export default function PhotosModule({
  vaultId,
  contactId,
  target,
}: {
  vaultId: string | number;
  contactId: string | number;
  target?: Extract<NormalizedFeedSource, { readonly module: "photos" }>;
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(30);
  const pendingUploads = useRef(new Map<string, PendingPhotoUpload>());
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const qk = ["vaults", vaultId, "contacts", contactId, "photos"];

  const { data: photosResponse, isLoading } = useQuery({
    queryKey: [...qk, currentPage, pageSize],
    queryFn: async () => {
      const res = await api.contactPhotos.contactsPhotosList(
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
  const mediaItems: Photo[] = photosResponse?.items ?? [];
  const total = photosResponse?.meta?.total ?? mediaItems.length;
  const targetAvailable =
    target !== undefined &&
    mediaItems.some((photo: Photo) => photo.id === target.id);

  useSourceRecordReveal(target, targetAvailable);

  const { data: targetPage } = useQuery({
    queryKey: [...qk, "source-target", target?.id],
    enabled: target !== undefined && photosResponse !== undefined,
    queryFn: async () => {
      if (!target || !photosResponse) return null;
      const targetPage = await findTargetRecordPage({
        targetId: target.id,
        initialPage: {
          page: photosResponse.meta?.page ?? currentPage,
          items: photosResponse.items,
          totalPages: photosResponse.meta?.total_pages ?? currentPage,
        },
        loadPage: async (page) => {
          const response = await api.contactPhotos.contactsPhotosList(
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
        getRecordId: (photo: Photo) => photo.id,
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
    mutationFn: (operation: DeletePhotoOperation) =>
      api.contactPhotos.contactsPhotosDelete(
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
      message.success(t("modules.photos.deleted"));
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
        <span style={{ fontWeight: 500 }}>{t("modules.photos.title")}</span>
      }
      styles={{
        header: { borderBottom: `1px solid ${token.colorBorderSecondary}` },
        body: { padding: "16px 24px" },
      }}
      loading={isLoading}
    >
      <Dragger
        name="file"
        accept="image/*,video/*"
        action={`/api/vaults/${vaultId}/contacts/${contactId}/photos`}
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
            message.success(t("modules.photos.uploaded"));
          } else if (info.file.status === "error") {
            pendingUploads.current.delete(info.file.uid);
            message.error(t("modules.photos.upload_failed"));
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
          {t("modules.photos.upload_text")}
        </p>
      </Dragger>

      {mediaItems.length === 0 ? (
        <Empty description={t("modules.photos.no_photos")} />
      ) : (
        <Image.PreviewGroup>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {mediaItems.map((photo) => (
              <div
                key={photo.id}
                data-source-record={
                  photo.id ? sourceRecordKey("File", photo.id) : undefined
                }
                style={{ position: "relative", display: "inline-block" }}
              >
                {photo.mime_type?.startsWith("video/") ? (
                  <video
                    width={120}
                    height={120}
                    controls
                    preload="metadata"
                    style={{
                      objectFit: "cover",
                      borderRadius: token.borderRadius,
                      background: token.colorFillQuaternary,
                    }}
                  >
                    <source
                      src={`/api/vaults/${vaultId}/files/${photo.id}/download?token=${localStorage.getItem("token")}&preview=true`}
                      type={photo.mime_type}
                    />
                  </video>
                ) : (
                  <Image
                    width={120}
                    height={120}
                    src={`/api/vaults/${vaultId}/files/${photo.id}/download?token=${localStorage.getItem("token")}`}
                    style={{
                      objectFit: "cover",
                      borderRadius: token.borderRadius,
                    }}
                  />
                )}
                <Popconfirm
                  title={t("modules.photos.delete_confirm")}
                  onConfirm={() => {
                    if (photo.id === undefined) return;
                    deleteMutation.mutate({
                      recordId: photo.id,
                      source: {
                        vaultId: String(vaultId),
                        contactId: String(contactId),
                      },
                      listQueryKey: qk,
                    });
                  }}
                  okText={t("common.delete")}
                  cancelText={t("common.cancel")}
                >
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    size="small"
                    style={{
                      position: "absolute",
                      top: 4,
                      right: 4,
                      background: "rgba(255, 255, 255, 0.8)",
                      borderRadius: "50%",
                    }}
                  />
                </Popconfirm>
              </div>
            ))}
          </div>
        </Image.PreviewGroup>
      )}
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
