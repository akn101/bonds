import type { ContactGraphRelation } from "@/api";

interface GraphEndpoint {
  id: string;
}

export interface EdgeWithRelations {
  source: string | GraphEndpoint;
  target: string | GraphEndpoint;
  type?: string;
  inferred?: boolean;
  relations?: ContactGraphRelation[];
}

function endpointId(endpoint: string | GraphEndpoint): string {
  return typeof endpoint === "string" ? endpoint : endpoint.id;
}

/**
 * Return relation labels from the hovered endpoint's perspective. Reciprocal
 * Parent/Child rows are represented by one edge, so only the meaningful label
 * for that endpoint is shown instead of two labels occupying the same point.
 */
export function graphEdgeLabelForNode(
  edge: EdgeWithRelations,
  nodeId: string,
): string {
  if (!edge.relations?.length) return edge.type ?? "";

  const fromSource = endpointId(edge.source) === nodeId;
  const labels = edge.relations
    .map((relation) =>
      fromSource
        ? (relation.source_label ?? "")
        : (relation.target_label ?? ""),
    )
    .filter((label) => label.length > 0);

  return labels.join(" · ") || edge.type || "";
}
