import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../src/lib/supabase-server";
import { incomingLeadFixtures } from "../../../../src/incoming-leads/fixtures";

export async function POST() {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ message: "Development fixtures are disabled in production." }, { status: 404 });
  const client = await createServerSupabaseClient();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return NextResponse.json({ message: "Sign in is required." }, { status: 401 });
  const { data: member } = await client.from("revenue_members").select("member_role,active").eq("user_id", auth.user.id).maybeSingle();
  if (!member?.active || !["operator", "admin"].includes(String(member.member_role))) return NextResponse.json({ message: "Active operator access is required." }, { status: 403 });
  const results = [];
  for (const payload of incomingLeadFixtures) {
    const { data, error } = await client.rpc("ingest_incoming_submission", { p_payload: payload });
    if (error) return NextResponse.json({ message: "Fixture ingestion stopped.", error: error.message, results }, { status: 502 });
    results.push(data);
  }
  return NextResponse.json({ message: `Processed ${results.length} controlled development submissions.`, results });
}
