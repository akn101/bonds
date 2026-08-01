import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  confirmQuickFactDelete,
  createDeferred,
  documentGroup,
  emptyPhotoGroup,
  getQuickFactsApiMocks,
  invalidatedKeys,
  renderQuickFacts,
  setupQuickFactsMocks,
  uploadQuickFactFile,
} from "./quickFactsFeedInvalidationTestHarness";

describe("QuickFactsModule file Feed invalidation", () => {
  beforeEach(setupQuickFactsMocks);

  it("refreshes the quick-fact list after file create succeeds", async () => {
    const quickFactsApiMocks = getQuickFactsApiMocks();
    quickFactsApiMocks.quickFacts.contactsQuickFactsList.mockResolvedValue({
      data: emptyPhotoGroup,
    });
    const { invalidateQueries } = renderQuickFacts();
    await userEvent.click(await screen.findByRole("button", { name: /Add/ }));

    await uploadQuickFactFile(
      new File(["image"], "portrait.jpg", { type: "image/jpeg" }),
    );

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["vaults", "vault-1", "contacts", "contact-1", "quickFacts"],
      });
    });
  });

  it("refreshes the quick-fact list after file replacement succeeds", async () => {
    const quickFactsApiMocks = getQuickFactsApiMocks();
    quickFactsApiMocks.quickFacts.contactsQuickFactsList.mockResolvedValue({
      data: documentGroup,
    });
    const { invalidateQueries } = renderQuickFacts();
    await screen.findByText("passport.pdf");
    await userEvent.click(screen.getByRole("button", { name: "edit" }));

    await uploadQuickFactFile(
      new File(["replacement"], "replacement.pdf", {
        type: "application/pdf",
      }),
    );

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["vaults", "vault-1", "contacts", "contact-1", "quickFacts"],
      });
    });
  });

  it("invalidates the Feed scope carried by a file-create mutation", async () => {
    const quickFactsApiMocks = getQuickFactsApiMocks();
    const pendingCreate = createDeferred<{ data: { id: number } }>();
    quickFactsApiMocks.quickFacts.contactsQuickFactsList.mockResolvedValue({
      data: emptyPhotoGroup,
    });
    quickFactsApiMocks.quickFacts.contactsQuickFactsFileCreate.mockReturnValue(
      pendingCreate.promise,
    );
    const { invalidateQueries, rerenderScope } = renderQuickFacts();
    await userEvent.click(await screen.findByRole("button", { name: /Add/ }));
    await uploadQuickFactFile(
      new File(["image"], "portrait.jpg", { type: "image/jpeg" }),
    );
    await waitFor(() => {
      expect(
        quickFactsApiMocks.quickFacts.contactsQuickFactsFileCreate,
      ).toHaveBeenCalled();
    });
    rerenderScope({ vaultId: "vault-2", contactId: "contact-2" });

    await act(async () => {
      pendingCreate.resolve({ data: { id: 201 } });
      await pendingCreate.promise;
    });

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["vaults", "vault-1", "feed"],
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["vaults", "vault-1", "contacts", "contact-1", "feed"],
      });
    });
    expect(invalidatedKeys(invalidateQueries)).toEqual([
      ["vaults", "vault-1", "contacts", "contact-1", "quickFacts"],
      ["vaults", "vault-1", "feed"],
      ["vaults", "vault-1", "contacts", "contact-1", "feed"],
    ]);
  });

  it("invalidates Feed after a quick-fact file replacement", async () => {
    const quickFactsApiMocks = getQuickFactsApiMocks();
    quickFactsApiMocks.quickFacts.contactsQuickFactsList.mockResolvedValue({
      data: documentGroup,
    });
    const { invalidateQueries } = renderQuickFacts();
    await screen.findByText("passport.pdf");
    await userEvent.click(screen.getByRole("button", { name: "edit" }));

    await uploadQuickFactFile(
      new File(["replacement"], "replacement.pdf", {
        type: "application/pdf",
      }),
    );

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["vaults", "vault-1", "feed"],
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["vaults", "vault-1", "contacts", "contact-1", "feed"],
      });
    });
  });

  it("keeps file delete scoped to its initiating route until list and Feed invalidations finish", async () => {
    const quickFactsApiMocks = getQuickFactsApiMocks();
    const pendingDelete = createDeferred<void>();
    const pendingListInvalidation = createDeferred<void>();
    const pendingVaultFeedInvalidation = createDeferred<void>();
    const pendingContactFeedInvalidation = createDeferred<void>();
    quickFactsApiMocks.quickFacts.contactsQuickFactsList.mockResolvedValue({
      data: documentGroup,
    });
    quickFactsApiMocks.quickFacts.contactsQuickFactsDelete.mockReturnValue(
      pendingDelete.promise,
    );
    const { invalidateQueries, queryClient, rerenderScope } =
      renderQuickFacts();
    invalidateQueries
      .mockImplementationOnce((filters) => {
        expect(filters).toEqual({
          queryKey: [
            "vaults",
            "vault-1",
            "contacts",
            "contact-1",
            "quickFacts",
          ],
        });
        return pendingListInvalidation.promise;
      })
      .mockImplementationOnce((filters) => {
        expect(filters).toEqual({
          queryKey: ["vaults", "vault-1", "feed"],
        });
        return pendingVaultFeedInvalidation.promise;
      })
      .mockImplementationOnce((filters) => {
        expect(filters).toEqual({
          queryKey: ["vaults", "vault-1", "contacts", "contact-1", "feed"],
        });
        return pendingContactFeedInvalidation.promise;
      });
    await screen.findByText("passport.pdf");

    await confirmQuickFactDelete();
    await waitFor(() => {
      expect(
        quickFactsApiMocks.quickFacts.contactsQuickFactsDelete,
      ).toHaveBeenCalledWith("vault-1", "contact-1", 6, 16);
    });
    rerenderScope({ vaultId: "vault-2", contactId: "contact-2" });

    await act(async () => {
      pendingDelete.resolve(undefined);
      await pendingDelete.promise;
    });

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledTimes(3);
    });
    expect(invalidatedKeys(invalidateQueries)).toEqual([
      ["vaults", "vault-1", "contacts", "contact-1", "quickFacts"],
      ["vaults", "vault-1", "feed"],
      ["vaults", "vault-1", "contacts", "contact-1", "feed"],
    ]);
    expect(queryClient.isMutating()).toBe(1);

    await act(async () => {
      pendingListInvalidation.resolve(undefined);
      await pendingListInvalidation.promise;
    });
    expect(queryClient.isMutating()).toBe(1);

    await act(async () => {
      pendingVaultFeedInvalidation.resolve(undefined);
      await pendingVaultFeedInvalidation.promise;
    });
    expect(queryClient.isMutating()).toBe(1);

    await act(async () => {
      pendingContactFeedInvalidation.resolve(undefined);
      await pendingContactFeedInvalidation.promise;
    });
    await waitFor(() => {
      expect(queryClient.isMutating()).toBe(0);
    });
  });
});
