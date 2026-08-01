import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  confirmQuickFactDelete,
  createDeferred,
  emptyTextGroup,
  getQuickFactsApiMocks,
  invalidatedKeys,
  renderQuickFacts,
  setupQuickFactsMocks,
  textGroup,
} from "./quickFactsFeedInvalidationTestHarness";

describe("QuickFactsModule scalar Feed invalidation", () => {
  beforeEach(setupQuickFactsMocks);

  it("does not invalidate Feed after scalar create", async () => {
    const quickFactsApiMocks = getQuickFactsApiMocks();
    quickFactsApiMocks.quickFacts.contactsQuickFactsList.mockResolvedValue({
      data: emptyTextGroup,
    });
    const { invalidateQueries } = renderQuickFacts();
    await userEvent.click(await screen.findByRole("button", { name: /Add/ }));
    await userEvent.type(
      screen.getByPlaceholderText("Add a quick fact"),
      "Sushi",
    );

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(
        quickFactsApiMocks.quickFacts.contactsQuickFactsCreate,
      ).toHaveBeenCalled();
    });

    expect(invalidatedKeys(invalidateQueries)).toEqual([
      ["vaults", "vault-1", "contacts", "contact-1", "quickFacts"],
    ]);
  });

  it("does not invalidate Feed after scalar update", async () => {
    const quickFactsApiMocks = getQuickFactsApiMocks();
    quickFactsApiMocks.quickFacts.contactsQuickFactsList.mockResolvedValue({
      data: textGroup,
    });
    const { invalidateQueries } = renderQuickFacts();
    await screen.findByText("Pizza");
    await userEvent.click(screen.getByRole("button", { name: "edit" }));
    const input = screen.getByPlaceholderText("Add a quick fact");
    await userEvent.clear(input);
    await userEvent.type(input, "Sushi");

    await userEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => {
      expect(
        quickFactsApiMocks.quickFacts.contactsQuickFactsUpdate,
      ).toHaveBeenCalled();
    });

    expect(invalidatedKeys(invalidateQueries)).toEqual([
      ["vaults", "vault-1", "contacts", "contact-1", "quickFacts"],
    ]);
  });

  it("does not invalidate Feed after scalar delete", async () => {
    const quickFactsApiMocks = getQuickFactsApiMocks();
    const pendingListInvalidation = createDeferred<void>();
    quickFactsApiMocks.quickFacts.contactsQuickFactsList.mockResolvedValue({
      data: textGroup,
    });
    const { invalidateQueries, queryClient } = renderQuickFacts();
    invalidateQueries.mockReturnValue(pendingListInvalidation.promise);
    await screen.findByText("Pizza");

    await confirmQuickFactDelete();
    await waitFor(() => {
      expect(
        quickFactsApiMocks.quickFacts.contactsQuickFactsDelete,
      ).toHaveBeenCalled();
    });

    expect(invalidatedKeys(invalidateQueries)).toEqual([
      ["vaults", "vault-1", "contacts", "contact-1", "quickFacts"],
    ]);
    expect(queryClient.isMutating()).toBe(1);

    await act(async () => {
      pendingListInvalidation.resolve(undefined);
      await pendingListInvalidation.promise;
    });
    await waitFor(() => {
      expect(queryClient.isMutating()).toBe(0);
    });
  });

  it("does not invalidate Feed after quick-fact visibility toggle", async () => {
    const quickFactsApiMocks = getQuickFactsApiMocks();
    quickFactsApiMocks.quickFacts.contactsQuickFactsList.mockResolvedValue({
      data: textGroup,
    });
    const { invalidateQueries } = renderQuickFacts();
    await screen.findByText("Pizza");
    const toggleButton = document.querySelector<HTMLButtonElement>(
      ".ant-card-extra button",
    );
    if (toggleButton === null) {
      throw new Error("expected a quick fact visibility toggle");
    }

    await userEvent.click(toggleButton);
    await waitFor(() => {
      expect(
        quickFactsApiMocks.quickFacts.contactsQuickFactsToggleUpdate,
      ).toHaveBeenCalled();
    });

    expect(invalidatedKeys(invalidateQueries)).toEqual([]);
  });
});
