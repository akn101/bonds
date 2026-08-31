import { useCallback, useRef, useState } from "react";

/**
 * Tracks the rendered width of an element.
 *
 * The element is attached through a callback ref rather than measured in an
 * effect, because a chart that early-returns an empty state on its first render
 * has no node to measure yet — and an effect with no dependencies will not run
 * again when the data finally arrives and the canvas appears. A callback ref
 * fires whenever the node attaches or detaches, so the measurement cannot be
 * missed regardless of which render the node shows up on.
 */
export function useElementWidth<T extends HTMLElement = HTMLDivElement>() {
  const nodeRef = useRef<T | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [width, setWidth] = useState(0);

  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    nodeRef.current = node;

    if (!node) {
      setWidth(0);
      return;
    }
    setWidth(node.clientWidth);

    // jsdom has no ResizeObserver; the width simply stays at its first reading.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  return { ref, nodeRef, width };
}
