import { act } from "react";
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { networkGraphQueryKey } from "@/components/networkGraphQueryKey";
import {
  apiMock,
  appMessageMock,
  holdRelationshipInvalidation,
  renderRelationshipsModule,
  setupRelationshipsUser,
} from "./relationshipsModuleTestHarness";

type InvalidateQueriesSpy = ReturnType<
  typeof renderRelationshipsModule
>["invalidateQueries"];

type RelationshipsQueryClient = ReturnType<
  typeof renderRelationshipsModule
>["queryClient"];

type Deferred<Value> = {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
};

const BIDIRECTIONAL_SAME_VAULT_CREATE_KEYS = [
  ["vaults", "101", "feed"],
  ["vaults", "101", "contacts", "202", "feed"],
  ["vaults", "101", "contacts", "303", "feed"],
  ["vaults", "101", "contacts", "202", "relationships"],
  ["vaults", "101", "contacts", "303", "relationships"],
  ["vaults", "101", "contacts", "202", "graph"],
  ["vaults", "101", "contacts", "303", "graph"],
] as const;

const BIDIRECTIONAL_CROSS_VAULT_DELETE_KEYS = [
  ["vaults", "source-vault", "feed"],
  ["vaults", "target-vault", "feed"],
  ["vaults", "source-vault", "contacts", "source-contact", "feed"],
  ["vaults", "target-vault", "contacts", "target-contact", "feed"],
  ["vaults", "source-vault", "contacts", "source-contact", "relationships"],
  ["vaults", "target-vault", "contacts", "target-contact", "relationships"],
  ["vaults", "source-vault", "contacts", "source-contact", "graph"],
  ["vaults", "target-vault", "contacts", "target-contact", "graph"],
] as const;

function createDeferred<Value>(): Deferred<Value> {
  let resolvePromise: (value: Value) => void = () => {};
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function namedInvalidationCases(
  queryKeys: readonly (readonly string[])[],
): readonly { readonly name: string; readonly queryKey: readonly string[] }[] {
  return queryKeys.map((queryKey) => ({
    name: queryKey.join(" / "),
    queryKey,
  }));
}

function invalidatedKeys(
  invalidateQueries: InvalidateQueriesSpy,
): readonly unknown[] {
  return invalidateQueries.mock.calls.flatMap(([filters]) =>
    filters === undefined ? [] : [filters.queryKey],
  );
}

function expectGraphInvalidationsExact(
  invalidateQueries: InvalidateQueriesSpy,
  expectedQueryKeys: readonly (readonly string[])[],
): void {
  const graphFilters = invalidateQueries.mock.calls.flatMap(([filters]) => {
    if (filters === undefined) return [];
    const queryKey = filters.queryKey;
    return Array.isArray(queryKey) && queryKey[4] === "graph"
      ? [{ queryKey, exact: filters.exact }]
      : [];
  });
  expect(graphFilters).toEqual(
    expectedQueryKeys.map((queryKey) => ({ queryKey, exact: true })),
  );
}

function seedGraphQuery(
  queryClient: RelationshipsQueryClient,
  vaultId: string,
  contactId: string,
  nodeIds: readonly string[] = [],
): void {
  queryClient.setQueryData(networkGraphQueryKey({ vaultId, contactId }), {
    nodes: nodeIds.map((id) => ({ id })),
    edges: [],
  });
}

function expectGraphQueryFresh(
  queryClient: RelationshipsQueryClient,
  vaultId: string,
  contactId: string,
): void {
  expect(
    queryClient.getQueryState(networkGraphQueryKey({ vaultId, contactId }))
      ?.isInvalidated,
  ).toBe(false);
}

function expectGraphQueryStale(
  queryClient: RelationshipsQueryClient,
  vaultId: string,
  contactId: string,
): void {
  expect(
    queryClient.getQueryState(networkGraphQueryKey({ vaultId, contactId }))
      ?.isInvalidated,
  ).toBe(true);
}

function mockRelationshipTypeRows(includeChildType: boolean): void {
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
      ...(includeChildType
        ? [
            {
              id: 11,
              name: "Child",
              name_reverse_relationship: "Parent",
              relationship_group_type_id: 1,
              group_name: "Family",
            },
          ]
        : []),
    ],
  });
}

async function submitExistingRelationship(
  contactName: string,
  relationshipTypeName = "Parent",
): Promise<void> {
  const user = setupRelationshipsUser();
  await user.click(await screen.findByText("Add"));
  await user.click(await screen.findByLabelText(/^Contact$/i));
  await user.click(await screen.findByTitle(contactName));
  await user.click(screen.getByLabelText(/^Relationship Type$/i));
  await user.click(await screen.findByTitle(relationshipTypeName));
  await user.click(screen.getByRole("button", { name: /Save|OK/i }));
  await waitFor(() =>
    expect(apiMock.contactsRelationshipsCreate).toHaveBeenCalled(),
  );
}

