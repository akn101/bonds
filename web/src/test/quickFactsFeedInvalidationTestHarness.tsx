import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, expect, vi } from "vitest";
import { App as AntApp, ConfigProvider } from "antd";
import QuickFactsModule from "@/pages/contact/modules/QuickFactsModule";

const quickFactsApiMocks = vi.hoisted(() => ({
  preferences: { preferencesList: vi.fn() },
  quickFacts: {
    contactsQuickFactsCreate: vi.fn(),
    contactsQuickFactsDelete: vi.fn(),
    contactsQuickFactsFileCreate: vi.fn(),
    contactsQuickFactsFileUpdate: vi.fn(),
    contactsQuickFactsList: vi.fn(),
    contactsQuickFactsToggleUpdate: vi.fn(),
    contactsQuickFactsUpdate: vi.fn(),
  },
}));

vi.mock("@/api", () => ({
  api: quickFactsApiMocks,
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

function createInvalidationSpy(queryClient: QueryClient) {
  return vi
    .spyOn(queryClient, "invalidateQueries")
    .mockResolvedValue(undefined);
}

export type InvalidateQueriesSpy = ReturnType<typeof createInvalidationSpy>;

export function getQuickFactsApiMocks() {
  return quickFactsApiMocks;
}

export function renderQuickFacts(
  scope: ContactScope = { vaultId: "vault-1", contactId: "contact-1" },
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const invalidateQueries = createInvalidationSpy(queryClient);
  const wrap = (nextScope: ContactScope): ReactNode => (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <AntApp>
          <MemoryRouter>
            <QuickFactsModule
              vaultId={nextScope.vaultId}
              contactId={nextScope.contactId}
            />
          </MemoryRouter>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
  const rendered = render(wrap(scope));

  return {
    invalidateQueries,
    queryClient,
    rerenderScope: (nextScope: ContactScope) =>
      rendered.rerender(wrap(nextScope)),
  };
}

export function invalidatedKeys(
  invalidateQueries: InvalidateQueriesSpy,
): readonly unknown[] {
  return invalidateQueries.mock.calls.flatMap(([filters]) =>
    filters === undefined ? [] : [filters.queryKey],
  );
}

export async function uploadQuickFactFile(file: File): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) {
    throw new Error("expected a quick fact file input");
  }
  await userEvent.upload(input, file);
}

export async function confirmQuickFactDelete(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "delete" }));
  await waitFor(() => {
    expect(
      document.querySelector(".ant-popconfirm-buttons .ant-btn-primary"),
    ).toBeInTheDocument();
  });
  const confirmButton = document.querySelector<HTMLButtonElement>(
    ".ant-popconfirm-buttons .ant-btn-primary",
  );
  if (confirmButton === null) {
    throw new Error("expected a quick fact delete confirmation button");
  }
  await userEvent.click(confirmButton);
}

export const emptyTextGroup = [
  {
    template_id: 1,
    template_label: "Favorite food",
    field_type: "text",
    facts: [],
  },
];

export const textGroup = [
  {
    template_id: 1,
    template_label: "Favorite food",
    field_type: "text",
    facts: [
      {
        id: 11,
        vault_quick_facts_template_id: 1,
        value_text: "Pizza",
      },
    ],
  },
];

export const emptyPhotoGroup = [
  {
    template_id: 5,
    template_label: "Portrait",
    field_type: "photo",
    facts: [],
  },
];

export const documentGroup = [
  {
    template_id: 6,
    template_label: "Passport",
    field_type: "document",
    facts: [
      {
        id: 16,
        vault_quick_facts_template_id: 6,
        file: {
          id: 61,
          mime_type: "application/pdf",
          name: "passport.pdf",
          size: 8192,
          type: "document",
        },
      },
    ],
  },
];

export function setupQuickFactsMocks(): void {
  vi.clearAllMocks();
  quickFactsApiMocks.preferences.preferencesList.mockResolvedValue({
    data: {},
  });
  quickFactsApiMocks.quickFacts.contactsQuickFactsCreate.mockResolvedValue({
    data: { id: 101 },
  });
  quickFactsApiMocks.quickFacts.contactsQuickFactsUpdate.mockResolvedValue({
    data: { id: 101 },
  });
  quickFactsApiMocks.quickFacts.contactsQuickFactsDelete.mockResolvedValue(
    undefined,
  );
  quickFactsApiMocks.quickFacts.contactsQuickFactsToggleUpdate.mockResolvedValue(
    {
      data: undefined,
    },
  );
  quickFactsApiMocks.quickFacts.contactsQuickFactsFileCreate.mockResolvedValue({
    data: { id: 201 },
  });
  quickFactsApiMocks.quickFacts.contactsQuickFactsFileUpdate.mockResolvedValue({
    data: { id: 202 },
  });
}
