import { screen } from "@testing-library/react";
import { expect, vi } from "vitest";

export type AvatarResponse = {
  readonly data: Blob;
};

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: Error) => void;
};

export type ObjectUrlProbe = {
  readonly createObjectURL: ReturnType<typeof vi.fn<(blob: Blob) => string>>;
  readonly revokeObjectURL: ReturnType<typeof vi.fn<(url: string) => void>>;
  readonly revokedWhileRendered: readonly string[];
};

export function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: Error) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  if (!resolvePromise || !rejectPromise) {
    throw new Error("deferred promise did not expose its controls");
  }
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

export function installObjectUrlProbe(
  objectUrls: readonly string[],
): ObjectUrlProbe {
  const revokedWhileRendered: string[] = [];
  let createdCount = 0;
  const createObjectURL = vi.fn<(blob: Blob) => string>(() => {
    const objectUrl = objectUrls[createdCount];
    if (!objectUrl) throw new Error("object URL probe exhausted its sequence");
    createdCount += 1;
    return objectUrl;
  });
  const revokeObjectURL = vi.fn<(url: string) => void>((url) => {
    const renderedSources = Array.from(
      document.querySelectorAll<HTMLImageElement>("img"),
      (image) => image.getAttribute("src"),
    );
    if (renderedSources.includes(url)) revokedWhileRendered.push(url);
  });
  const NativeURL = URL;

  class ObjectUrlProbe extends NativeURL {
    static createObjectURL(blob: Blob): string {
      return createObjectURL(blob);
    }

    static revokeObjectURL(url: string): void {
      revokeObjectURL(url);
    }
  }

  vi.stubGlobal("URL", ObjectUrlProbe);
  return { createObjectURL, revokeObjectURL, revokedWhileRendered };
}

export function expectFallback(initials: string, probe: ObjectUrlProbe): void {
  expect(screen.getByText(initials)).toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(probe.revokedWhileRendered).toEqual([]);
}
