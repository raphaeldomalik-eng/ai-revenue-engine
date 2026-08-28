import { IncomingLeadDetailView } from "../incoming-leads-view";

export default async function IncomingLeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  return <IncomingLeadDetailView leadId={leadId} />;
}
