import type { SupabaseClient } from "@supabase/supabase-js";

export type ProspectApprovalDecision = "APPROVED" | "REVOKED";
export type ProspectApproval = {
  decision: ProspectApprovalDecision;
  reviewer_id?: string | null;
  created_at?: string | null;
};

export function latestProspectApproval(rows: ProspectApproval[] | null | undefined) {
  return [...(rows ?? [])].sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())[0] ?? null;
}

export function prospectApprovalAllowsDrafting(approval: ProspectApproval | null | undefined) {
  return approval?.decision === "APPROVED";
}

export type ComposerApprovalReview = { draft_version_id: string; action: string; created_at?: string | null };

export function composerVersionIsApproved(versionId: string, reviews: ComposerApprovalReview[]) {
  const latest = [...reviews]
    .filter((review) => review.draft_version_id === versionId)
    .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())[0];
  return latest?.action === "APPROVE";
}

export async function assertProspectApproved(client: SupabaseClient, candidateId: string) {
  if (!candidateId) throw new Error("PROSPECT_ID_REQUIRED");
  const { data, error } = await client
    .from("ai_prospect_approval_reviews")
    .select("decision, reviewer_id, created_at")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("PROSPECT_APPROVAL_CHECK_FAILED");
  if (!prospectApprovalAllowsDrafting(data as ProspectApproval | null)) throw new Error("PROSPECT_APPROVAL_REQUIRED");
  return data as ProspectApproval;
}
