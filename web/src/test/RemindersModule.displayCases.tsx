import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockReminders } from "./remindersModuleTestFixtures";
import {
  apiMock,
  renderRemindersModule,
  setReminderPreferencesResult,
  setReminderQueryResult,
} from "./remindersModuleTestHarness";

describe("RemindersModule display", () => {
  it("renders title and add button", () => {
    renderRemindersModule();
    expect(screen.getByText("Reminders")).toBeInTheDocument();
    expect(screen.getByText("Add")).toBeInTheDocument();
  });

  it("renders empty state", () => {
    renderRemindersModule();
    expect(screen.getByText("No reminders")).toBeInTheDocument();
  });

  it("renders reminders list", () => {
    setReminderQueryResult({ data: mockReminders, isLoading: false });
    renderRemindersModule();
    expect(screen.getByText("Call Mom")).toBeInTheDocument();
    expect(screen.getByText("Lunar Bday")).toBeInTheDocument();
  });

  it("reveals a directly targeted reminder with the stable source marker", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    setReminderQueryResult({ data: mockReminders, isLoading: false });

    renderRemindersModule({
      target: { id: 2, kind: "ContactReminder", module: "reminders" },
    });

    const targetRecord = await screen.findByText("Lunar Bday");
    expect(
      targetRecord.closest('[data-source-record="ContactReminder:2"]'),
    ).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
  });

  it("renders lunar reminder with tag when alternative calendar enabled", () => {
    setReminderQueryResult({ data: mockReminders, isLoading: false });
    setReminderPreferencesResult({
      data: { enable_alternative_calendar: true },
    });
    renderRemindersModule();
    expect(screen.getByText("lunar")).toBeInTheDocument();
  });

  it("renders frequency tag", () => {
    setReminderQueryResult({ data: mockReminders, isLoading: false });
    renderRemindersModule();
    expect(screen.getAllByText("Yearly").length).toBeGreaterThanOrEqual(1);
  });

  it("renders year-null yearly reminders without a year in the display", () => {
    setReminderQueryResult({
      data: [{ ...mockReminders[0], year: null }],
      isLoading: false,
    });
    renderRemindersModule();
    expect(screen.getByText(/Mar 15/)).toBeInTheDocument();
  });

  it("passes only full and month_day precision options to reminder date picker", async () => {
    const user = userEvent.setup();
    renderRemindersModule();

    await user.click(screen.getByText("Add"));

    expect(
      await screen.findByTestId("allowed-date-precisions"),
    ).toHaveTextContent('["full","month_day"]');
  });

  it("submits a yearless month_day reminder without fabricating a year", async () => {
    const user = userEvent.setup();
    renderRemindersModule();

    await user.click(screen.getByText("Add"));
    await user.type(
      await screen.findByRole("textbox", { name: /label/i }),
      "Yearless Reminder",
    );
    await user.click(screen.getByTestId("reminder-month-day"));
    await user.click(screen.getByRole("combobox", { name: /frequency/i }));
    await user.click(await screen.findByTitle("Yearly"));
    await user.click(screen.getByRole("button", { name: /ok|save/i }));

    await waitFor(() =>
      expect(apiMock.reminders.contactsRemindersCreate).toHaveBeenCalledWith(
        "v1",
        "c1",
        expect.objectContaining({
          label: "Yearless Reminder",
          day: 15,
          month: 3,
          type: "recurring_year",
        }),
      ),
    );
    const payload = vi
      .mocked(apiMock.reminders.contactsRemindersCreate)
      .mock.calls.at(-1)?.[2];
    expect(payload?.year).toBeUndefined();
  });

  it("keeps the calendar picker unmounted until the add form opens", () => {
    renderRemindersModule();
    expect(
      screen.queryByTestId("calendar-date-picker"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Add")).toBeInTheDocument();
  });
});
