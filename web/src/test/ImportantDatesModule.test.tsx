import "./ImportantDatesModule.displayCases";
import "./ImportantDatesModule.payloadCases";
import "./ImportantDatesModule.deleteCases";
import "./ImportantDatesModule.mutationContractCases";
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  apiMock,
  appMessageMock,
  completePendingSave,
  invalidateQueriesMock,
  mockDates,
  mutationMock,
  queryKeyMock,
  renderImportantDatesModule,
} from "./importantDatesModuleTestHarness";
import {
  calendarAndReminderKeys,
  createDeferred,
  expectImportantDateInvalidatedKeys,
} from "./importantDatesMutationTestSupport";

describe("ImportantDatesModule targeted invalidation", () => {
  it("keeps create success feedback tied to the submitted operation", async () => {
    const expectedQueryKey = [
      "vaults",
      "101",
      "contacts",
      "202",
      "important-dates",
    ] as const;
    const user = userEvent.setup();
    renderImportantDatesModule({ vaultId: 101, contactId: 202 });

    expect(queryKeyMock).toHaveBeenCalledWith(expectedQueryKey);
    await user.click(screen.getByText("Add"));
    await user.type(
      screen.getByRole("textbox", { name: /label/i }),
      "New Date",
    );
    await user.click(screen.getByRole("button", { name: /ok|save/i }));
    await waitFor(() => expect(apiMock.contactsDatesCreate).toHaveBeenCalled());
    await completePendingSave();

    expect(mutationMock.saveExecution).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "create" }),
    );
    expectImportantDateInvalidatedKeys();
    expect(appMessageMock.success).toHaveBeenCalledWith("Date added");
  });

  it("waits for every create invalidation before closing and reporting success", async () => {
    const user = userEvent.setup();
    const invalidationCompletion = createDeferred<void>();
    invalidateQueriesMock.mockReturnValue(invalidationCompletion.promise);
    renderImportantDatesModule({ vaultId: 101, contactId: 202 });

    await user.click(screen.getByText("Add"));
    await user.type(
      screen.getByRole("textbox", { name: /label/i }),
      "Pending Date",
    );
    await user.click(screen.getByRole("button", { name: /ok|save/i }));
    await waitFor(() => expect(apiMock.contactsDatesCreate).toHaveBeenCalled());

    const pendingCompletion = completePendingSave();
    await waitFor(() =>
      expect(invalidateQueriesMock).toHaveBeenCalledTimes(
        calendarAndReminderKeys.length,
      ),
    );
    expect(screen.getByDisplayValue("Pending Date")).toBeInTheDocument();
    expect(appMessageMock.success).not.toHaveBeenCalled();

    invalidationCompletion.resolve(undefined);
    await pendingCompletion;

    expect(screen.queryByDisplayValue("Pending Date")).not.toBeInTheDocument();
    expect(appMessageMock.success).toHaveBeenCalledWith("Date added");
  });

  it("keeps create routing and invalidation scoped to the submitted contact after rerender", async () => {
    const user = userEvent.setup();
    const { rerenderModule } = renderImportantDatesModule({
      vaultId: 101,
      contactId: 202,
    });

    await user.click(screen.getByText("Add"));
    await user.type(
      screen.getByRole("textbox", { name: /label/i }),
      "Original Contact Date",
    );
    await user.click(screen.getByRole("button", { name: /ok|save/i }));
    await waitFor(() => expect(apiMock.contactsDatesCreate).toHaveBeenCalled());
    rerenderModule({ vaultId: 404, contactId: 505 });
    await completePendingSave();

    expect(apiMock.contactsDatesCreate).toHaveBeenCalledWith(
      "101",
      "202",
      expect.objectContaining({ label: "Original Contact Date" }),
    );
    expect(mutationMock.saveExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { vaultId: "101", contactId: "202" },
        listQueryKey: ["vaults", "101", "contacts", "202", "important-dates"],
        affectedScopes: {
          vaultIds: ["101"],
          contacts: [{ vaultId: "101", contactId: "202" }],
        },
      }),
    );
    expectImportantDateInvalidatedKeys();
  });

  it("keeps update success feedback tied to the submitted operation after cancellation", async () => {
    const user = userEvent.setup();
    let resolveUpdate: (() => void) | undefined;
    renderImportantDatesModule({
      vaultId: 101,
      contactId: 202,
      datesReturn: { data: [mockDates[0]], isLoading: false },
    });

    await user.click(screen.getByRole("button", { name: "edit" }));
    apiMock.contactsDatesUpdate.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = () => resolve({ data: {} });
        }),
    );
    await user.click(screen.getByRole("button", { name: /ok|save/i }));
    await waitFor(() => expect(apiMock.contactsDatesUpdate).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    if (resolveUpdate === undefined) {
      throw new Error(
        "expected the important date update request to be pending",
      );
    }
    resolveUpdate();
    await completePendingSave();

    expectImportantDateInvalidatedKeys();
    expect(appMessageMock.success).toHaveBeenCalledWith("Date updated");
    expect(mutationMock.saveExecution).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "update", id: 1 }),
    );
  });

  it("keeps update routing and invalidation scoped to the submitted contact after rerender", async () => {
    const user = userEvent.setup();
    let resolveUpdate: (() => void) | undefined;
    const { rerenderModule } = renderImportantDatesModule({
      vaultId: 101,
      contactId: 202,
      datesReturn: { data: [mockDates[0]], isLoading: false },
    });

    await user.click(screen.getByRole("button", { name: "edit" }));
    apiMock.contactsDatesUpdate.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = () => resolve({ data: {} });
        }),
    );
    await user.click(screen.getByRole("button", { name: /ok|save/i }));
    await waitFor(() => expect(apiMock.contactsDatesUpdate).toHaveBeenCalled());
    rerenderModule({ vaultId: 404, contactId: 505 });

    if (resolveUpdate === undefined) {
      throw new Error(
        "expected the important date update request to be pending",
      );
    }
    resolveUpdate();
    await completePendingSave();

    expect(apiMock.contactsDatesUpdate).toHaveBeenCalledWith(
      "101",
      "202",
      1,
      expect.any(Object),
    );
    expectImportantDateInvalidatedKeys();
  });
});
