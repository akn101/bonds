import type { ContactLabel } from "@/api";

export type ContactLabelSyncPlan = {
  readonly addLabelIds: readonly number[];
  readonly removeAssignmentIds: readonly number[];
};

export function buildContactLabelSyncPlan(
  currentAssignments: readonly ContactLabel[],
  requestedLabelIds: readonly number[],
): ContactLabelSyncPlan {
  const requested = new Set(
    requestedLabelIds.filter(
      (labelId) => Number.isInteger(labelId) && labelId > 0,
    ),
  );
  const currentLabelIds = new Set(
    currentAssignments.flatMap((assignment) =>
      assignment.label_id === undefined ? [] : [assignment.label_id],
    ),
  );

  return {
    addLabelIds: [...requested].filter(
      (labelId) => !currentLabelIds.has(labelId),
    ),
    removeAssignmentIds: currentAssignments.flatMap((assignment) =>
      assignment.id !== undefined &&
      assignment.label_id !== undefined &&
      !requested.has(assignment.label_id)
        ? [assignment.id]
        : [],
    ),
  };
}
