import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockReminders } from "./remindersModuleTestFixtures";
import {
  apiMock,
  appMessageMock,
  completePendingSave,
  expectInvalidatedKeys,
  mutationMock,
  reminderAndCalendarKeys,
  reminderCreateKeys,
  renderRemindersModule,
  setReminderQueryResult,
} from "./remindersModuleTestHarness";

async function submitReminder(label: string): Promise<void> {
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

describe("RemindersModule save mutations", () => {
  it("invalidates Reminder, Calendar, and Feed prefixes when create succeeds", async () => {
    const expectedKey = [
      "vaults",
      "101",
      "contacts",
      "202",
      "reminders",
    ] as const;
    renderRemindersModule({ vaultId: 101, contactId: 202 });

    expect(mutationMock.queryKey).toHaveBeenCalledWith(expectedKey);
    await submitReminder("New Reminder");
    await completePendingSave();

    expect(mutationMock.saveExecution).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "create" }),
    );
    expectInvalidatedKeys(reminderCreateKeys);
    expect(appMessageMock.success).toHaveBeenCalledWith("Reminder added");
  });

  it("keeps create routing and invalidation scoped to the submitted contact after rerender", async () => {
    const { rerenderModule } = renderRemindersModule({
      vaultId: 101,
      contactId: 202,
    });

    await submitReminder("Original Contact Reminder");
    rerenderModule({ vaultId: 404, contactId: 505 });
    await completePendingSave();

    expect(apiMock.reminders.contactsRemindersCreate).toHaveBeenCalledWith(
      "101",
      "202",
      expect.objectContaining({ label: "Original Contact Reminder" }),
    );
    expect(mutationMock.saveExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { vaultId: "101", contactId: "202" },
        listQueryKey: ["vaults", "101", "contacts", "202", "reminders"],
        affectedScopes: {
          vaultIds: ["101"],
          contacts: [{ vaultId: "101", contactId: "202" }],
        },
      }),
    );
    expectInvalidatedKeys(reminderCreateKeys);
  });

  it("keeps an update operation after cancellation rerenders pending save options", async () => {
    const user = userEvent.setup();
    let resolveUpdate: (() => void) | undefined;
    setReminderQueryResult({ data: [mockReminders[0]], isLoading: false });
    apiMock.reminders.contactsRemindersUpdate.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = () => resolve({ data: {} });
        }),
    );
    renderRemindersModule({ vaultId: 101, contactId: 202 });

    await user.click(screen.getByRole("button", { name: "edit" }));
    await user.click(screen.getByRole("button", { name: /ok|save/i }));
    await waitFor(() =>
      expect(apiMock.reminders.contactsRemindersUpdate).toHaveBeenCalled(),
    );
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    if (resolveUpdate === undefined) {
      throw new Error("expected the reminder update request to be pending");
    }
    resolveUpdate();
    await completePendingSave();

    expectInvalidatedKeys(reminderAndCalendarKeys);
    expect(appMessageMock.success).toHaveBeenCalledWith("Reminder updated");
    expect(mutationMock.saveExecution).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "update", id: 1 }),
    );
  });

  it("keeps update routing and invalidation scoped to the submitted contact after rerender", async () => {
    const user = userEvent.setup();
    let resolveUpdate: (() => void) | undefined;
    setReminderQueryResult({ data: [mockReminders[0]], isLoading: false });
    apiMock.reminders.contactsRemindersUpdate.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = () => resolve({ data: {} });
        }),
    );
    const { rerenderModule } = renderRemindersModule({
      vaultId: 101,
      contactId: 202,
    });

    await user.click(screen.getByRole("button", { name: "edit" }));
    await user.click(screen.getByRole("button", { name: /ok|save/i }));
    await waitFor(() =>
      expect(apiMock.reminders.contactsRemindersUpdate).toHaveBeenCalled(),
    );
    rerenderModule({ vaultId: 404, contactId: 505 });

    if (resolveUpdate === undefined) {
      throw new Error("expected the reminder update request to be pending");
    }
    resolveUpdate();
    await completePendingSave();

    expect(apiMock.reminders.contactsRemindersUpdate).toHaveBeenCalledWith(
      "101",
      "202",
      1,
      expect.any(Object),
    );
    expectInvalidatedKeys(reminderAndCalendarKeys);
  });
});
