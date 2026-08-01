import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockReminders } from "./remindersModuleTestFixtures";
import {
  apiMock,
  appMessageMock,
  completePendingSave,
  createDeferred,
  expectInvalidatedKeys,
  holdReminderInvalidation,
  mutationMock,
  reminderAndCalendarKeys,
  reminderCreateKeys,
  renderRemindersModule,
  setReminderQueryResult,
} from "./remindersModuleTestHarness";

async function submitReminderCreate(label: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByText("Add"));
  await user.type(
    await screen.findByRole("textbox", { name: /label/i }),
    label,
  );
  await user.click(screen.getByTestId("reminder-full-date"));
  await user.click(screen.getByRole("combobox", { name: /frequency/i }));
  await user.click(await screen.findByTitle("Yearly"));
  await user.click(screen.getByRole("button", { name: /ok|save/i }));
  await waitFor(() =>
    expect(apiMock.reminders.contactsRemindersCreate).toHaveBeenCalled(),
  );
}

async function submitReminderUpdate(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "edit" }));
  await user.click(screen.getByRole("button", { name: /ok|save/i }));
  await waitFor(() =>
    expect(apiMock.reminders.contactsRemindersUpdate).toHaveBeenCalled(),
  );
}

type PendingSaveExpectation = {
  readonly heldQueryKey: readonly unknown[];
  readonly expectedQueryKeys: readonly (readonly unknown[])[];
  readonly formValue: string;
  readonly successMessage: string;
};

async function expectSaveBlockedByInvalidation({
  heldQueryKey,
  expectedQueryKeys,
  formValue,
  successMessage,
}: PendingSaveExpectation): Promise<void> {
  const invalidationCompletion = createDeferred<void>();
  holdReminderInvalidation(heldQueryKey, invalidationCompletion);

  const pendingCompletion = completePendingSave();
  await waitFor(() =>
    expect(mutationMock.invalidateQueries).toHaveBeenCalledTimes(
      expectedQueryKeys.length,
    ),
  );
  expectInvalidatedKeys(expectedQueryKeys);
  expect(screen.getByDisplayValue(formValue)).toBeInTheDocument();
  expect(appMessageMock.success).not.toHaveBeenCalled();

  invalidationCompletion.resolve(undefined);
  await pendingCompletion;

  expect(screen.queryByDisplayValue(formValue)).not.toBeInTheDocument();
  expect(appMessageMock.success).toHaveBeenCalledWith(successMessage);
}

describe("RemindersModule mutation contracts", () => {
  it.each(
    reminderCreateKeys.map(
      (queryKey) => [queryKey.join(" / "), queryKey] as const,
    ),
  )(
    "waits for create invalidation %s before closing and reporting success",
    async (_queryName, heldQueryKey) => {
      // Given
      renderRemindersModule({ vaultId: 101, contactId: 202 });

      // When
      await submitReminderCreate("Pending Reminder");

      // Then
      await expectSaveBlockedByInvalidation({
        heldQueryKey,
        expectedQueryKeys: reminderCreateKeys,
        formValue: "Pending Reminder",
        successMessage: "Reminder added",
      });
    },
  );

  it("does not invalidate or report create success when the API rejects", async () => {
    // Given
    const requestCompletion = createDeferred<unknown>();
    apiMock.reminders.contactsRemindersCreate.mockReturnValue(
      requestCompletion.promise,
    );
    renderRemindersModule({ vaultId: 101, contactId: 202 });

    // When
    await submitReminderCreate("Rejected Reminder");
    const pendingCompletion = completePendingSave();
    requestCompletion.reject(new Error("create rejected"));
    await pendingCompletion;

    // Then
    expect(mutationMock.invalidateQueries).not.toHaveBeenCalled();
    expect(appMessageMock.success).not.toHaveBeenCalled();
    expect(appMessageMock.error).toHaveBeenCalledWith("create rejected");
    expect(screen.getByDisplayValue("Rejected Reminder")).toBeInTheDocument();
  });

  it.each(
    reminderAndCalendarKeys.map(
      (queryKey) => [queryKey.join(" / "), queryKey] as const,
    ),
  )(
    "waits for update invalidation %s before closing and reporting success",
    async (_queryName, heldQueryKey) => {
      // Given
      setReminderQueryResult({ data: [mockReminders[0]], isLoading: false });
      renderRemindersModule({ vaultId: 101, contactId: 202 });

      // When
      await submitReminderUpdate();

      // Then
      await expectSaveBlockedByInvalidation({
        heldQueryKey,
        expectedQueryKeys: reminderAndCalendarKeys,
        formValue: "Call Mom",
        successMessage: "Reminder updated",
      });
    },
  );

  it("does not invalidate or report update success when the API rejects", async () => {
    // Given
    const requestCompletion = createDeferred<unknown>();
    setReminderQueryResult({ data: [mockReminders[0]], isLoading: false });
    apiMock.reminders.contactsRemindersUpdate.mockReturnValue(
      requestCompletion.promise,
    );
    renderRemindersModule({ vaultId: 101, contactId: 202 });

    // When
    await submitReminderUpdate();
    const pendingCompletion = completePendingSave();
    requestCompletion.reject(new Error("update rejected"));
    await pendingCompletion;

    // Then
    expect(mutationMock.invalidateQueries).not.toHaveBeenCalled();
    expect(appMessageMock.success).not.toHaveBeenCalled();
    expect(appMessageMock.error).toHaveBeenCalledWith("update rejected");
    expect(screen.getByDisplayValue("Call Mom")).toBeInTheDocument();
  });
});
