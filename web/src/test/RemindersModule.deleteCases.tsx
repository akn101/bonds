import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockReminders } from "./remindersModuleTestFixtures";
import {
  apiMock,
  appMessageMock,
  completePendingDelete,
  createDeferred,
  expectInvalidatedKeys,
  holdReminderInvalidation,
  mutationMock,
  reminderDeleteKeys,
  renderRemindersModule,
  setReminderQueryResult,
} from "./remindersModuleTestHarness";

async function submitDelete(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "delete" }));
  await user.click(await screen.findByRole("button", { name: /ok/i }));
  await waitFor(() =>
    expect(apiMock.reminders.contactsRemindersDelete).toHaveBeenCalled(),
  );
}

describe("RemindersModule delete mutations", () => {
  it("invalidates Reminder, Calendar, and Feed prefixes when delete succeeds", async () => {
    setReminderQueryResult({ data: [mockReminders[0]], isLoading: false });
    renderRemindersModule({ vaultId: 101, contactId: 202 });

    await submitDelete();
    await completePendingDelete();

    expectInvalidatedKeys(reminderDeleteKeys);
    expect(appMessageMock.success).toHaveBeenCalledWith("Reminder deleted");
  });

  it.each(
    reminderDeleteKeys.map(
      (queryKey) => [queryKey.join(" / "), queryKey] as const,
    ),
  )(
    "waits for delete invalidation %s before reporting success",
    async (_queryName, heldQueryKey) => {
      // Given
      const invalidationCompletion = createDeferred<void>();
      holdReminderInvalidation(heldQueryKey, invalidationCompletion);
      setReminderQueryResult({ data: [mockReminders[0]], isLoading: false });
      renderRemindersModule({ vaultId: 101, contactId: 202 });

      // When
      await submitDelete();
      const pendingCompletion = completePendingDelete();

      // Then
      await waitFor(() =>
        expect(mutationMock.invalidateQueries).toHaveBeenCalledTimes(
          reminderDeleteKeys.length,
        ),
      );
      expectInvalidatedKeys(reminderDeleteKeys);
      expect(appMessageMock.success).not.toHaveBeenCalled();

      invalidationCompletion.resolve(undefined);
      await pendingCompletion;

      expect(appMessageMock.success).toHaveBeenCalledWith("Reminder deleted");
    },
  );

  it("does not invalidate or report delete success when the API rejects", async () => {
    // Given
    const requestCompletion = createDeferred<unknown>();
    apiMock.reminders.contactsRemindersDelete.mockReturnValue(
      requestCompletion.promise,
    );
    setReminderQueryResult({ data: [mockReminders[0]], isLoading: false });
    renderRemindersModule({ vaultId: 101, contactId: 202 });

    // When
    await submitDelete();
    const pendingCompletion = completePendingDelete();
    requestCompletion.reject(new Error("delete rejected"));
    await pendingCompletion;

    // Then
    expect(mutationMock.invalidateQueries).not.toHaveBeenCalled();
    expect(appMessageMock.success).not.toHaveBeenCalled();
    expect(appMessageMock.error).toHaveBeenCalledWith("delete rejected");
  });

  it("keeps delete routing and invalidation scoped to the submitted contact after rerender", async () => {
    setReminderQueryResult({ data: [mockReminders[0]], isLoading: false });
    const { rerenderModule } = renderRemindersModule({
      vaultId: 101,
      contactId: 202,
    });

    await submitDelete();
    rerenderModule({ vaultId: 404, contactId: 505 });
    await completePendingDelete();

    expect(apiMock.reminders.contactsRemindersDelete).toHaveBeenCalledWith(
      "101",
      "202",
      1,
    );
    expect(mutationMock.deleteExecution).toHaveBeenCalledWith({
      kind: "delete",
      source: { vaultId: "101", contactId: "202" },
      listQueryKey: ["vaults", "101", "contacts", "202", "reminders"],
      affectedScopes: {
        vaultIds: ["101"],
        contacts: [{ vaultId: "101", contactId: "202" }],
      },
      id: 1,
    });
    expectInvalidatedKeys(reminderDeleteKeys);
  });
});
