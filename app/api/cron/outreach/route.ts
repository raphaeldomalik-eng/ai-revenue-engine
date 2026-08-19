import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { processDueOutreachMessages } from "../../../../src/outreach/service";

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authorization !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseSecretKey) return NextResponse.json({ message: "Scheduler is not configured: Supabase server credential is required server-side." }, { status: 503 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return NextResponse.json({ message: "Scheduler is not configured: Supabase URL is required." }, { status: 503 });
  const client = createClient(url, supabaseSecretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return NextResponse.json({ processed: await processDueOutreachMessages(client) });
}
