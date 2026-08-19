export type RevenueMemberRole = "admin" | "operator" | "viewer";
export type RevenueAccessState = "ANON" | "NON_MEMBER" | "VIEWER" | "OPERATOR" | "ADMIN";

export function revenueAccessState(member: { active: boolean; member_role: RevenueMemberRole } | null, authenticated: boolean): RevenueAccessState {
  if (!authenticated) return "ANON";
  if (!member || !member.active) return "NON_MEMBER";
  return member.member_role.toUpperCase() as Exclude<RevenueAccessState, "ANON" | "NON_MEMBER">;
}

export function canMutateCommercialData(access: RevenueAccessState) {
  return access === "OPERATOR" || access === "ADMIN";
}
