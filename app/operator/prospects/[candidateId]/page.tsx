import { ProspectDetailView } from "../../operator-views";

export default async function ProspectDetailPage({ params }: { params: Promise<{ candidateId: string }> }) {
  const { candidateId } = await params;
  return <ProspectDetailView candidateId={candidateId} />;
}
