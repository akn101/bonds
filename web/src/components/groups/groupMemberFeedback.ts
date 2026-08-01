const groupMemberFeedbackKeys = {
  added: {
    none: "vault.group_detail.no_members_added",
    one: "vault.group_detail.member_added",
    many: "vault.group_detail.members_added",
  },
  removed: {
    none: "vault.group_detail.no_members_removed",
    one: "vault.group_detail.member_removed",
    many: "vault.group_detail.members_removed",
  },
} as const;

type GroupMemberMutationAction = keyof typeof groupMemberFeedbackKeys;

export function getGroupMemberFeedbackKey(
  action: GroupMemberMutationAction,
  affectedCount: number,
): string {
  const quantity =
    affectedCount === 0 ? "none" : affectedCount === 1 ? "one" : "many";
  return groupMemberFeedbackKeys[action][quantity];
}
