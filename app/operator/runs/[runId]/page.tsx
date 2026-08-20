import { RunDetailView } from "../../operator-views";

export default async function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <RunDetailView runId={runId} />;
}
