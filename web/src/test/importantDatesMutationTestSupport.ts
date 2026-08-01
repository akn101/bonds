import { expect } from "vitest";
import { invalidateQueriesMock } from "./importantDatesModuleTestHarness";

export type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: Error) => void;
};

export function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: Error) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  if (resolvePromise === undefined || rejectPromise === undefined) {
    throw new Error("expected deferred handlers initialization");
  }
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

export const calendarAndReminderKeys = [
  ["vaults", "101", "calendar"],
  ["vaults", "101", "contacts", "202", "important-dates"],
  ["vaults", "101", "reminders"],
  ["vaults", "101", "contacts", "202", "reminders"],
] as const;

export function expectImportantDateInvalidatedKeys(): void {
  expect(invalidateQueriesMock).toHaveBeenCalledTimes(
    calendarAndReminderKeys.length,
  );
  expect(
    invalidateQueriesMock.mock.calls.map(([filters]) => filters.queryKey),
  ).toEqual(calendarAndReminderKeys);
}

export function holdImportantDateInvalidation(
  heldQueryKey: readonly unknown[],
  completion: Deferred<void>,
): void {
  invalidateQueriesMock.mockImplementation(({ queryKey }) =>
    JSON.stringify(queryKey) === JSON.stringify(heldQueryKey)
      ? completion.promise
      : Promise.resolve(),
  );
}
