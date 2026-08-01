import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { ConfigProvider } from "antd";
import {
  findTargetRecordPage,
  scanTargetRecordPages,
  sourceRecordKey,
  useSourceRecordReveal,
} from "@/pages/contact/contactSourceRecord";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function RevealHarness({ available }: { readonly available: boolean }) {
  const target = { id: 9, kind: "Note", module: "notes" } as const;
  useSourceRecordReveal(target, available);
  return (
    <div data-source-record={sourceRecordKey("Note", 9)}>Target record</div>
  );
}

describe("contact source record helpers", () => {
  beforeEach(() => {
    vi.useRealTimers();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("reveals and highlights an available record only once per target key", async () => {
    const { rerender } = render(
      <ConfigProvider>
        <RevealHarness available={true} />
      </ConfigProvider>,
    );

    const record = document.querySelector<HTMLElement>(
      '[data-source-record="Note:9"]',
    );
    expect(record).toBeInTheDocument();
    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
      expect(record?.style.backgroundColor).not.toBe("");
    });

    rerender(
      <ConfigProvider>
        <RevealHarness available={true} />
      </ConfigProvider>,
    );

    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    });
  });

  it("returns null after bounded sequential pagination is exhausted", async () => {
    const loadPage = vi.fn(async (page: number) => ({
      page,
      items: [{ id: page }],
      totalPages: 3,
    }));

    const result = await findTargetRecordPage({
      targetId: 99,
      initialPage: { page: 1, items: [{ id: 1 }], totalPages: 3 },
      loadPage,
      getRecordId: (record) => record.id,
    });

    expect(result).toBeNull();
    expect(loadPage).toHaveBeenCalledTimes(2);
    expect(loadPage).toHaveBeenNthCalledWith(1, 2);
    expect(loadPage).toHaveBeenNthCalledWith(2, 3);
  });

  it("merges sequential pages and stops after finding the target", async () => {
    const loadPage = vi.fn(async (page: number) => ({
      page,
      items: [{ id: page }],
      totalPages: 4,
    }));

    const result = await scanTargetRecordPages({
      targetId: 3,
      initialPage: { page: 1, items: [{ id: 1 }], totalPages: 4 },
      loadPage,
      getRecordId: (record) => record.id,
    });

    expect(result).toEqual({
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      lastPage: 3,
      totalPages: 4,
      targetFound: true,
    });
    expect(loadPage).toHaveBeenCalledTimes(2);
  });
});
