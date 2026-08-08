import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App as AntApp, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import NotesModule from "@/pages/contact/modules/NotesModule";
import TasksModule from "@/pages/contact/modules/TasksModule";
import CallsModule from "@/pages/contact/modules/CallsModule";
import PhotosModule from "@/pages/contact/modules/PhotosModule";
import DocumentsModule from "@/pages/contact/modules/DocumentsModule";
import { api } from "@/api";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = vi.fn();
});

vi.mock("@/api", () => ({
  api: {
    notes: {
      contactsNotesList: vi.fn(),
      contactsNotesCreate: vi.fn(),
      contactsNotesUpdate: vi.fn(),
      contactsNotesDelete: vi.fn(),
    },
    tasks: {
      contactsTasksList: vi.fn(),
      contactsTasksCompletedList: vi.fn(),
      contactsTasksCreate: vi.fn(),
      contactsTasksUpdate: vi.fn(),
      contactsTasksToggleUpdate: vi.fn(),
      contactsTasksDelete: vi.fn(),
    },
    lifeEvents: {},
    calls: {
      contactsCallsList: vi.fn(),
      contactsCallsCreate: vi.fn(),
      contactsCallsUpdate: vi.fn(),
      contactsCallsDelete: vi.fn(),
    },
    contactPhotos: {
      contactsPhotosList: vi.fn(),
      contactsPhotosDelete: vi.fn(),
    },
    contactDocuments: {
      contactsDocumentsList: vi.fn(),
      contactsDocumentsDelete: vi.fn(),
    },
    contacts: { contactsList: vi.fn() },
    vaultSettings: { settingsLifeEventCategoriesList: vi.fn() },
    preferences: { preferencesList: vi.fn() },
  },
}));

function renderModule(module: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConfigProvider>
        <AntApp>
          <MemoryRouter>{module}</MemoryRouter>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>,
  );
}

