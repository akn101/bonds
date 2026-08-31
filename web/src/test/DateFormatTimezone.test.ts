import { describe, it, expect } from "vitest";
import {
  formatCalendarDate,
  formatDateTime,
  formatDate,
  type DateFormatVariants,
} from "@/utils/dateFormat";

const baseFmt: DateFormatVariants = {
  full: "YYYY-MM-DD",
  monthYear: "YYYY-MM",
  short: "MM-DD",
  dateTime: "YYYY-MM-DD HH:mm",
  dateTimeFull: "YYYY-MM-DD HH:mm:ss",
};

// Guards a real bug: useDateFormat used to ignore the user's saved
// timezone, so a stored UTC timestamp like "2026-03-12T00:00:00Z"
// rendered in the browser's local tz instead of the user's preference.
// A Tokyo user reading what should be "March 12 09:00" saw the browser
// time (UTC or whatever the user's laptop was set to).
describe("formatDateTime respects user timezone", () => {
  it("renders the same UTC instant differently in different zones", () => {
    const instant = "2026-03-12T00:00:00Z";
    const tokyo = formatDateTime(instant, { ...baseFmt, tz: "Asia/Tokyo" });
    const newYork = formatDateTime(instant, {
      ...baseFmt,
      tz: "America/New_York",
    });
    expect(tokyo).toBe("2026-03-12 09:00"); // UTC midnight = 9 AM Tokyo (no DST)
    // 2026-03-12 is past the second Sunday of March, so NYC is on EDT (UTC-4),
    // which puts UTC midnight at 20:00 the previous day rather than 19:00.
    expect(newYork).toBe("2026-03-11 20:00");
  });

  it("uses the canonical UTC fallback when tz is omitted", () => {
    const instant = "2026-03-12T00:00:00Z";
    const result = formatDateTime(instant, baseFmt);
    expect(result).toBe("2026-03-12 00:00");
  });

  it("uses the canonical UTC fallback for an invalid IANA string", () => {
    const instant = "2026-03-12T00:00:00Z";
    expect(
      formatDateTime(instant, { ...baseFmt, tz: "Mars/Olympus_Mons" }),
    ).toBe("2026-03-12 00:00");
  });

  it("applies tz to date-only format too", () => {
    // 00:30 UTC on Mar 12 is still Mar 11 in Honolulu (UTC-10).
    const instant = "2026-03-12T00:30:00Z";
    const honolulu = formatDate(instant, {
      ...baseFmt,
      tz: "Pacific/Honolulu",
    });
    expect(honolulu).toBe("2026-03-11");
  });
});

describe("formatCalendarDate", () => {
  it("never moves a calendar date into the previous day for readers behind UTC", () => {
    // last_at and friends are pure dates stored at UTC midnight. A New York
    // reader viewing "2026-08-19T00:00:00Z" spoke to that person on the 19th,
    // not the 18th — the date has no instant to convert.
    const formats = { full: "YYYY-MM-DD", tz: "America/New_York" };
    expect(formatCalendarDate("2026-08-19T00:00:00Z", formats as never)).toBe("2026-08-19");
  });

  it("is equally indifferent to timezones ahead of UTC", () => {
    const formats = { full: "YYYY-MM-DD", tz: "Pacific/Kiritimati" };
    expect(formatCalendarDate("2026-08-19T00:00:00Z", formats as never)).toBe("2026-08-19");
  });
});
