import type { CalendarDatePickerValue } from "@/components/CalendarDatePicker";

type ImportantDatesCalendarDatePickerMockProps = {
  readonly value?: CalendarDatePickerValue;
  readonly onChange?: (value: CalendarDatePickerValue) => void;
};

export default function ImportantDatesCalendarDatePickerMock({
  value,
  onChange,
}: ImportantDatesCalendarDatePickerMockProps) {
  return (
    <div data-testid="calendar-date-picker">
      <output data-testid="calendar-picker-value">
        {JSON.stringify(value ?? null)}
      </output>
      <button
        data-testid="mock-calendar-change-full"
        onClick={() =>
          onChange?.({
            calendarType: "gregorian",
            day: 15,
            month: 8,
            year: 2025,
            datePrecision: "full",
          })
        }
      >
        Set Full Date
      </button>
      <button
        data-testid="mock-calendar-change-month"
        onClick={() =>
          onChange?.({
            calendarType: "gregorian",
            day: null,
            month: 8,
            year: 2025,
            datePrecision: "month",
          })
        }
      >
        Set Month And Year
      </button>
      <button
        data-testid="mock-calendar-change-year"
        onClick={() =>
          onChange?.({
            calendarType: "gregorian",
            day: null,
            month: null,
            year: 2025,
            datePrecision: "year",
          })
        }
      >
        Set Year Only
      </button>
      <button
        data-testid="mock-calendar-change-month-day"
        onClick={() =>
          onChange?.({
            calendarType: "gregorian",
            day: 15,
            month: 8,
            year: null,
            datePrecision: "month_day",
          })
        }
      >
        Set Month And Day
      </button>
      <button
        data-testid="mock-calendar-change-lunar-full"
        onClick={() =>
          onChange?.({
            calendarType: "lunar",
            day: 15,
            month: 1,
            year: 2025,
            datePrecision: "full",
          })
        }
      >
        Set Lunar Full Date
      </button>
    </div>
  );
}
