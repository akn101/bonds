import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  confirmVisibleDelete,
  createDeferred,
  getMediaApiMocks,
  getMediaMessageMocks,
  invalidatedKeys,
  renderDocumentsModule,
  setupContactMediaMocks,
} from "./mediaFeedInvalidationTestHarness";

describe("DocumentsModule Feed invalidation", () => {
  beforeEach(setupContactMediaMocks);

  it("refreshes the document list after upload completion", async () => {
    const { invalidateQueries } = renderDocumentsModule();

    await userEvent.click(
      await screen.findByRole("button", { name: "Start upload" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Finish upload" }),
    );

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["vaults", "vault-1", "contacts", "contact-1", "documents"],
      });
    });
  });

  it("invalidates the Feed scope captured when a document upload starts", async () => {
    const { invalidateQueries, rerenderScope } = renderDocumentsModule();

    await userEvent.click(
      await screen.findByRole("button", { name: "Start upload" }),
    );
    await act(() =>
      rerenderScope({ vaultId: "vault-2", contactId: "contact-2" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Finish upload" }),
    );

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["vaults", "vault-1", "feed"],
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["vaults", "vault-1", "contacts", "contact-1", "feed"],
      });
    });
    expect(invalidatedKeys(invalidateQueries)).toEqual([
      ["vaults", "vault-1", "contacts", "contact-1", "documents"],
      ["vaults", "vault-1", "feed"],
      ["vaults", "vault-1", "contacts", "contact-1", "feed"],
    ]);
  });

  it("invalidates the document list and exact Feed scopes after delete", async () => {
    const mediaApiMocks = getMediaApiMocks();
    mediaApiMocks.contactDocuments.contactsDocumentsList.mockResolvedValue({
      data: [
        {
          id: 41,
          name: "passport.pdf",
          mime_type: "application/pdf",
          size: 24,
        },
      ],
      meta: { page: 1, per_page: 15, total: 1, total_pages: 1 },
    });
    const { invalidateQueries } = renderDocumentsModule();
    await screen.findByText("passport.pdf");

    await confirmVisibleDelete();

    await waitFor(() => {
      expect(
        mediaApiMocks.contactDocuments.contactsDocumentsDelete,
      ).toHaveBeenCalledWith("vault-1", "contact-1", 41);
    });
    expect(invalidatedKeys(invalidateQueries)).toEqual([
      ["vaults", "vault-1", "contacts", "contact-1", "documents"],
      ["vaults", "vault-1", "feed"],
      ["vaults", "vault-1", "contacts", "contact-1", "feed"],
    ]);
  });

  it("freezes the deleted document and source route before rerender", async () => {
    const mediaApiMocks = getMediaApiMocks();
    const deleteCompletion = createDeferred<void>();
    mediaApiMocks.contactDocuments.contactsDocumentsList.mockResolvedValue({
      data: [
        {
          id: 41,
          name: "passport.pdf",
          mime_type: "application/pdf",
          size: 24,
        },
      ],
      meta: { page: 1, per_page: 15, total: 1, total_pages: 1 },
    });
    mediaApiMocks.contactDocuments.contactsDocumentsDelete.mockReturnValue(
      deleteCompletion.promise,
    );
    const { invalidateQueries, queryClient, rerenderScope } =
      renderDocumentsModule();
    await screen.findByText("passport.pdf");

    await confirmVisibleDelete();
    await waitFor(() => {
      expect(
        mediaApiMocks.contactDocuments.contactsDocumentsDelete,
      ).toHaveBeenCalledWith("vault-1", "contact-1", 41);
    });
    await act(() =>
      rerenderScope({ vaultId: "vault-2", contactId: "contact-2" }),
    );
    await act(async () => {
      deleteCompletion.resolve(undefined);
      await deleteCompletion.promise;
    });

    await waitFor(() => {
      expect(invalidatedKeys(invalidateQueries)).toEqual([
        ["vaults", "vault-1", "contacts", "contact-1", "documents"],
        ["vaults", "vault-1", "feed"],
        ["vaults", "vault-1", "contacts", "contact-1", "feed"],
      ]);
    });
    expect(
      queryClient.getMutationCache().getAll().at(-1)?.state.variables,
    ).toEqual({
      recordId: 41,
      source: { vaultId: "vault-1", contactId: "contact-1" },
      listQueryKey: ["vaults", "vault-1", "contacts", "contact-1", "documents"],
    });
  });

  it("waits for the held document Feed invalidation before delete success", async () => {
    const mediaApiMocks = getMediaApiMocks();
    const mediaMessageMocks = getMediaMessageMocks();
    const heldInvalidation = createDeferred<void>();
    const heldQueryKey = ["vaults", "vault-1", "contacts", "contact-1", "feed"];
    mediaApiMocks.contactDocuments.contactsDocumentsList.mockResolvedValue({
      data: [
        {
          id: 41,
          name: "passport.pdf",
          mime_type: "application/pdf",
          size: 24,
        },
      ],
      meta: { page: 1, per_page: 15, total: 1, total_pages: 1 },
    });
    const { invalidateQueries } = renderDocumentsModule();
    invalidateQueries.mockImplementation((filters) =>
      JSON.stringify(filters?.queryKey) === JSON.stringify(heldQueryKey)
        ? heldInvalidation.promise
        : Promise.resolve(),
    );
    await screen.findByText("passport.pdf");

    await confirmVisibleDelete();

    await waitFor(() => {
      expect(invalidatedKeys(invalidateQueries)).toContainEqual(heldQueryKey);
    });
    expect(mediaMessageMocks.success).not.toHaveBeenCalled();

    await act(async () => {
      heldInvalidation.resolve(undefined);
      await heldInvalidation.promise;
    });

    await waitFor(() => {
      expect(mediaMessageMocks.success).toHaveBeenCalledWith(
        "Document deleted",
      );
    });
  });
});