describe("contact module source targeting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.preferences.preferencesList).mockResolvedValue({
      data: undefined,
    });
    vi.mocked(api.contacts.contactsList).mockResolvedValue({ data: [] });
    vi.mocked(
      api.vaultSettings.settingsLifeEventCategoriesList,
    ).mockResolvedValue({ data: [] });
  });

  it("finds a targeted note on page 2 and switches to that page", async () => {
    vi.mocked(api.notes.contactsNotesList).mockImplementation(
      async (_vaultId, _contactId, params) => {
        if (params?.page === 2) {
          return {
            data: [
              {
                id: 42,
                title: "Target note",
                body: "Found on page two",
                created_at: "2026-01-02T00:00:00Z",
              },
            ],
            meta: { page: 2, per_page: 15, total: 16, total_pages: 2 },
          };
        }
        return {
          data: [
            {
              id: 1,
              title: "First note",
              body: "Page one",
              created_at: "2026-01-01T00:00:00Z",
            },
          ],
          meta: { page: 1, per_page: 15, total: 16, total_pages: 2 },
        };
      },
    );

    renderModule(
      <NotesModule
        vaultId="v1"
        contactId="c1"
        target={{ id: 42, kind: "Note", module: "notes" }}
      />,
    );

    expect(await screen.findByText("Target note")).toBeInTheDocument();
    expect(
      document.querySelector('[data-source-record="Note:42"]'),
    ).toBeInTheDocument();
    expect(api.notes.contactsNotesList).toHaveBeenCalledWith("v1", "c1", {
      page: 2,
      per_page: 15,
    });
  });

  it("stops bounded note lookup after the reported final page", async () => {
    vi.mocked(api.notes.contactsNotesList).mockImplementation(
      async (_vaultId, _contactId, params) => ({
        data: [
          {
            id: params?.page ?? 1,
            title: `Note page ${params?.page ?? 1}`,
            body: "Missing target",
          },
        ],
        meta: {
          page: params?.page ?? 1,
          per_page: 15,
          total: 2,
          total_pages: 2,
        },
      }),
    );

    renderModule(
      <NotesModule
        vaultId="v1"
        contactId="c1"
        target={{ id: 99, kind: "Note", module: "notes" }}
      />,
    );

    await waitFor(() => {
      expect(api.notes.contactsNotesList).toHaveBeenCalledWith("v1", "c1", {
        page: 2,
        per_page: 15,
      });
    });
    expect(api.notes.contactsNotesList).toHaveBeenCalledTimes(2);
    expect(
      document.querySelector('[data-source-record="Note:99"]'),
    ).not.toBeInTheDocument();
  });

  it("loads completed tasks automatically when the target is completed", async () => {
    vi.mocked(api.tasks.contactsTasksList).mockResolvedValue({ data: [] });
    vi.mocked(api.tasks.contactsTasksCompletedList).mockResolvedValue({
      data: [{ id: 7, label: "Completed target", completed: true }],
    });

    renderModule(
      <TasksModule
        vaultId="v1"
        contactId="c1"
        target={{ id: 7, kind: "ContactTask", module: "tasks" }}
      />,
    );

    expect(await screen.findByText("Completed target")).toBeInTheDocument();
    expect(
      document.querySelector('[data-source-record="ContactTask:7"]'),
    ).toBeInTheDocument();
    expect(api.tasks.contactsTasksCompletedList).toHaveBeenCalledTimes(1);
  });

  it("loads call pages sequentially until the target is available", async () => {
    vi.mocked(api.calls.contactsCallsList).mockImplementation(
      async (_vaultId, _contactId, params) => {
        if (params?.page === 2) {
          return {
            data: [
              {
                id: 32,
                type: "outgoing",
                called_at: "2026-03-02T10:00:00Z",
                description: "Target call",
              },
            ],
            meta: { page: 2, per_page: 15, total: 2, total_pages: 2 },
          };
        }
        return {
          data: [
            {
              id: 31,
              type: "incoming",
              called_at: "2026-03-01T10:00:00Z",
              description: "First call",
            },
          ],
          meta: { page: 1, per_page: 15, total: 2, total_pages: 2 },
        };
      },
    );

    renderModule(
      <CallsModule
        vaultId="v1"
        contactId="c1"
        target={{ id: 32, kind: "Call", module: "calls" }}
      />,
    );

    expect(await screen.findByText("Target call")).toBeInTheDocument();
    expect(
      document.querySelector('[data-source-record="Call:32"]'),
    ).toBeInTheDocument();
    expect(api.calls.contactsCallsList).toHaveBeenCalledWith("v1", "c1", {
      page: 2,
      per_page: 15,
    });
  });

  it("switches photos to the page containing a targeted file", async () => {
    vi.mocked(api.contactPhotos.contactsPhotosList).mockImplementation(
      async (_vaultId, _contactId, params) => {
        if (params?.page === 2) {
          return {
            data: [
              {
                id: 52,
                name: "target.jpg",
                mime_type: "image/jpeg",
                size: 1024,
              },
            ],
            meta: { page: 2, per_page: 30, total: 31, total_pages: 2 },
          };
        }
        return {
          data: [
            { id: 51, name: "first.jpg", mime_type: "image/jpeg", size: 1024 },
          ],
          meta: { page: 1, per_page: 30, total: 31, total_pages: 2 },
        };
      },
    );

    renderModule(
      <PhotosModule
        vaultId="v1"
        contactId="c1"
        target={{ id: 52, kind: "File", module: "photos" }}
      />,
    );

    await waitFor(() => {
      expect(
        document.querySelector('[data-source-record="File:52"]'),
      ).toBeInTheDocument();
    });
    expect(api.contactPhotos.contactsPhotosList).toHaveBeenCalledWith(
      "v1",
      "c1",
      { page: 2, per_page: 30 },
    );
  });

  it("switches documents to the page containing a targeted file", async () => {
    vi.mocked(api.contactDocuments.contactsDocumentsList).mockImplementation(
      async (_vaultId, _contactId, params) => {
        if (params?.page === 2) {
          return {
            data: [
              {
                id: 62,
                name: "target.pdf",
                mime_type: "application/pdf",
                size: 2048,
              },
            ],
            meta: { page: 2, per_page: 15, total: 16, total_pages: 2 },
          };
        }
        return {
          data: [
            {
              id: 61,
              name: "first.pdf",
              mime_type: "application/pdf",
              size: 1024,
            },
          ],
          meta: { page: 1, per_page: 15, total: 16, total_pages: 2 },
        };
      },
    );

    renderModule(
      <DocumentsModule
        vaultId="v1"
        contactId="c1"
        target={{ id: 62, kind: "File", module: "documents" }}
      />,
    );

    expect(await screen.findByText("target.pdf")).toBeInTheDocument();
    expect(
      document.querySelector('[data-source-record="File:62"]'),
    ).toBeInTheDocument();
    expect(api.contactDocuments.contactsDocumentsList).toHaveBeenCalledWith(
      "v1",
      "c1",
      { page: 2, per_page: 15 },
    );
  });
});
