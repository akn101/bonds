import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  apiMock,
  appMessageMock,
  completePendingSave,
  invalidateQueriesMock,
  mockDates,
  renderImportantDatesModule,
} from "./importantDatesModuleTestHarness";
import {
  calendarAndReminderKeys,
  createDeferred,
  expectImportantDateInvalidatedKeys,
  holdImportantDateInvalidation,
} from "./importantDatesMutationTestSupport";

async function submitImportantDateCreate(label: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByText("Add"));
  await user.type(screen.getByRole("textbox", { name: /label/i }), label);
  await user.click(screen.getByRole("button", { name: /ok|save/i }));
  await waitFor(() => expect(apiMock.contactsDatesCreate).toHaveBeenCalled());
}

async function submitImportantDateUpdate(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "edit" }));
  await user.click(screen.getByRole("button", { name: /ok|save/i }));
  await waitFor(() => expect(apiMock.contactsDatesUpdate).toHaveBeenCalled());
}

type PendingSaveExpectation = {
  readonly heldQueryKey: readonly unknown[];
  readonly formValue: string;
  readonly successMessage: string;
};

async function expectSaveBlockedByInvalidation({
  heldQueryKey,
  formValue,
  successMessage,
}: PendingSaveExpectation): Promise<void> {
  const invalidationCompletion = createDeferred<void>();
  holdImportantDateInvalidation(heldQueryKey, invalidationCompletion);

  const pendingCompletion = completePendingSave();
  await waitFor(() =>
    expect(invalidateQueriesMock).toHaveBeenCalledTimes(
      calendarAndReminderKeys.length,
    ),
  );
  expectImportantDateInvalidatedKeys();
  expect(screen.getByDisplayValue(formValue)).toBeInTheDocument();
  expect(appMessageMock.success).not.toHaveBeenCalled();

  invalidationCompletion.resolve(undefined);
  await pendingCompletion;

  expect(screen.queryByDisplayValue(formValue)).not.toBeInTheDocument();
  expect(appMessageMock.success).toHaveBeenCalledWith(successMessage);
}

describe("ImportantDatesModule mutation contracts", () => {
  it.each(
    calendarAndReminderKeys.map(
      (queryKey) => [queryKey.join(" / "), queryKey] as const,
    ),
  )(
    "waits for create invalidation %s before closing and reporting success",
    async (_queryName, heldQueryKey) => {
      // Given
      renderImportantDatesModule({ vaultId: 101, contactId: 202 });

      // When
      await submitImportantDateCreate("Pending Date");

      // Then
      await expectSaveBlockedByInvalidation({
        heldQueryKey,
        formValue: "Pending Date",
        successMessage: "Date added",
      });
    },
  );

  it("does not invalidate or report create success when the API rejects", async () => {
    // Given
    const requestCompletion = createDeferred<unknown>();
    apiMock.contactsDatesCreate.mockReturnValue(requestCompletion.promise);
    renderImportantDatesModule({ vaultId: 101, contactId: 202 });

    // When
    await submitImportantDateCreate("Rejected Date");
    const pendingCompletion = completePendingSave();
    requestCompletion.reject(new Error("create rejected"));
    await pendingCompletion;

    // Then
    expect(invalidateQueriesMock).not.toHaveBeenCalled();
    expect(appMessageMock.success).not.toHaveBeenCalled();
    expect(appMessageMock.error).toHaveBeenCalledWith("create rejected");
    expect(screen.getByDisplayValue("Rejected Date")).toBeInTheDocument();
  });

  it.each(
    calendarAndReminderKeys.map(
      (queryKey) => [queryKey.join(" / "), queryKey] as const,
    ),
  )(
    "waits for update invalidation %s before closing and reporting success",
    async (_queryName, heldQueryKey) => {
      // Given
      renderImportantDatesModule({
        vaultId: 101,
        contactId: 202,
        datesReturn: { data: [mockDates[0]], isLoading: false },
      });

      // When
      await submitImportantDateUpdate();

      // Then
      await expectSaveBlockedByInvalidation({
        heldQueryKey,
        formValue: "Birthday",
        successMessage: "Date updated",
      });
    },
  );

  it("does not invalidate or report update success when the API rejects", async () => {
    // Given
    const requestCompletion = createDeferred<unknown>();
    apiMock.contactsDatesUpdate.mockReturnValue(requestCompletion.promise);
    renderImportantDatesModule({
      vaultId: 101,
      contactId: 202,
      datesReturn: { data: [mockDates[0]], isLoading: false },
    });

    // When
    await submitImportantDateUpdate();
    const pendingCompletion = completePendingSave();
    requestCompletion.reject(new Error("update rejected"));
    await pendingCompletion;

    // Then
    expect(invalidateQueriesMock).not.toHaveBeenCalled();
    expect(appMessageMock.success).not.toHaveBeenCalled();
    expect(appMessageMock.error).toHaveBeenCalledWith("update rejected");
    expect(screen.getByDisplayValue("Birthday")).toBeInTheDocument();
  });
});
