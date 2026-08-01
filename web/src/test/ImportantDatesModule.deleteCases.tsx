import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  apiMock,
  appMessageMock,
  completePendingDelete,
  invalidateQueriesMock,
  mockDates,
  mutationMock,
  renderImportantDatesModule,
} from "./importantDatesModuleTestHarness";
import {
  calendarAndReminderKeys,
  createDeferred,
  expectImportantDateInvalidatedKeys,
  holdImportantDateInvalidation,
} from "./importantDatesMutationTestSupport";

async function submitImportantDateDelete(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "delete" }));
  await user.click(await screen.findByRole("button", { name: /ok/i }));
  await waitFor(() => expect(apiMock.contactsDatesDelete).toHaveBeenCalled());
}

describe("ImportantDatesModule delete mutations", () => {
  it("invalidates Calendar and Reminder prefixes without Feed when delete succeeds", async () => {
    renderImportantDatesModule({
      vaultId: 101,
      contactId: 202,
      datesReturn: { data: [mockDates[0]], isLoading: false },
    });

    await submitImportantDateDelete();
    await completePendingDelete();

    expectImportantDateInvalidatedKeys();
    expect(appMessageMock.success).toHaveBeenCalledWith("Date deleted");
  });

  it.each(
    calendarAndReminderKeys.map(
      (queryKey) => [queryKey.join(" / "), queryKey] as const,
    ),
  )(
    "waits for delete invalidation %s before reporting success",
    async (_queryName, heldQueryKey) => {
      // Given
      const invalidationCompletion = createDeferred<void>();
      holdImportantDateInvalidation(heldQueryKey, invalidationCompletion);
      renderImportantDatesModule({
        vaultId: 101,
        contactId: 202,
        datesReturn: { data: [mockDates[0]], isLoading: false },
      });

      // When
      await submitImportantDateDelete();
      const pendingCompletion = completePendingDelete();

      // Then
      await waitFor(() =>
        expect(invalidateQueriesMock).toHaveBeenCalledTimes(
          calendarAndReminderKeys.length,
        ),
      );
      expectImportantDateInvalidatedKeys();
      expect(appMessageMock.success).not.toHaveBeenCalled();

      invalidationCompletion.resolve(undefined);
      await pendingCompletion;

      expect(appMessageMock.success).toHaveBeenCalledWith("Date deleted");
    },
  );

  it("does not invalidate or report delete success when the API rejects", async () => {
    // Given
    const requestCompletion = createDeferred<unknown>();
    apiMock.contactsDatesDelete.mockReturnValue(requestCompletion.promise);
    renderImportantDatesModule({
      vaultId: 101,
      contactId: 202,
      datesReturn: { data: [mockDates[0]], isLoading: false },
    });

    // When
    await submitImportantDateDelete();
    const pendingCompletion = completePendingDelete();
    requestCompletion.reject(new Error("delete rejected"));
    await pendingCompletion;

    // Then
    expect(invalidateQueriesMock).not.toHaveBeenCalled();
    expect(appMessageMock.success).not.toHaveBeenCalled();
    expect(appMessageMock.error).toHaveBeenCalledWith("delete rejected");
  });

  it("keeps delete routing and invalidation scoped to the submitted contact after rerender", async () => {
    const { rerenderModule } = renderImportantDatesModule({
      vaultId: 101,
      contactId: 202,
      datesReturn: { data: [mockDates[0]], isLoading: false },
    });

    await submitImportantDateDelete();
    rerenderModule({ vaultId: 404, contactId: 505 });
    await completePendingDelete();

    expect(apiMock.contactsDatesDelete).toHaveBeenCalledWith("101", "202", 1);
    expect(mutationMock.deleteExecution).toHaveBeenCalledWith({
      kind: "delete",
      source: { vaultId: "101", contactId: "202" },
      listQueryKey: ["vaults", "101", "contacts", "202", "important-dates"],
      affectedScopes: {
        vaultIds: ["101"],
        contacts: [{ vaultId: "101", contactId: "202" }],
      },
      id: 1,
    });
    expectImportantDateInvalidatedKeys();
  });
});
