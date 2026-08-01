import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  confirmVisibleDelete,
  createDeferred,
  getMediaApiMocks,
  getMediaMessageMocks,
  invalidatedKeys,
  renderPhotosModule,
  setupContactMediaMocks,
} from "./mediaFeedInvalidationTestHarness";

describe("PhotosModule Feed invalidation", () => {
  beforeEach(setupContactMediaMocks);

  it("refreshes the photo list after upload completion", async () => {
    const { invalidateQueries } = renderPhotosModule();

    await userEvent.click(
      await screen.findByRole("button", { name: "Start upload" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Finish upload" }),
    );

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["vaults", "vault-1", "contacts", "contact-1", "photos"],
      });
    });
  });

  it("invalidates the Feed scope captured when a photo upload starts", async () => {
    const { invalidateQueries, rerenderScope } = renderPhotosModule();

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
      ["vaults", "vault-1", "contacts", "contact-1", "photos"],
      ["vaults", "vault-1", "feed"],
      ["vaults", "vault-1", "contacts", "contact-1", "feed"],
    ]);
  });

  it("invalidates the photo list and exact Feed scopes after delete", async () => {
    const mediaApiMocks = getMediaApiMocks();
    mediaApiMocks.contactPhotos.contactsPhotosList.mockResolvedValue({
      data: [
        { id: 31, name: "portrait.jpg", mime_type: "image/jpeg", size: 12 },
      ],
      meta: { page: 1, per_page: 30, total: 1, total_pages: 1 },
    });
    const { invalidateQueries } = renderPhotosModule();
    await waitFor(() => {
      expect(
        document.querySelector('[data-source-record="File:31"]'),
      ).toBeInTheDocument();
    });

    await confirmVisibleDelete();

    await waitFor(() => {
      expect(
        mediaApiMocks.contactPhotos.contactsPhotosDelete,
      ).toHaveBeenCalledWith("vault-1", "contact-1", 31);
    });
    expect(invalidatedKeys(invalidateQueries)).toEqual([
      ["vaults", "vault-1", "contacts", "contact-1", "photos"],
      ["vaults", "vault-1", "feed"],
      ["vaults", "vault-1", "contacts", "contact-1", "feed"],
    ]);
  });

  it("freezes the deleted photo and source route before rerender", async () => {
    const mediaApiMocks = getMediaApiMocks();
    const deleteCompletion = createDeferred<void>();
    mediaApiMocks.contactPhotos.contactsPhotosList.mockResolvedValue({
      data: [
        { id: 31, name: "portrait.jpg", mime_type: "image/jpeg", size: 12 },
      ],
      meta: { page: 1, per_page: 30, total: 1, total_pages: 1 },
    });
    mediaApiMocks.contactPhotos.contactsPhotosDelete.mockReturnValue(
      deleteCompletion.promise,
    );
    const { invalidateQueries, queryClient, rerenderScope } =
      renderPhotosModule();
    await waitFor(() => {
      expect(
        document.querySelector('[data-source-record="File:31"]'),
      ).toBeInTheDocument();
    });

    await confirmVisibleDelete();
    await waitFor(() => {
      expect(
        mediaApiMocks.contactPhotos.contactsPhotosDelete,
      ).toHaveBeenCalledWith("vault-1", "contact-1", 31);
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
        ["vaults", "vault-1", "contacts", "contact-1", "photos"],
        ["vaults", "vault-1", "feed"],
        ["vaults", "vault-1", "contacts", "contact-1", "feed"],
      ]);
    });
    expect(
      queryClient.getMutationCache().getAll().at(-1)?.state.variables,
    ).toEqual({
      recordId: 31,
      source: { vaultId: "vault-1", contactId: "contact-1" },
      listQueryKey: ["vaults", "vault-1", "contacts", "contact-1", "photos"],
    });
  });

  it("waits for the held photo Feed invalidation before delete success", async () => {
    const mediaApiMocks = getMediaApiMocks();
    const mediaMessageMocks = getMediaMessageMocks();
    const heldInvalidation = createDeferred<void>();
    const heldQueryKey = ["vaults", "vault-1", "contacts", "contact-1", "feed"];
    mediaApiMocks.contactPhotos.contactsPhotosList.mockResolvedValue({
      data: [
        { id: 31, name: "portrait.jpg", mime_type: "image/jpeg", size: 12 },
      ],
      meta: { page: 1, per_page: 30, total: 1, total_pages: 1 },
    });
    const { invalidateQueries } = renderPhotosModule();
    invalidateQueries.mockImplementation((filters) =>
      JSON.stringify(filters?.queryKey) === JSON.stringify(heldQueryKey)
        ? heldInvalidation.promise
        : Promise.resolve(),
    );
    await waitFor(() => {
      expect(
        document.querySelector('[data-source-record="File:31"]'),
      ).toBeInTheDocument();
    });

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
      expect(mediaMessageMocks.success).toHaveBeenCalledWith("Media deleted");
    });
  });
});
