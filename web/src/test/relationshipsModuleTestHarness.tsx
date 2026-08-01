import { App as AntApp, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import userEvent, {
  PointerEventsCheckLevel,
} from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, vi } from "vitest";
import type { MockInstance } from "vitest";
import RelationshipsModule from "@/pages/contact/modules/RelationshipsModule";
import type { NormalizedFeedSource } from "@/utils/feedSourceLink";

type RelationshipTarget = Extract<
  NormalizedFeedSource,
  { readonly module: "relationships" }
>;

type RelationshipsModuleTestProps = {
  readonly vaultId?: string | number;
  readonly contactId?: string | number;
  readonly currentContactName?: string;
  readonly target?: RelationshipTarget;
};

type InvalidateQueriesSpy = MockInstance<QueryClient["invalidateQueries"]>;

export type Deferred<Value> = {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
};

const activeQueryClients = new Set<QueryClient>();
const pendingInvalidationReleases = new Set<() => void>();

function createDeferred<Value>(): Deferred<Value> {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  if (resolvePromise === undefined) {
    throw new Error("expected deferred resolver initialization");
  }
  return { promise, resolve: resolvePromise };
}

export function setupRelationshipsUser() {
  return userEvent.setup({
    delay: null,
    pointerEventsCheck: PointerEventsCheckLevel.Never,
    skipHover: true,
  });
}

export function holdRelationshipInvalidation(
  invalidateQueries: InvalidateQueriesSpy,
  heldQueryKey: readonly unknown[],
): Deferred<void> {
  const heldInvalidation = createDeferred<void>();
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    heldInvalidation.resolve(undefined);
    pendingInvalidationReleases.delete(release);
  };
  pendingInvalidationReleases.add(release);
  invalidateQueries.mockImplementation((filters) =>
    JSON.stringify(filters?.queryKey) === JSON.stringify(heldQueryKey)
      ? heldInvalidation.promise
      : Promise.resolve(),
  );
  return {
    promise: heldInvalidation.promise,
    resolve: release,
  };
}

const hoistedMocks = vi.hoisted(() => ({
  apiMock: {
    contactsRelationshipsList: vi.fn(),
    contactsRelationshipsCreate: vi.fn(),
    contactsRelationshipsUpdate: vi.fn(),
    contactsRelationshipsDelete: vi.fn(),
    contactsList: vi.fn(),
    personalizeRelationshipTypesAllList: vi.fn(),
  },
  appMessageMock: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

export const appMessageMock = hoistedMocks.appMessageMock;
export const apiMock = hoistedMocks.apiMock;

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  return {
    ...actual,
    App: Object.assign(actual.App, {
      useApp: () => ({ message: hoistedMocks.appMessageMock }),
    }),
  };
});

vi.mock("@/components/NetworkGraph", () => ({
  default: () => <div data-testid="network-graph" />,
}));

vi.mock("@/api", () => ({
  api: {
    relationships: {
      contactsRelationshipsList: hoistedMocks.apiMock.contactsRelationshipsList,
      contactsRelationshipsCreate:
        hoistedMocks.apiMock.contactsRelationshipsCreate,
      contactsRelationshipsUpdate:
        hoistedMocks.apiMock.contactsRelationshipsUpdate,
      contactsRelationshipsDelete:
        hoistedMocks.apiMock.contactsRelationshipsDelete,
      contactsList: hoistedMocks.apiMock.contactsList,
    },
    relationshipTypes: {
      personalizeRelationshipTypesAllList:
        hoistedMocks.apiMock.personalizeRelationshipTypesAllList,
    },
  },
}));

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.contactsRelationshipsList.mockResolvedValue({
    success: true,
    data: [],
  });
  apiMock.contactsRelationshipsCreate.mockResolvedValue({
    success: true,
    data: {},
  });
  apiMock.contactsRelationshipsUpdate.mockResolvedValue({
    success: true,
    data: {},
  });
  apiMock.contactsRelationshipsDelete.mockResolvedValue({
    success: true,
    data: {},
  });
  apiMock.contactsList.mockResolvedValue({
    success: true,
    data: [
      {
        contact_id: "existing-uuid",
        contact_name: "Jane Doe",
        vault_id: "v1",
        vault_name: "Main",
        has_editor: true,
      },
    ],
  });
  apiMock.personalizeRelationshipTypesAllList.mockResolvedValue({
    success: true,
    data: [
      {
        id: 10,
        name: "Parent",
        name_reverse_relationship: "Child",
        relationship_group_type_id: 1,
        group_name: "Family",
      },
      {
        id: 11,
        name: "Child",
        name_reverse_relationship: "Parent",
        relationship_group_type_id: 1,
        group_name: "Family",
      },
    ],
  });
});

afterEach(() => {
  cleanup();
  for (const release of pendingInvalidationReleases) release();
  for (const queryClient of activeQueryClients) {
    queryClient.clear();
  }
  activeQueryClients.clear();
});

export function renderRelationshipsModule({
  vaultId = "v1",
  contactId = "c1",
  currentContactName = "Alice Johnson",
  target,
}: RelationshipsModuleTestProps = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  activeQueryClients.add(queryClient);
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

  const renderModule = ({
    vaultId: nextVaultId = "v1",
    contactId: nextContactId = "c1",
    currentContactName: nextCurrentContactName = "Alice Johnson",
    target: nextTarget,
  }: RelationshipsModuleTestProps) => (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <AntApp>
          <MemoryRouter>
            <RelationshipsModule
              vaultId={nextVaultId}
              contactId={nextContactId}
              currentContactName={nextCurrentContactName}
              target={nextTarget}
            />
          </MemoryRouter>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
  const rendered = render(
    renderModule({ vaultId, contactId, currentContactName, target }),
  );

  return {
    ...rendered,
    invalidateQueries,
    queryClient,
    rerenderRelationshipsModule: (props: RelationshipsModuleTestProps) =>
      rendered.rerender(renderModule(props)),
  };
}