describe("RelationshipsModule cache invalidation", () => {
  it("deduplicates the vault Feed key for an editor-capable same-vault create", async () => {
    mockRelationshipTypeRows(true);
    apiMock.contactsList.mockResolvedValue({
      success: true,
      data: [
        {
          contact_id: "303",
          contact_name: "Same Vault Contact",
          vault_id: "101",
          vault_name: "Main",
          has_editor: true,
        },
      ],
    });
    const { invalidateQueries } = renderRelationshipsModule({
      vaultId: 101,
      contactId: 202,
    });

    await submitExistingRelationship("Same Vault Contact");

    await waitFor(() => {
      expect(invalidatedKeys(invalidateQueries)).toEqual([
        ["vaults", "101", "feed"],
        ["vaults", "101", "contacts", "202", "feed"],
        ["vaults", "101", "contacts", "303", "feed"],
        ["vaults", "101", "contacts", "202", "relationships"],
        ["vaults", "101", "contacts", "303", "relationships"],
        ["vaults", "101", "contacts", "202", "graph"],
        ["vaults", "101", "contacts", "303", "graph"],
      ]);
    });
    expectGraphInvalidationsExact(invalidateQueries, [
      ["vaults", "101", "contacts", "202", "graph"],
      ["vaults", "101", "contacts", "303", "graph"],
    ]);
  });

  it("invalidates endpoint graph keys exactly without matching descendants", async () => {
    apiMock.contactsList.mockResolvedValue({
      success: true,
      data: [
        {
          contact_id: "target-contact",
          contact_name: "Target Contact",
          vault_id: "target-vault",
          vault_name: "Shared",
          has_editor: true,
        },
      ],
    });
    const { invalidateQueries, queryClient } = renderRelationshipsModule({
      vaultId: "source-vault",
      contactId: "source-contact",
    });
    const sourceGraphKey = networkGraphQueryKey({
      vaultId: "source-vault",
      contactId: "source-contact",
    });
    const sourceGraphSummaryKey = [...sourceGraphKey, "summary"] as const;
    seedGraphQuery(queryClient, "source-vault", "source-contact");
    seedGraphQuery(queryClient, "target-vault", "target-contact");
    queryClient.setQueryData(sourceGraphSummaryKey, { total: 2 });

    await submitExistingRelationship("Target Contact");

    await waitFor(() => {
      expectGraphQueryStale(queryClient, "source-vault", "source-contact");
      expectGraphQueryStale(queryClient, "target-vault", "target-contact");
    });
    expect(
      queryClient.getQueryState(sourceGraphSummaryKey)?.isInvalidated,
    ).toBe(false);
    expectGraphInvalidationsExact(invalidateQueries, [
      sourceGraphKey,
      networkGraphQueryKey({
        vaultId: "target-vault",
        contactId: "target-contact",
      }),
    ]);
  });

  it("marks the source and bidirectional target graph stale after create", async () => {
    mockRelationshipTypeRows(true);
    apiMock.contactsList.mockResolvedValue({
      success: true,
      data: [
        {
          contact_id: "target-contact",
          contact_name: "Target Contact",
          vault_id: "target-vault",
          vault_name: "Shared",
          has_editor: true,
        },
      ],
    });
    const { queryClient } = renderRelationshipsModule({
      vaultId: "source-vault",
      contactId: "source-contact",
    });
    seedGraphQuery(queryClient, "source-vault", "source-contact");
    seedGraphQuery(queryClient, "target-vault", "target-contact");
    seedGraphQuery(queryClient, "unrelated-vault", "unrelated-contact");

    await submitExistingRelationship("Target Contact");

    await waitFor(() => {
      expectGraphQueryStale(queryClient, "source-vault", "source-contact");
      expectGraphQueryStale(queryClient, "target-vault", "target-contact");
    });
    expectGraphQueryFresh(queryClient, "unrelated-vault", "unrelated-contact");
  });

  it("marks a cached common-neighbor graph stale after create", async () => {
    mockRelationshipTypeRows(true);
    apiMock.contactsList.mockResolvedValue({
      success: true,
      data: [
        {
          contact_id: "target-contact",
          contact_name: "Target Contact",
          vault_id: "target-vault",
          vault_name: "Shared",
          has_editor: true,
        },
      ],
    });
    const { invalidateQueries, queryClient } = renderRelationshipsModule({
      vaultId: "source-vault",
      contactId: "source-contact",
    });
    seedGraphQuery(queryClient, "source-vault", "source-contact");
    seedGraphQuery(queryClient, "target-vault", "target-contact");
    seedGraphQuery(queryClient, "neighbor-vault", "common-neighbor", [
      "common-neighbor",
      "source-contact",
      "target-contact",
    ]);
    seedGraphQuery(queryClient, "unrelated-vault", "unrelated-contact", [
      "unrelated-contact",
      "source-contact",
    ]);

    await submitExistingRelationship("Target Contact");

    await waitFor(() => {
      expectGraphQueryStale(queryClient, "source-vault", "source-contact");
      expectGraphQueryStale(queryClient, "target-vault", "target-contact");
      expectGraphQueryStale(queryClient, "neighbor-vault", "common-neighbor");
    });
    expectGraphQueryFresh(queryClient, "unrelated-vault", "unrelated-contact");
    expectGraphInvalidationsExact(invalidateQueries, [
      networkGraphQueryKey({
        vaultId: "source-vault",
        contactId: "source-contact",
      }),
      networkGraphQueryKey({
        vaultId: "target-vault",
        contactId: "target-contact",
      }),
      networkGraphQueryKey({
        vaultId: "neighbor-vault",
        contactId: "common-neighbor",
      }),
    ]);
  });

  it("invalidates both relationship lists for an editor-capable cross-vault create", async () => {
    mockRelationshipTypeRows(true);
    apiMock.contactsList.mockResolvedValue({
      success: true,
      data: [
        {
          contact_id: "target-contact",
          contact_name: "Editor Vault Contact",
          vault_id: "target-vault",
          vault_name: "Shared",
          has_editor: true,
        },
      ],
    });
    const { invalidateQueries } = renderRelationshipsModule({
      vaultId: "source-vault",
      contactId: "source-contact",
    });

    await submitExistingRelationship("Editor Vault Contact");

    await waitFor(() => {
      expect(invalidatedKeys(invalidateQueries)).toEqual([
        ["vaults", "source-vault", "feed"],
        ["vaults", "target-vault", "feed"],
        ["vaults", "source-vault", "contacts", "source-contact", "feed"],
        ["vaults", "target-vault", "contacts", "target-contact", "feed"],
        [
          "vaults",
          "source-vault",
          "contacts",
          "source-contact",
          "relationships",
        ],
        [
          "vaults",
          "target-vault",
          "contacts",
          "target-contact",
          "relationships",
        ],
        ["vaults", "source-vault", "contacts", "source-contact", "graph"],
        ["vaults", "target-vault", "contacts", "target-contact", "graph"],
      ]);
    });
  });

  it("invalidates source scopes and the target graph for a viewer-only cross-vault create", async () => {
    apiMock.contactsList.mockResolvedValue({
      success: true,
      data: [
        {
          contact_id: "target-contact",
          contact_name: "Viewer Vault Contact",
          vault_id: "target-vault",
          vault_name: "Shared",
          has_editor: false,
        },
      ],
    });
    const { invalidateQueries } = renderRelationshipsModule({
      vaultId: "source-vault",
      contactId: "source-contact",
    });

    await submitExistingRelationship("Viewer Vault Contact · one-way only");

    await waitFor(() => {
      expect(apiMock.contactsRelationshipsCreate).toHaveBeenCalledWith(
        "source-vault",
        "source-contact",
        {
          relationship_type_id: 10,
          related_contact_id: "target-contact",
        },
      );
      expect(invalidatedKeys(invalidateQueries)).toEqual([
        ["vaults", "source-vault", "feed"],
        ["vaults", "source-vault", "contacts", "source-contact", "feed"],
        [
          "vaults",
          "source-vault",
          "contacts",
          "source-contact",
          "relationships",
        ],
        ["vaults", "source-vault", "contacts", "source-contact", "graph"],
        ["vaults", "target-vault", "contacts", "target-contact", "graph"],
      ]);
    });
  });

  it("conservatively invalidates both lists when target permission is unknown", async () => {
    mockRelationshipTypeRows(true);
    apiMock.contactsList.mockResolvedValue({
      success: true,
      data: [
        {
          contact_id: "target-contact",
          contact_name: "Unknown Permission Contact",
          vault_id: "target-vault",
          vault_name: "Shared",
        },
      ],
    });
    const { invalidateQueries } = renderRelationshipsModule({
      vaultId: "source-vault",
      contactId: "source-contact",
    });

    await submitExistingRelationship("Unknown Permission Contact");

    await waitFor(() => {
      expect(invalidatedKeys(invalidateQueries)).toEqual([
        ["vaults", "source-vault", "feed"],
        ["vaults", "target-vault", "feed"],
        ["vaults", "source-vault", "contacts", "source-contact", "feed"],
        ["vaults", "target-vault", "contacts", "target-contact", "feed"],
        [
          "vaults",
          "source-vault",
          "contacts",
          "source-contact",
          "relationships",
        ],
        [
          "vaults",
          "target-vault",
          "contacts",
          "target-contact",
          "relationships",
        ],
        ["vaults", "source-vault", "contacts", "source-contact", "graph"],
        ["vaults", "target-vault", "contacts", "target-contact", "graph"],
      ]);
    });
  });

  it("conservatively invalidates a known target after reciprocal type names are legally renamed", async () => {
    apiMock.personalizeRelationshipTypesAllList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 10,
          name: "Caregiver",
          name_reverse_relationship: "Dependent",
          relationship_group_type_id: 1,
          group_name: "Family",
        },
        {
          id: 11,
          name: "Ward",
          name_reverse_relationship: "Guardian",
          relationship_group_type_id: 1,
          group_name: "Family",
        },
      ],
    });
    apiMock.contactsList.mockResolvedValue({
      success: true,
      data: [
        {
          contact_id: "target-contact",
          contact_name: "Renamed Type Contact",
          vault_id: "target-vault",
          vault_name: "Shared",
          has_editor: true,
        },
      ],
    });
    const { invalidateQueries } = renderRelationshipsModule({
      vaultId: "source-vault",
      contactId: "source-contact",
    });

    await submitExistingRelationship("Renamed Type Contact", "Caregiver");

    await waitFor(() => {
      expect(invalidatedKeys(invalidateQueries)).toEqual([
        ["vaults", "source-vault", "feed"],
        ["vaults", "target-vault", "feed"],
        ["vaults", "source-vault", "contacts", "source-contact", "feed"],
        ["vaults", "target-vault", "contacts", "target-contact", "feed"],
        [
          "vaults",
          "source-vault",
          "contacts",
          "source-contact",
          "relationships",
        ],
        [
          "vaults",
          "target-vault",
          "contacts",
          "target-contact",
          "relationships",
        ],
        ["vaults", "source-vault", "contacts", "source-contact", "graph"],
        ["vaults", "target-vault", "contacts", "target-contact", "graph"],
      ]);
    });
  });

  it("invalidates only the source Feed scopes for an external-contact create", async () => {
    const user = setupRelationshipsUser();
    const { invalidateQueries } = renderRelationshipsModule({
      vaultId: "source-vault",
      contactId: "source-contact",
    });

    await user.click(await screen.findByText("Add"));
    await user.click(await screen.findByText(/External contact/i));
    await user.type(
      await screen.findByRole("textbox", { name: /External/i }),
      "Uncle Bob",
    );
    await user.click(screen.getByLabelText(/^Relationship Type$/i));
    await user.click(await screen.findByTitle("Parent"));
    await user.click(screen.getByRole("button", { name: /Save|OK/i }));

    await waitFor(() => {
      expect(invalidatedKeys(invalidateQueries)).toEqual([
        ["vaults", "source-vault", "feed"],
        ["vaults", "source-vault", "contacts", "source-contact", "feed"],
        [
          "vaults",
          "source-vault",
          "contacts",
          "source-contact",
          "relationships",
        ],
        ["vaults", "source-vault", "contacts", "source-contact", "graph"],
      ]);
    });
  });

  it("retains both row identities through a 204 cross-vault delete", async () => {
    const user = setupRelationshipsUser();
    mockRelationshipTypeRows(true);
    apiMock.contactsList.mockResolvedValue({
      success: true,
      data: [
        {
          contact_id: "target-contact",
          contact_name: "Target Contact",
          vault_id: "target-vault",
          vault_name: "Shared",
          has_editor: true,
        },
      ],
    });
    apiMock.contactsRelationshipsList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 44,
          related_contact_id: "target-contact",
          related_contact_name: "Target Contact",
          related_vault_id: "target-vault",
          related_vault_name: "Shared",
          relationship_type_id: 10,
          relationship_type_name: "Parent",
        },
      ],
    });
    apiMock.contactsRelationshipsDelete.mockResolvedValue(undefined);
    const { invalidateQueries } = renderRelationshipsModule({
      vaultId: "source-vault",
      contactId: "source-contact",
    });

    await user.click(await screen.findByRole("button", { name: "delete" }));
    await user.click(await screen.findByRole("button", { name: /ok/i }));

    await waitFor(() => {
      expect(invalidatedKeys(invalidateQueries)).toEqual([
        ["vaults", "source-vault", "feed"],
        ["vaults", "target-vault", "feed"],
        ["vaults", "source-vault", "contacts", "source-contact", "feed"],
        ["vaults", "target-vault", "contacts", "target-contact", "feed"],
        [
          "vaults",
          "source-vault",
          "contacts",
          "source-contact",
          "relationships",
        ],
        [
          "vaults",
          "target-vault",
          "contacts",
          "target-contact",
          "relationships",
        ],
        ["vaults", "source-vault", "contacts", "source-contact", "graph"],
        ["vaults", "target-vault", "contacts", "target-contact", "graph"],
      ]);
    });
    expect(apiMock.contactsRelationshipsDelete).toHaveBeenCalledWith(
      "source-vault",
      "source-contact",
      44,
    );
    expectGraphInvalidationsExact(invalidateQueries, [
      networkGraphQueryKey({
        vaultId: "source-vault",
        contactId: "source-contact",
      }),
      networkGraphQueryKey({
        vaultId: "target-vault",
        contactId: "target-contact",
      }),
    ]);
  });

  it("uses the current vault as the related scope fallback for delete", async () => {
    const user = setupRelationshipsUser();
    mockRelationshipTypeRows(true);
    apiMock.contactsList.mockResolvedValue({
      success: true,
      data: [
        {
          contact_id: "target-contact",
          contact_name: "Target Contact",
          vault_id: "source-vault",
          vault_name: "Main",
          has_editor: true,
        },
      ],
    });
    apiMock.contactsRelationshipsList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 45,
          related_contact_id: "target-contact",
          related_contact_name: "Target Contact",
          relationship_type_id: 10,
          relationship_type_name: "Parent",
        },
      ],
    });
    apiMock.contactsRelationshipsDelete.mockResolvedValue(undefined);
    const { invalidateQueries } = renderRelationshipsModule({
      vaultId: "source-vault",
      contactId: "source-contact",
    });

    await user.click(await screen.findByRole("button", { name: "delete" }));
    await user.click(await screen.findByRole("button", { name: /ok/i }));

    await waitFor(() => {
      expect(invalidatedKeys(invalidateQueries)).toEqual([
        ["vaults", "source-vault", "feed"],
        ["vaults", "source-vault", "contacts", "source-contact", "feed"],
        ["vaults", "source-vault", "contacts", "target-contact", "feed"],
        [
          "vaults",
          "source-vault",
          "contacts",
          "source-contact",
          "relationships",
        ],
        [
          "vaults",
          "source-vault",
          "contacts",
          "target-contact",
          "relationships",
        ],
        ["vaults", "source-vault", "contacts", "source-contact", "graph"],
        ["vaults", "source-vault", "contacts", "target-contact", "graph"],
      ]);
    });
  });

  it("invalidates both participants after target permission drops and visible type names change", async () => {
    const user = setupRelationshipsUser();
    mockRelationshipTypeRows(false);
    apiMock.contactsRelationshipsList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 50,
          related_contact_id: "target-contact",
          related_contact_name: "Viewer Contact",
          related_vault_id: "target-vault",
          relationship_type_id: 10,
          relationship_type_name: "Parent",
        },
      ],
    });
    apiMock.contactsList.mockResolvedValue({
      success: true,
      data: [
        {
          contact_id: "target-contact",
          contact_name: "Viewer Contact",
          vault_id: "target-vault",
          vault_name: "Shared",
          has_editor: false,
        },
      ],
    });
    apiMock.contactsRelationshipsDelete.mockResolvedValue(undefined);
    const { invalidateQueries } = renderRelationshipsModule({
      vaultId: "source-vault",
      contactId: "source-contact",
    });

    await user.click(await screen.findByRole("button", { name: "delete" }));
    await user.click(await screen.findByRole("button", { name: /ok/i }));

    await waitFor(() => {
      expect(invalidatedKeys(invalidateQueries)).toEqual(
        BIDIRECTIONAL_CROSS_VAULT_DELETE_KEYS,
      );
    });
  });

  it("conservatively invalidates a known delete target without visible reverse mapping", async () => {
    const user = setupRelationshipsUser();
    mockRelationshipTypeRows(false);
    apiMock.contactsRelationshipsList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 51,
          related_contact_id: "target-contact",
          related_contact_name: "No Reverse Contact",
          related_vault_id: "target-vault",
          relationship_type_id: 10,
          relationship_type_name: "Parent",
        },
      ],
    });
    apiMock.contactsList.mockResolvedValue({
      success: true,
      data: [
        {
          contact_id: "target-contact",
          contact_name: "No Reverse Contact",
          vault_id: "target-vault",
          vault_name: "Shared",
          has_editor: true,
        },
      ],
    });
    apiMock.contactsRelationshipsDelete.mockResolvedValue(undefined);
    const { invalidateQueries } = renderRelationshipsModule({
      vaultId: "source-vault",
      contactId: "source-contact",
    });

    await user.click(await screen.findByRole("button", { name: "delete" }));
    await user.click(await screen.findByRole("button", { name: /ok/i }));

    await waitFor(() => {
      expect(invalidatedKeys(invalidateQueries)).toEqual([
        ["vaults", "source-vault", "feed"],
        ["vaults", "target-vault", "feed"],
        ["vaults", "source-vault", "contacts", "source-contact", "feed"],
        ["vaults", "target-vault", "contacts", "target-contact", "feed"],
        [
          "vaults",
          "source-vault",
          "contacts",
          "source-contact",
          "relationships",
        ],
        [
          "vaults",
          "target-vault",
          "contacts",
          "target-contact",
          "relationships",
        ],
        ["vaults", "source-vault", "contacts", "source-contact", "graph"],
        ["vaults", "target-vault", "contacts", "target-contact", "graph"],
      ]);
    });
  });

  it("deletes an external-contact relationship and invalidates only the source Feed scopes", async () => {
    const user = setupRelationshipsUser();
    apiMock.contactsRelationshipsList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 47,
          related_contact_name: "Uncle Bob",
          relationship_type_id: 10,
          relationship_type_name: "Parent",
        },
      ],
    });
    apiMock.contactsRelationshipsDelete.mockResolvedValue(undefined);
    const { invalidateQueries } = renderRelationshipsModule({
      vaultId: "source-vault",
      contactId: "source-contact",
    });

    await user.click(await screen.findByRole("button", { name: "delete" }));
    await user.click(await screen.findByRole("button", { name: /ok/i }));

    await waitFor(() => {
      expect(apiMock.contactsRelationshipsDelete).toHaveBeenCalledWith(
        "source-vault",
        "source-contact",
        47,
      );
    });
    expect(invalidatedKeys(invalidateQueries)).toEqual([
      ["vaults", "source-vault", "feed"],
      ["vaults", "source-vault", "contacts", "source-contact", "feed"],
      ["vaults", "source-vault", "contacts", "source-contact", "relationships"],
      ["vaults", "source-vault", "contacts", "source-contact", "graph"],
    ]);
  });

  it("refreshes the source list and deduplicated source/target graphs after update", async () => {
    const user = setupRelationshipsUser();
    apiMock.contactsRelationshipsList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 46,
          related_contact_id: "target-contact",
          related_contact_name: "Target Contact",
          related_vault_id: "target-vault",
          relationship_type_id: 10,
          relationship_type_name: "Parent",
        },
      ],
    });
    const { invalidateQueries } = renderRelationshipsModule({
      vaultId: "source-vault",
      contactId: "source-contact",
    });

    await user.click(await screen.findByRole("button", { name: "edit" }));
    await user.click(screen.getByRole("button", { name: /Save|OK/i }));

    await waitFor(() => {
      expect(invalidatedKeys(invalidateQueries)).toEqual([
        [
          "vaults",
          "source-vault",
          "contacts",
          "source-contact",
          "relationships",
        ],
        ["vaults", "source-vault", "contacts", "source-contact", "graph"],
        ["vaults", "target-vault", "contacts", "target-contact", "graph"],
      ]);
    });
  });

  it("invalidates old and new target graphs when update changes target and type", async () => {
    const user = setupRelationshipsUser();
    apiMock.contactsRelationshipsList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 54,
          related_contact_id: "old-target",
          related_contact_name: "Old Target",
          related_vault_id: "old-vault",
          relationship_type_id: 10,
          relationship_type_name: "Parent",
        },
      ],
    });
    apiMock.contactsList.mockResolvedValue({
      success: true,
      data: [
        {
          contact_id: "old-target",
          contact_name: "Old Target",
          vault_id: "old-vault",
          vault_name: "Old Vault",
          has_editor: true,
        },
        {
          contact_id: "new-target",
          contact_name: "New Target",
          vault_id: "new-vault",
          vault_name: "New Vault",
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
          id: 20,
          name: "Friend",
          name_reverse_relationship: "Friend",
          relationship_group_type_id: 2,
          group_name: "Social",
        },
      ],
    });
    const { invalidateQueries, queryClient } = renderRelationshipsModule({
      vaultId: "source-vault",
      contactId: "source-contact",
    });
    seedGraphQuery(queryClient, "source-vault", "source-contact");
    seedGraphQuery(queryClient, "old-vault", "old-target");
    seedGraphQuery(queryClient, "new-vault", "new-target");
    seedGraphQuery(queryClient, "unrelated-vault", "unrelated-contact");

    await user.click(await screen.findByRole("button", { name: "edit" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByLabelText(/^Contact$/i));
    await user.click(await screen.findByTitle("New Target"));
    await user.click(within(dialog).getByLabelText(/^Relationship Type$/i));
    await user.click(await screen.findByTitle("Friend"));
    await user.click(within(dialog).getByRole("button", { name: /Save|OK/i }));

    await waitFor(() => {
      expect(apiMock.contactsRelationshipsUpdate).toHaveBeenCalledWith(
        "source-vault",
        "source-contact",
        54,
        {
          related_contact_id: "new-target",
          relationship_type_id: 20,
        },
      );
      expect(invalidatedKeys(invalidateQueries)).toEqual([
        [
          "vaults",
          "source-vault",
          "contacts",
          "source-contact",
          "relationships",
        ],
        ["vaults", "source-vault", "contacts", "source-contact", "graph"],
        ["vaults", "old-vault", "contacts", "old-target", "graph"],
        ["vaults", "new-vault", "contacts", "new-target", "graph"],
      ]);
    });
    expectGraphQueryStale(queryClient, "source-vault", "source-contact");
    expectGraphQueryStale(queryClient, "old-vault", "old-target");
    expectGraphQueryStale(queryClient, "new-vault", "new-target");
    expectGraphQueryFresh(queryClient, "unrelated-vault", "unrelated-contact");
    expectGraphInvalidationsExact(invalidateQueries, [
      networkGraphQueryKey({
        vaultId: "source-vault",
        contactId: "source-contact",
      }),
      networkGraphQueryKey({
        vaultId: "old-vault",
        contactId: "old-target",
      }),
      networkGraphQueryKey({
        vaultId: "new-vault",
        contactId: "new-target",
      }),
    ]);
  });

  it("deduplicates update graph participants when old and new target are unchanged", async () => {
    const user = setupRelationshipsUser();
    apiMock.contactsRelationshipsList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 55,
          related_contact_id: "target-contact",
          related_contact_name: "Target Contact",
          related_vault_id: "target-vault",
          relationship_type_id: 10,
          relationship_type_name: "Parent",
        },
      ],
    });
    const { invalidateQueries } = renderRelationshipsModule({
      vaultId: "source-vault",
      contactId: "source-contact",
    });

    await user.click(await screen.findByRole("button", { name: "edit" }));
    await user.click(screen.getByRole("button", { name: /Save|OK/i }));

    await waitFor(() => {
      expect(invalidatedKeys(invalidateQueries)).toEqual([
        [
          "vaults",
          "source-vault",
          "contacts",
          "source-contact",
          "relationships",
        ],
        ["vaults", "source-vault", "contacts", "source-contact", "graph"],
        ["vaults", "target-vault", "contacts", "target-contact", "graph"],
      ]);
    });
  });

  it.each(namedInvalidationCases(BIDIRECTIONAL_SAME_VAULT_CREATE_KEYS))(
    "awaits same-vault create invalidation $name before feedback and reset",
    async ({ queryKey }) => {
      mockRelationshipTypeRows(true);
      apiMock.contactsList.mockResolvedValue({
        success: true,
        data: [
          {
            contact_id: "303",
            contact_name: "Same Vault Contact",
            vault_id: "101",
            vault_name: "Main",
            has_editor: true,
          },
        ],
      });
      const { invalidateQueries } = renderRelationshipsModule({
        vaultId: 101,
        contactId: 202,
      });
      const heldInvalidation = holdRelationshipInvalidation(
        invalidateQueries,
        queryKey,
      );

      await submitExistingRelationship("Same Vault Contact");
      await waitFor(() => {
        expect(invalidatedKeys(invalidateQueries)).toEqual(
          BIDIRECTIONAL_SAME_VAULT_CREATE_KEYS,
        );
      });
      await act(async () => {
        await Promise.resolve();
      });

      const openDialog = screen.getByRole("dialog");
      expect(
        within(openDialog).getByTitle("Same Vault Contact"),
      ).toBeInTheDocument();
      expect(within(openDialog).getByTitle("Parent")).toBeInTheDocument();
      expect(appMessageMock.success).not.toHaveBeenCalled();

      await act(async () => {
        heldInvalidation.resolve(undefined);
        await heldInvalidation.promise;
      });

      await waitFor(() => {
        expect(appMessageMock.success).toHaveBeenCalledWith(
          "Relationship added",
        );
      });
      const resetDialog = screen.getByRole("dialog", { hidden: true });
      expect(resetDialog).not.toBeVisible();
      expect(
        within(resetDialog).queryByTitle("Same Vault Contact"),
      ).not.toBeInTheDocument();
      expect(
        within(resetDialog).queryByTitle("Parent"),
      ).not.toBeInTheDocument();
    },
  );

  it.each(namedInvalidationCases(BIDIRECTIONAL_CROSS_VAULT_DELETE_KEYS))(
    "awaits viewer-after-downgrade delete invalidation $name before feedback",
    async ({ queryKey }) => {
      const user = setupRelationshipsUser();
      mockRelationshipTypeRows(true);
      apiMock.contactsRelationshipsList.mockResolvedValue({
        success: true,
        data: [
          {
            id: 52,
            related_contact_id: "target-contact",
            related_contact_name: "Target Contact",
            related_vault_id: "target-vault",
            relationship_type_id: 10,
            relationship_type_name: "Parent",
          },
        ],
      });
      apiMock.contactsList.mockResolvedValue({
        success: true,
        data: [
          {
            contact_id: "target-contact",
            contact_name: "Target Contact",
            vault_id: "target-vault",
            vault_name: "Shared",
            has_editor: false,
          },
        ],
      });
      apiMock.contactsRelationshipsDelete.mockResolvedValue(undefined);
      const { invalidateQueries } = renderRelationshipsModule({
        vaultId: "source-vault",
        contactId: "source-contact",
      });
      const heldInvalidation = holdRelationshipInvalidation(
        invalidateQueries,
        queryKey,
      );

      await user.click(await screen.findByRole("button", { name: "delete" }));
      await user.click(await screen.findByRole("button", { name: /ok/i }));
      await waitFor(() => {
        expect(invalidatedKeys(invalidateQueries)).toEqual(
          BIDIRECTIONAL_CROSS_VAULT_DELETE_KEYS,
        );
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(appMessageMock.success).not.toHaveBeenCalled();

      await act(async () => {
        heldInvalidation.resolve(undefined);
        await heldInvalidation.promise;
      });

      await waitFor(() =>
        expect(appMessageMock.success).toHaveBeenCalledWith(
          "Relationship removed",
        ),
      );
    },
  );

  it("keeps the submitted create route and list identity after rerender", async () => {
    const createResult = createDeferred<{
      readonly success: true;
      readonly data: Record<string, never>;
    }>();
    apiMock.contactsRelationshipsCreate.mockReturnValue(createResult.promise);
    const { invalidateQueries, rerenderRelationshipsModule } =
      renderRelationshipsModule({
        vaultId: "original-vault",
        contactId: "original-contact",
      });

    await submitExistingRelationship("Jane Doe");
    rerenderRelationshipsModule({
      vaultId: "new-vault",
      contactId: "new-contact",
    });
    createResult.resolve({ success: true, data: {} });

    await waitFor(() => {
      expect(apiMock.contactsRelationshipsCreate).toHaveBeenCalledWith(
        "original-vault",
        "original-contact",
        {
          relationship_type_id: 10,
          related_contact_id: "existing-uuid",
        },
      );
      expect(invalidatedKeys(invalidateQueries)).toEqual([
        ["vaults", "original-vault", "feed"],
        ["vaults", "v1", "feed"],
        ["vaults", "original-vault", "contacts", "original-contact", "feed"],
        ["vaults", "v1", "contacts", "existing-uuid", "feed"],
        [
          "vaults",
          "original-vault",
          "contacts",
          "original-contact",
          "relationships",
        ],
        ["vaults", "v1", "contacts", "existing-uuid", "relationships"],
        ["vaults", "original-vault", "contacts", "original-contact", "graph"],
        ["vaults", "v1", "contacts", "existing-uuid", "graph"],
      ]);
    });
  });

  it("keeps the submitted update route and list identity after rerender", async () => {
    const user = setupRelationshipsUser();
    const updateResult = createDeferred<{
      readonly success: true;
      readonly data: Record<string, never>;
    }>();
    apiMock.contactsRelationshipsList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 48,
          related_contact_id: "existing-uuid",
          related_contact_name: "Jane Doe",
          relationship_type_id: 10,
          relationship_type_name: "Parent",
        },
      ],
    });
    apiMock.contactsRelationshipsUpdate.mockReturnValue(updateResult.promise);
    const { invalidateQueries, rerenderRelationshipsModule } =
      renderRelationshipsModule({
        vaultId: "original-vault",
        contactId: "original-contact",
      });

    await user.click(await screen.findByRole("button", { name: "edit" }));
    await user.click(screen.getByRole("button", { name: /Save|OK/i }));
    await waitFor(() =>
      expect(apiMock.contactsRelationshipsUpdate).toHaveBeenCalled(),
    );
    rerenderRelationshipsModule({
      vaultId: "new-vault",
      contactId: "new-contact",
    });
    updateResult.resolve({ success: true, data: {} });

    await waitFor(() => {
      expect(apiMock.contactsRelationshipsUpdate).toHaveBeenCalledWith(
        "original-vault",
        "original-contact",
        48,
        {
          related_contact_id: "existing-uuid",
          relationship_type_id: 10,
        },
      );
      expect(invalidatedKeys(invalidateQueries)).toEqual([
        [
          "vaults",
          "original-vault",
          "contacts",
          "original-contact",
          "relationships",
        ],
        ["vaults", "original-vault", "contacts", "original-contact", "graph"],
        ["vaults", "original-vault", "contacts", "existing-uuid", "graph"],
        ["vaults", "v1", "contacts", "existing-uuid", "graph"],
      ]);
    });
  });

  it("keeps the submitted 204 delete route, list, and participants after rerender", async () => {
    const user = setupRelationshipsUser();
    const deleteResult = createDeferred<undefined>();
    apiMock.contactsRelationshipsList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 49,
          related_contact_id: "target-contact",
          related_contact_name: "Target Contact",
          related_vault_id: "target-vault",
          related_vault_name: "Shared",
          relationship_type_id: 10,
          relationship_type_name: "Parent",
        },
      ],
    });
    apiMock.contactsRelationshipsDelete.mockReturnValue(deleteResult.promise);
    const { invalidateQueries, rerenderRelationshipsModule } =
      renderRelationshipsModule({
        vaultId: "original-vault",
        contactId: "original-contact",
      });

    await user.click(await screen.findByRole("button", { name: "delete" }));
    await user.click(await screen.findByRole("button", { name: /ok/i }));
    await waitFor(() =>
      expect(apiMock.contactsRelationshipsDelete).toHaveBeenCalled(),
    );
    rerenderRelationshipsModule({
      vaultId: "new-vault",
      contactId: "new-contact",
    });
    deleteResult.resolve(undefined);

    await waitFor(() => {
      expect(apiMock.contactsRelationshipsDelete).toHaveBeenCalledWith(
        "original-vault",
        "original-contact",
        49,
      );
      expect(invalidatedKeys(invalidateQueries)).toEqual([
        ["vaults", "original-vault", "feed"],
        ["vaults", "target-vault", "feed"],
        ["vaults", "original-vault", "contacts", "original-contact", "feed"],
        ["vaults", "target-vault", "contacts", "target-contact", "feed"],
        [
          "vaults",
          "original-vault",
          "contacts",
          "original-contact",
          "relationships",
        ],
        [
          "vaults",
          "target-vault",
          "contacts",
          "target-contact",
          "relationships",
        ],
        ["vaults", "original-vault", "contacts", "original-contact", "graph"],
        ["vaults", "target-vault", "contacts", "target-contact", "graph"],
      ]);
    });
  });

  it("does not invalidate or reset the create form when creation fails", async () => {
    apiMock.contactsRelationshipsCreate.mockRejectedValue(
      new Error("create failed"),
    );
    const { invalidateQueries } = renderRelationshipsModule();

    await submitExistingRelationship("Jane Doe");

    await waitFor(() =>
      expect(appMessageMock.error).toHaveBeenCalledWith("create failed"),
    );
    expect(invalidatedKeys(invalidateQueries)).toEqual([]);
    expect(appMessageMock.success).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { hidden: true })).toHaveAttribute(
      "aria-modal",
      "true",
    );
    expect(screen.getAllByTitle("Jane Doe").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("Parent").length).toBeGreaterThan(0);
  });

  it("does not invalidate list, Feed, or graph queries when update fails", async () => {
    const user = setupRelationshipsUser();
    apiMock.contactsRelationshipsList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 56,
          related_contact_id: "target-contact",
          related_contact_name: "Target Contact",
          related_vault_id: "target-vault",
          relationship_type_id: 10,
          relationship_type_name: "Parent",
        },
      ],
    });
    apiMock.contactsRelationshipsUpdate.mockRejectedValue(
      new Error("update failed"),
    );
    const { invalidateQueries, queryClient } = renderRelationshipsModule({
      vaultId: "source-vault",
      contactId: "source-contact",
    });
    seedGraphQuery(queryClient, "source-vault", "source-contact");
    seedGraphQuery(queryClient, "target-vault", "target-contact");

    await user.click(await screen.findByRole("button", { name: "edit" }));
    await user.click(screen.getByRole("button", { name: /Save|OK/i }));

    await waitFor(() =>
      expect(appMessageMock.error).toHaveBeenCalledWith("update failed"),
    );
    expect(invalidatedKeys(invalidateQueries)).toEqual([]);
    expectGraphQueryFresh(queryClient, "source-vault", "source-contact");
    expectGraphQueryFresh(queryClient, "target-vault", "target-contact");
    expect(appMessageMock.success).not.toHaveBeenCalled();
  });

  it("does not invalidate or report success when deletion fails", async () => {
    const user = setupRelationshipsUser();
    apiMock.contactsRelationshipsList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 53,
          related_contact_id: "target-contact",
          related_contact_name: "Target Contact",
          related_vault_id: "target-vault",
          relationship_type_id: 10,
          relationship_type_name: "Parent",
        },
      ],
    });
    apiMock.contactsRelationshipsDelete.mockRejectedValue(
      new Error("delete failed"),
    );
    const { invalidateQueries } = renderRelationshipsModule({
      vaultId: "source-vault",
      contactId: "source-contact",
    });

    await user.click(await screen.findByRole("button", { name: "delete" }));
    await user.click(await screen.findByRole("button", { name: /ok/i }));

    await waitFor(() =>
      expect(appMessageMock.error).toHaveBeenCalledWith("delete failed"),
    );
    expect(invalidatedKeys(invalidateQueries)).toEqual([]);
    expect(appMessageMock.success).not.toHaveBeenCalled();
  });
});
