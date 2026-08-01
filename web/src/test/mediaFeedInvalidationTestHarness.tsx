import { useState } from "react";
import type { ReactNode } from "react";
import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, expect, vi } from "vitest";
import type { UploadFile, UploadProps } from "antd";
import { App as AntApp, ConfigProvider } from "antd";
import DocumentsModule from "@/pages/contact/modules/DocumentsModule";
import PhotosModule from "@/pages/contact/modules/PhotosModule";

const mediaApiMocks = vi.hoisted(() => ({
  contactDocuments: {
    contactsDocumentsDelete: vi.fn(),
    contactsDocumentsList: vi.fn(),
  },
  contactPhotos: {
    contactsPhotosDelete: vi.fn(),
    contactsPhotosList: vi.fn(),
  },
}));

const mediaMessageMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  const react = await vi.importActual<typeof import("react")>("react");

  function Dragger({ beforeUpload, children, onChange }: UploadProps) {
    const [file] = useState(() =>
      Object.assign(new File(["content"], "contact-file.bin"), {
        lastModifiedDate: new Date(),
        uid: "contact-file-upload",
      }),
    );

    function finishUpload() {
      const completedFile: UploadFile = {
        uid: file.uid,
        name: file.name,
        status: "done",
      };
      const uploadChange: Parameters<NonNullable<UploadProps["onChange"]>>[0] =
        {
          file: completedFile,
          fileList: [completedFile],
        };
      onChange?.(uploadChange);
    }

    return react.createElement(
      "div",
      null,
      children,
      react.createElement(
        "button",
        {
          onClick: () => {
            void beforeUpload?.(file, [file]);
          },
          type: "button",
        },
        "Start upload",
      ),
      react.createElement(
        "button",
        { onClick: finishUpload, type: "button" },
        "Finish upload",
      ),
    );
  }

  const Upload = Object.assign(
    (props: UploadProps) => react.createElement(actual.Upload, props),
    actual.Upload,
    { Dragger },
  );

  return {
    ...actual,
    App: Object.assign(actual.App, {
      useApp: () => ({ message: mediaMessageMocks }),
    }),
    Upload,
  };
});

vi.mock("@/api", () => ({
  api: mediaApiMocks,
}));

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

type ContactScope = {
  readonly vaultId: string;
  readonly contactId: string;
};

function createInvalidationSpy(queryClient: QueryClient) {
  return vi
    .spyOn(queryClient, "invalidateQueries")
    .mockResolvedValue(undefined);
}

export type InvalidateQueriesSpy = ReturnType<typeof createInvalidationSpy>;

export type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
};

export function createDeferred<T>(): Deferred<T> {
  let resolveDeferred: Deferred<T>["resolve"] = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolveDeferred = resolve;
  });
  return { promise, resolve: resolveDeferred };
}

export function getMediaApiMocks() {
  return mediaApiMocks;
}

export function getMediaMessageMocks() {
  return mediaMessageMocks;
}

function renderScopedModule(
  createModule: (scope: ContactScope) => ReactNode,
  initialScope: ContactScope = { vaultId: "vault-1", contactId: "contact-1" },
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const invalidateQueries = createInvalidationSpy(queryClient);
  const wrap = (scope: ContactScope) => (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <AntApp>
          <MemoryRouter>{createModule(scope)}</MemoryRouter>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
  const rendered = render(wrap(initialScope));

  return {
    invalidateQueries,
    queryClient,
    rerenderScope: (scope: ContactScope) => rendered.rerender(wrap(scope)),
  };
}

export function renderPhotosModule() {
  return renderScopedModule(({ vaultId, contactId }) => (
    <PhotosModule vaultId={vaultId} contactId={contactId} />
  ));
}

export function renderDocumentsModule() {
  return renderScopedModule(({ vaultId, contactId }) => (
    <DocumentsModule vaultId={vaultId} contactId={contactId} />
  ));
}

export function invalidatedKeys(
  invalidateQueries: InvalidateQueriesSpy,
): readonly unknown[] {
  return invalidateQueries.mock.calls.flatMap(([filters]) =>
    filters === undefined ? [] : [filters.queryKey],
  );
}

export async function confirmVisibleDelete(): Promise<void> {
  const deleteButton =
    document.querySelector<HTMLButtonElement>(".ant-btn-dangerous");
  if (deleteButton === null) {
    throw new Error("expected a media delete button");
  }
  await userEvent.click(deleteButton);
  await waitFor(() => {
    expect(
      document.querySelector(".ant-popconfirm-buttons .ant-btn-primary"),
    ).toBeInTheDocument();
  });
  const confirmButton = document.querySelector<HTMLButtonElement>(
    ".ant-popconfirm-buttons .ant-btn-primary",
  );
  if (confirmButton === null) {
    throw new Error("expected a media delete confirmation button");
  }
  await userEvent.click(confirmButton);
}

export function setupContactMediaMocks(): void {
  vi.clearAllMocks();
  mediaApiMocks.contactDocuments.contactsDocumentsList.mockResolvedValue({
    data: [],
    meta: { page: 1, per_page: 15, total: 0, total_pages: 1 },
  });
  mediaApiMocks.contactDocuments.contactsDocumentsDelete.mockResolvedValue(
    undefined,
  );
  mediaApiMocks.contactPhotos.contactsPhotosList.mockResolvedValue({
    data: [],
    meta: { page: 1, per_page: 30, total: 0, total_pages: 1 },
  });
  mediaApiMocks.contactPhotos.contactsPhotosDelete.mockResolvedValue(undefined);
}
