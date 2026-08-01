type ReminderCalendarDatePickerMockProps = {
  readonly onChange?: (value: {
    readonly calendarType: string;
    readonly day: number | null;
    readonly month: number | null;
    readonly year: number | null;
    readonly datePrecision?: string;
  }) => void;
  readonly allowedDatePrecisions?: readonly string[];
};

export default function ReminderCalendarDatePickerMock({
  onChange,
  allowedDatePrecisions,
}: ReminderCalendarDatePickerMockProps) {
  return (
    <div data-testid="calendar-date-picker">
      <output data-testid="allowed-date-precisions">
        {JSON.stringify(allowedDatePrecisions ?? [])}
      </output>
      <button
        data-testid="reminder-full-date"
        onClick={() =>
          onChange?.({
            calendarType: "gregorian",
            day: 15,
            month: 3,
            year: 2026,
            datePrecision: "full",
          })
        }
      >
        Reminder full date
      </button>
      <button
        data-testid="reminder-month-day"
        onClick={() =>
          onChange?.({
            calendarType: "gregorian",
            day: 15,
            month: 3,
            year: null,
            datePrecision: "month_day",
          })
        }
      >
        Reminder month day
      </button>
    </div>
  );
}
