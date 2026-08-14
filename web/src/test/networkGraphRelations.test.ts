import { describe, expect, it } from "vitest";
import {
  graphEdgeLabelForNode,
  type EdgeWithRelations,
} from "@/components/networkGraphRelations";

const parentChildEdge: EdgeWithRelations = {
  source: "parent",
  target: "child",
  type: "Parent",
  inferred: false,
  relations: [
    {
      source_kind: "parent",
      target_kind: "child",
      source_label: "Parent",
      target_label: "Child",
      inferred: false,
    },
  ],
};

describe("graphEdgeLabelForNode", () => {
  it("uses the relationship label from each endpoint perspective", () => {
    expect(graphEdgeLabelForNode(parentChildEdge, "parent")).toBe("Parent");
    expect(graphEdgeLabelForNode(parentChildEdge, "child")).toBe("Child");
  });

  it("works after D3 replaces endpoint IDs with node objects", () => {
    const simulatedEdge: EdgeWithRelations = {
      ...parentChildEdge,
      source: { id: "parent" },
      target: { id: "child" },
    };
    expect(graphEdgeLabelForNode(simulatedEdge, "child")).toBe("Child");
  });

  it("combines distinct direct and inferred relations without overlap", () => {
    const blendedEdge: EdgeWithRelations = {
      ...parentChildEdge,
      relations: [
        ...parentChildEdge.relations!,
        {
          source_kind: "friend",
          target_kind: "friend",
          source_label: "Friend",
          target_label: "Friend",
          inferred: true,
        },
      ],
    };
    expect(graphEdgeLabelForNode(blendedEdge, "parent")).toBe(
      "Parent · Friend",
    );
    expect(graphEdgeLabelForNode(blendedEdge, "child")).toBe("Child · Friend");
  });

  it("falls back to the legacy type when relation metadata is absent", () => {
    expect(
      graphEdgeLabelForNode(
        { source: "a", target: "b", type: "Legacy", inferred: false },
        "a",
      ),
    ).toBe("Legacy");
  });
});
