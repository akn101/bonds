import type { FeedSource } from "@/api";

const FEED_SOURCE_KINDS = [
  "Note",
  "ContactReminder",
  "Call",
  "ContactTask",
  "Address",
  "TimelineEvent",
  "Loan",
  "Relationship",
  "File",
] as const;

export type FeedSourceKind = (typeof FEED_SOURCE_KINDS)[number];
export type FeedSourceModule =
  | "notes"
  | "reminders"
  | "calls"
  | "tasks"
  | "addresses"
  | "life_events"
  | "loans"
  | "relationships"
  | "photos"
  | "documents"
  | "quick_facts";

export type NormalizedFeedSource =
  | { readonly id: number; readonly kind: "Note"; readonly module: "notes" }
  | {
      readonly id: number;
      readonly kind: "ContactReminder";
      readonly module: "reminders";
    }
  | { readonly id: number; readonly kind: "Call"; readonly module: "calls" }
  | {
      readonly id: number;
      readonly kind: "ContactTask";
      readonly module: "tasks";
    }
  | {
      readonly id: number;
      readonly kind: "Address";
      readonly module: "addresses";
    }
  | {
      readonly id: number;
      readonly kind: "TimelineEvent";
      readonly module: "life_events";
    }
  | { readonly id: number; readonly kind: "Loan"; readonly module: "loans" }
  | {
      readonly id: number;
      readonly kind: "Relationship";
      readonly module: "relationships";
    }
  | { readonly id: number; readonly kind: "File"; readonly module: "photos" }
  | {
      readonly id: number;
      readonly kind: "File";
      readonly module: "documents";
    }
  | {
      readonly id: number;
      readonly kind: "File";
      readonly module: "quick_facts";
    };

export type ContactSourceFocus = {
  readonly focus: FeedSourceModule;
  readonly source: NormalizedFeedSource;
};

function assertNever(value: never): never {
  throw new Error(`Unexpected feed source kind: ${String(value)}`);
}

function isFeedSourceKind(value: string): value is FeedSourceKind {
  return FEED_SOURCE_KINDS.some((kind) => kind === value);
}

function normalizeMappedSource(
  kind: FeedSourceKind,
  module: string,
  id: number,
): NormalizedFeedSource | null {
  switch (kind) {
    case "Note":
      return module === "notes" ? { id, kind, module } : null;
    case "ContactReminder":
      return module === "reminders" ? { id, kind, module } : null;
    case "Call":
      return module === "calls" ? { id, kind, module } : null;
    case "ContactTask":
      return module === "tasks" ? { id, kind, module } : null;
    case "Address":
      return module === "addresses" ? { id, kind, module } : null;
    case "TimelineEvent":
      return module === "life_events" ? { id, kind, module } : null;
    case "Loan":
      return module === "loans" ? { id, kind, module } : null;
    case "Relationship":
      return module === "relationships" ? { id, kind, module } : null;
    case "File":
      return module === "photos" ||
        module === "documents" ||
        module === "quick_facts"
        ? { id, kind, module }
        : null;
    default:
      return assertNever(kind);
  }
}

export function parseCanonicalPositiveSafeInteger(
  value: string,
): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function normalizeFeedSource(
  source: Readonly<FeedSource> | null | undefined,
): NormalizedFeedSource | null {
  if (
    source?.available !== true ||
    typeof source.id !== "number" ||
    !Number.isSafeInteger(source.id) ||
    source.id <= 0 ||
    typeof source.kind !== "string" ||
    !isFeedSourceKind(source.kind) ||
    typeof source.module !== "string"
  ) {
    return null;
  }

  return normalizeMappedSource(source.kind, source.module, source.id);
}

export function buildContactSourcePath(
  vaultId: string,
  contactId: string,
  source: Readonly<FeedSource> | null | undefined,
): string {
  const basePath = `/vaults/${vaultId}/contacts/${contactId}`;
  const normalizedSource = normalizeFeedSource(source);
  if (!normalizedSource) return basePath;

  return `${basePath}?focus=${normalizedSource.module}&source=${normalizedSource.kind}:${normalizedSource.id}`;
}

export function parseContactSourceFocus(
  search: string,
): ContactSourceFocus | null {
  const params = new URLSearchParams(search);
  const focusValues = params.getAll("focus");
  const sourceValues = params.getAll("source");
  if (
    Array.from(params.keys()).length !== 2 ||
    focusValues.length !== 1 ||
    sourceValues.length !== 1
  ) {
    return null;
  }

  const focus = focusValues[0];
  const sourceValue = sourceValues[0];
  if (!focus || !sourceValue) return null;

  const sourceMatch = /^([^:]+):([^:]+)$/.exec(sourceValue);
  if (!sourceMatch) return null;

  const kind = sourceMatch[1];
  const idValue = sourceMatch[2];
  if (!kind || !isFeedSourceKind(kind) || !idValue) return null;

  const id = parseCanonicalPositiveSafeInteger(idValue);
  if (id === null) return null;

  const source = normalizeMappedSource(kind, focus, id);
  return source ? { focus: source.module, source } : null;
}
