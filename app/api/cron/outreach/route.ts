import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { processDueOutreachMessages } from "../../../../src/outreach/service";

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authorization !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ message: "Scheduler is not configured: SUPABASE_SERVICE_ROLE_KEY is required server-side." }, { status: 503 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ message: "Scheduler is not configured: Supabase server credential is required." }, { status: 503 });
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return NextResponse.json({ processed: await processDueOutreachMessages(client) });
}
