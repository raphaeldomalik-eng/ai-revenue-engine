import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const MAX_BODY_BYTES = 100_000;
const MAX_AGE_SECONDS = 300;

function signatureFor(timestamp: string, body: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

function validSignature(actual: string | null, expected: string) {
  if (!actual || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export async function POST(request: Request) {
  const secret = process.env.EVENT_SUITE_INCOMING_LEADS_WEBHOOK_SECRET;
  const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!secret || !serviceKey || !url) return NextResponse.json({ message: "Incoming Leads receiver is not configured." }, { status: 503 });
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return NextResponse.json({ message: "Payload too large." }, { status: 413 });
  const timestamp = request.headers.get("x-event-suite-timestamp");
  const epoch = Number(timestamp);
  if (!timestamp || !Number.isInteger(epoch) || Math.abs(Date.now() / 1000 - epoch) > MAX_AGE_SECONDS) return NextResponse.json({ message: "Request timestamp is invalid." }, { status: 401 });
  if (!validSignature(request.headers.get("x-event-suite-signature"), signatureFor(timestamp, raw, secret))) return NextResponse.json({ message: "Request signature is invalid." }, { status: 401 });
  let body: { payload?: Record<string, unknown> };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ message: "JSON body is invalid." }, { status: 400 }); }
  if (!body.payload || body.payload.sourceSystem !== "event_suite" || typeof body.payload.sourceRecordId !== "string") return NextResponse.json({ message: "Event Suite payload is invalid." }, { status: 400 });
  const client = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.rpc("ingest_event_suite_incoming_submission", { p_payload: body.payload });
  if (error) return NextResponse.json({ message: "Event Suite submission could not be processed." }, { status: 502 });
  return NextResponse.json({ result: data });
}
