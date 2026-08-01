import type { Reminder } from "@/api";
import { getCalendarSystem } from "@/utils/calendar";
import type { CalendarType } from "@/utils/calendar";
import { formatDate, formatShortDate } from "@/utils/dateFormat";
import type { DateFormatVariants } from "@/utils/dateFormat";

export function formatReminderDate(
  reminder: Reminder,
  dateFormats: DateFormatVariants,
): string {
  if (reminder.month == null || reminder.day == null) return "";
  const month = String(reminder.month).padStart(2, "0");
  const day = String(reminder.day).padStart(2, "0");
  const date = `${reminder.year ?? 2000}-${month}-${day}`;
  const gregorianDate =
    reminder.year != null
      ? formatDate(date, dateFormats)
      : formatShortDate(date, dateFormats);

  if (
    reminder.calendar_type &&
    reminder.calendar_type !== "gregorian" &&
    reminder.original_month != null &&
    reminder.original_day != null
  ) {
    const calendarSystem = getCalendarSystem(
      reminder.calendar_type as CalendarType,
    );
    const originalDate = calendarSystem.formatDate({
      day: reminder.original_day,
      month: reminder.original_month,
      year: reminder.original_year ?? 0,
    });
    return `${originalDate} (${gregorianDate})`;
  }
  return gregorianDate;
}
