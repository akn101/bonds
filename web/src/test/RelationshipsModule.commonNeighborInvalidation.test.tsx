import { act } from "react";
import { expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { networkGraphQueryKey } from "@/components/networkGraphQueryKey";
import {
  apiMock,
  appMessageMock,
  holdRelationshipInvalidation,
  renderRelationshipsModule,
  setupRelationshipsUser,
} from "./relationshipsModuleTestHarness";

type RelationshipsQueryClient = ReturnType<
  typeof renderRelationshipsModule
>["queryClient"];

function seedGraphQuery(
  queryClient: RelationshipsQueryClient,
  vaultId: string,
  contactId: string,
  nodeIds: readonly string[],
): void {
  queryClient.setQueryData(networkGraphQueryKey({ vaultId, contactId }), {
    nodes: nodeIds.map((id) => ({ id })),
    edges: [],
  });
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

function seedCommonNeighborTopology(
  queryClient: RelationshipsQueryClient,
  targetContactId: string,
): void {
  seedGraphQuery(queryClient, "source-vault", "source-contact", [
    "source-contact",
  ]);
  seedGraphQuery(queryClient, "target-vault", targetContactId, [
    targetContactId,
  ]);
  seedGraphQuery(queryClient, "neighbor-vault", "common-neighbor", [
    "common-neighbor",
    "source-contact",
    targetContactId,
  ]);
  seedGraphQuery(queryClient, "unrelated-vault", "unrelated-contact", [
    "unrelated-contact",
    "source-contact",
  ]);
}

it("marks a cached common-neighbor graph stale after delete", async () => {
  const user = setupRelationshipsUser();
  apiMock.contactsRelationshipsList.mockResolvedValue({
    success: true,
    data: [
      {
        id: 71,
        related_contact_id: "target-contact",
        related_contact_name: "Target Contact",
        related_vault_id: "target-vault",
        relationship_type_id: 10,
        relationship_type_name: "Parent",
      },
    ],
  });
  const { queryClient } = renderRelationshipsModule({
    vaultId: "source-vault",
    contactId: "source-contact",
  });
  seedCommonNeighborTopology(queryClient, "target-contact");

  await user.click(await screen.findByRole("button", { name: "delete" }));
  await user.click(await screen.findByRole("button", { name: /ok/i }));

  await waitFor(() => {
    expectGraphQueryStale(queryClient, "source-vault", "source-contact");
    expectGraphQueryStale(queryClient, "target-vault", "target-contact");
    expectGraphQueryStale(queryClient, "neighbor-vault", "common-neighbor");
  });
  expectGraphQueryFresh(queryClient, "unrelated-vault", "unrelated-contact");
});

it("marks old and new cached common-neighbor graphs stale after update", async () => {
  const user = setupRelationshipsUser();
  apiMock.contactsRelationshipsList.mockResolvedValue({
    success: true,
    data: [
      {
        id: 72,
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
  const { queryClient } = renderRelationshipsModule({
    vaultId: "source-vault",
    contactId: "source-contact",
  });
  seedGraphQuery(queryClient, "source-vault", "source-contact", [
    "source-contact",
  ]);
  seedGraphQuery(queryClient, "old-vault", "old-target", ["old-target"]);
  seedGraphQuery(queryClient, "new-vault", "new-target", ["new-target"]);
  seedGraphQuery(queryClient, "neighbor-vault", "old-common-neighbor", [
    "old-common-neighbor",
    "source-contact",
    "old-target",
  ]);
  seedGraphQuery(queryClient, "neighbor-vault", "new-common-neighbor", [
    "new-common-neighbor",
    "source-contact",
    "new-target",
  ]);
  seedGraphQuery(queryClient, "unrelated-vault", "unrelated-contact", [
    "unrelated-contact",
    "source-contact",
  ]);

  await user.click(await screen.findByRole("button", { name: "edit" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByLabelText(/^Contact$/i));
  await user.click(await screen.findByTitle("New Target"));
  await user.click(within(dialog).getByRole("button", { name: /Save|OK/i }));

  await waitFor(() => {
    expectGraphQueryStale(queryClient, "source-vault", "source-contact");
    expectGraphQueryStale(queryClient, "old-vault", "old-target");
    expectGraphQueryStale(queryClient, "new-vault", "new-target");
    expectGraphQueryStale(queryClient, "neighbor-vault", "old-common-neighbor");
    expectGraphQueryStale(queryClient, "neighbor-vault", "new-common-neighbor");
  });
  expectGraphQueryFresh(queryClient, "unrelated-vault", "unrelated-contact");
});

it("awaits common-neighbor graph invalidation before update feedback", async () => {
  const user = setupRelationshipsUser();
  const commonNeighborKey = networkGraphQueryKey({
    vaultId: "neighbor-vault",
    contactId: "common-neighbor",
  });
  apiMock.contactsRelationshipsList.mockResolvedValue({
    success: true,
    data: [
      {
        id: 73,
        related_contact_id: "target-contact",
        related_contact_name: "Target Contact",
        related_vault_id: "target-vault",
        relationship_type_id: 10,
        relationship_type_name: "Parent",
      },
    ],
  });
  const { invalidateQueries, queryClient } = renderRelationshipsModule({
    vaultId: "source-vault",
    contactId: "source-contact",
  });
  seedCommonNeighborTopology(queryClient, "target-contact");
  const heldInvalidation = holdRelationshipInvalidation(
    invalidateQueries,
    commonNeighborKey,
  );

  await user.click(await screen.findByRole("button", { name: "edit" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: /Save|OK/i }));
  await waitFor(() =>
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: commonNeighborKey,
      exact: true,
    }),
  );
  await act(async () => {
    await Promise.resolve();
  });

  expect(appMessageMock.success).not.toHaveBeenCalled();
  expect(within(dialog).getByTitle("Target Contact")).toBeInTheDocument();

  await act(async () => {
    heldInvalidation.resolve(undefined);
    await heldInvalidation.promise;
  });

  await waitFor(() =>
    expect(appMessageMock.success).toHaveBeenCalledWith("Relationship updated"),
  );
});
