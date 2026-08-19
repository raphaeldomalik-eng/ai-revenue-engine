import assert from "node:assert/strict";
import test from "node:test";
import { sendApprovedOutreachMessage } from "../src/outreach/service.ts";

test("failed provider submission never becomes SENT", async () => {
  process.env.SENDGRID_API_KEY = "controlled-test-key";
  process.env.OUTREACH_FROM_EMAIL = "partner@eventsuite.pro";
  const updates: Array<Record<string, unknown>> = [];
  const message = { id: "message-1", status: "APPROVED", sequence_id: "sequence-1", account_id: "account-1", contact_id: null, recipient_email: "raphael@eventsuite.pro", subject: "A useful conversation", body: "A concise message", send_attempts: 0, sequence_number: 1 };
  const client = {
    from(table: string) {
      let updateValues: Record<string, unknown> | null = null;
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        in() { return chain; },
        or() { return chain; },
        limit() { return chain; },
        update(values: Record<string, unknown>) { updateValues = values; updates.push(values); return chain; },
        async maybeSingle() {
          if (table === "accounts") return { data: { metadata: { outreachEligibility: "ELIGIBLE" } }, error: null };
          if (table === "outreach_suppressions") return { data: null, error: null };
          if (table === "outreach_messages" && updateValues?.status === "SENDING") return { data: { id: message.id, subject: message.subject, body: message.body }, error: null };
          return { data: message, error: null };
        },
        async single() { return { data: { status: "ACTIVE" }, error: null }; },
        async insert() { return { error: null }; },
      };
      return chain;
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("provider failed", { status: 500 });
  await assert.rejects(() => sendApprovedOutreachMessage(client as never, message.id, "operator-1"), /OUTREACH_PROVIDER_FAILED/);
  globalThis.fetch = originalFetch;
  assert.equal(updates.some((item) => item.status === "SENT"), false);
  assert.equal(updates.some((item) => item.status === "FAILED"), true);
});
