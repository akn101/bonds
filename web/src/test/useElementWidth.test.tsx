import { describe, expect, it } from "vitest";
import { useState } from "react";
import { render, screen, act } from "@testing-library/react";
import { useElementWidth } from "@/hooks/useElementWidth";

function widthOf(node: HTMLElement) {
  // jsdom reports 0 for every layout measurement, so the width is faked.
  Object.defineProperty(node, "clientWidth", { value: 640, configurable: true });
}

/**
 * A chart that shows an empty state until its data arrives — which is exactly
 * when the canvas node first appears in the DOM.
 */
function LateChart() {
  const { ref, width } = useElementWidth();
  const [hasData, setHasData] = useState(false);

  return (
    <div>
      <button onClick={() => setHasData(true)}>load</button>
      {hasData ? (
        <div
          ref={(node) => {
            if (node) widthOf(node);
            ref(node);
          }}
        >
          canvas
        </div>
      ) : (
        <p>empty</p>
      )}
      <span data-testid="width">{width}</span>
    </div>
  );
}

describe("useElementWidth", () => {
  it("measures a node that only appears on a later render", async () => {
    render(<LateChart />);
    // Nothing to measure yet: the component is showing its empty state.
    expect(screen.getByTestId("width").textContent).toBe("0");

    await act(async () => {
      screen.getByText("load").click();
    });

    // The bug this guards: measuring in an effect with no dependencies runs
    // once, while the node is still absent, and never runs again — leaving the
    // chart permanently 0 wide and therefore blank.
    expect(screen.getByTestId("width").textContent).toBe("640");
  });

  it("resets to zero when the node goes away", async () => {
    function Toggle() {
      const { ref, width } = useElementWidth();
      const [shown, setShown] = useState(true);
      return (
        <div>
          <button onClick={() => setShown((v) => !v)}>toggle</button>
          {shown && (
            <div
              ref={(node) => {
                if (node) widthOf(node);
                ref(node);
              }}
            />
          )}
          <span data-testid="width">{width}</span>
        </div>
      );
    }

    render(<Toggle />);
    expect(screen.getByTestId("width").textContent).toBe("640");
    await act(async () => {
      screen.getByText("toggle").click();
    });
    expect(screen.getByTestId("width").textContent).toBe("0");
  });
});
