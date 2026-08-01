import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { theme } from "antd";
import type {
  FeedSourceKind,
  NormalizedFeedSource,
} from "@/utils/feedSourceLink";

const SOURCE_RECORD_HIGHLIGHT_DURATION_MS = 2400;

export type TargetRecordPage<RecordType> = {
  readonly page: number;
  readonly items: readonly RecordType[];
  readonly totalPages: number;
};

export type TargetRecordScan<RecordType> = {
  readonly items: readonly RecordType[];
  readonly lastPage: number;
  readonly totalPages: number;
  readonly targetFound: boolean;
};

type FindTargetRecordPageOptions<RecordType> = {
  readonly targetId: number;
  readonly initialPage: TargetRecordPage<RecordType>;
  readonly loadPage: (page: number) => Promise<TargetRecordPage<RecordType>>;
  readonly getRecordId: (record: RecordType) => number | undefined;
};

export function sourceRecordKey(kind: FeedSourceKind, id: number): string {
  return `${kind}:${id}`;
}

export async function findTargetRecordPage<RecordType>({
  targetId,
  initialPage,
  loadPage,
  getRecordId,
}: FindTargetRecordPageOptions<RecordType>): Promise<TargetRecordPage<RecordType> | null> {
  if (initialPage.items.some((record) => getRecordId(record) === targetId)) {
    return initialPage;
  }

  for (
    let page = initialPage.page + 1;
    page <= initialPage.totalPages;
    page += 1
  ) {
    const loadedPage = await loadPage(page);
    if (loadedPage.items.some((record) => getRecordId(record) === targetId)) {
      return loadedPage;
    }
  }

  return null;
}

export async function scanTargetRecordPages<RecordType>({
  targetId,
  initialPage,
  loadPage,
  getRecordId,
}: FindTargetRecordPageOptions<RecordType>): Promise<
  TargetRecordScan<RecordType>
> {
  const items = [...initialPage.items];
  let lastPage = initialPage.page;
  let targetFound = items.some((record) => getRecordId(record) === targetId);

  for (
    let page = initialPage.page + 1;
    !targetFound && page <= initialPage.totalPages;
    page += 1
  ) {
    const loadedPage = await loadPage(page);
    items.push(...loadedPage.items);
    lastPage = page;
    targetFound = loadedPage.items.some(
      (record) => getRecordId(record) === targetId,
    );
  }

  return {
    items,
    lastPage,
    totalPages: initialPage.totalPages,
    targetFound,
  };
}

export function useTargetRecordPageSelection(
  targetKey: string | null,
  targetPage: number | null | undefined,
  setCurrentPage: Dispatch<SetStateAction<number>>,
): void {
  const [appliedSelection, setAppliedSelection] = useState<string | null>(null);
  const nextSelection =
    targetKey !== null && targetPage != null
      ? `${targetKey}:${targetPage}`
      : null;

  // Query results can outlive a tab's component instance. Apply each resolved
  // target once during render so the current observer also consumes cached data.
  if (appliedSelection !== nextSelection) {
    setAppliedSelection(nextSelection);
    if (targetPage != null) {
      setCurrentPage((currentPage) =>
        currentPage === targetPage ? currentPage : targetPage,
      );
    }
  }
}

export function useSourceRecordReveal(
  target: NormalizedFeedSource | undefined,
  available: boolean,
): void {
  const { token } = theme.useToken();
  const revealedTargetKeyRef = useRef<string | null>(null);
  const targetKey = target ? sourceRecordKey(target.kind, target.id) : null;

  useEffect(() => {
    if (!available || !targetKey || revealedTargetKeyRef.current === targetKey)
      return;

    const record = document.querySelector<HTMLElement>(
      `[data-source-record="${targetKey}"]`,
    );
    if (!record) return;

    revealedTargetKeyRef.current = targetKey;
    const previousBackgroundColor = record.style.backgroundColor;
    const previousBoxShadow = record.style.boxShadow;
    record.scrollIntoView({ behavior: "smooth", block: "center" });
    record.style.backgroundColor = token.colorPrimaryBg;
    record.style.boxShadow = `inset 0 0 0 1px ${token.colorPrimaryBorder}`;

    const highlightTimer = window.setTimeout(() => {
      record.style.backgroundColor = previousBackgroundColor;
      record.style.boxShadow = previousBoxShadow;
    }, SOURCE_RECORD_HIGHLIGHT_DURATION_MS);

    return () => {
      window.clearTimeout(highlightTimer);
      record.style.backgroundColor = previousBackgroundColor;
      record.style.boxShadow = previousBoxShadow;
    };
  }, [available, targetKey, token.colorPrimaryBg, token.colorPrimaryBorder]);
}
