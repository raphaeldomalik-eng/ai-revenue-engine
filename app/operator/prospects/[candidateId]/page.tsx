import { redirect } from "next/navigation";

export default async function ProspectDetailPage({ params }: { params: Promise<{ candidateId: string }> }) {
  const { candidateId } = await params;
  redirect(`/operator/prospects?prospect=${encodeURIComponent(candidateId)}`);
}
