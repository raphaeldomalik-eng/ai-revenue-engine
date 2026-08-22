import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { outreachComposerPromptPackText, outreachComposerStageInstruction, outreachComposerSystemPrompt, composerRequestBody, generateOutreachComposerDraft, validateOutreachComposerDraft, type ComposerInput, type ComposerStructuredDraft } from "../src/ai-sales-team/outreach-composer.ts";
import { createComposerSequence, recordComposerReview, validateHumanEditedComposerText } from "../src/ai-sales-team/outreach-composer-persistence.ts";
import { PRODUCTION_ACTIVATION_FLAGS, outreachComposerProductionEnabled, productionActivation } from "../src/lib/server-production-activation.ts";

const words = Array.from({ length: 80 }, (_, index) => index === 0 ? "Current" : `evidence${index}`).join(" ");
const input: ComposerInput = {
  target: { canonicalName: "Mash Media Group", canonicalDomain: "mashmedia.net", eligible: true, relationship: "PROSPECT" },
  originatingLane: "EVENT_FIRST",
  recipient: { name: "Charlotte Example", role: "Marketing Event Director", classification: "DIRECT_BUYER_CANDIDATE", hasVerifiedBusinessEmail: false },
  relationships: { organisation: "Mash Media Group", event: "Event Production Show", venue: null, operator: null },
  evidence: [{ id: "evidence-1", claim: "The organisation supports current event activity.", sourceUrl: "https://mashmedia.net/events", sourceTitle: "Official events page", kind: "FACT", approved: true }],
  commercialOpportunity: { fit: "MEDIUM", productEvidence: ["Current event activity"], noEvidence: false },
  contactProvenance: { ownershipValidated: true, sourceUrl: "https://mashmedia.net/team", route: "NAMED_BUYER" },
  sequence: { stage: "EMAIL_1", stopState: "CLEAR" },
};

function draft(overrides: Partial<ComposerStructuredDraft> = {}): ComposerStructuredDraft {
  return { status: "DRAFT_READY", promptVersion: "outreach-composer-v1", sequenceStage: "EMAIL_1", messageType: "PERSONAL_PLATFORM_INTRODUCTION", subject: "Event operations at Mash Media", bodyPlainText: words, productAngle: "PLATFORM_OVERVIEW", mentionedCapabilities: ["planning"], primaryCtaType: "RELEVANCE_CHECK", secondaryCtaType: null, urlTokensUsed: [], personalisationEvidenceIds: ["evidence-1"], claimEvidence: [{ claim: "Current event activity", evidenceIds: ["evidence-1"] }], uncertainties: [], riskFlags: [], humanReviewSummary: "Evidence-led draft for human review.", ...overrides };
}

test("prompt pack is the runtime source and remains byte-for-byte owner approved", async () => {
  const pack = await readFile("docs/agents/outreach-composer-prompt-pack-v1.md");
  assert.equal(outreachComposerPromptPackText(), pack.toString());
  assert.equal(createHash("sha256").update(pack).digest("hex"), "e4d9b94d31d8fb00369109f906a3f35f7cc4abe4f81511293d6b550ff6abc921");
  assert.match(outreachComposerSystemPrompt(), /You are the EventSuite Outreach Composer\./);
  assert.match(outreachComposerStageInstruction("EMAIL_1"), /Create EMAIL_1\./);
  assert.match(outreachComposerStageInstruction("REVISION"), /REVISION MODE/);
});

test("Composer request uses strict named JSON schema and no research tools", () => {
  const body = composerRequestBody(input) as any;
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.name, "outreach_composer_draft");
  assert.equal(body.tools, undefined);
  assert.match(body.input, /VALIDATED RUNTIME INPUTS/);
});

test("mocked model output advances only after deterministic validation", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  let seen: any = null;
  globalThis.fetch = async (url, init) => { seen = new Request(url, init); return new Response(JSON.stringify({ status: "completed", output_text: JSON.stringify(draft()) }), { status: 200, headers: { "content-type": "application/json" } }); };
  try {
    const result = await generateOutreachComposerDraft(input);
    assert.equal(result.model.status, "DRAFT_READY");
    assert.match(result.renderedBody, /LinkedIn: https:\/\/www\.linkedin\.com\/in\/raphaeldomalik\//);
    const requestBody = await seen.json();
    assert.equal(requestBody.text.format.strict, true);
    assert.equal(requestBody.tools, undefined);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("sequence preparation is bounded to three mocked stages and isolated Composer tables", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  const calls: string[] = [];
  const tables: string[] = [];
  const stageBodies = [words, words, Array.from({ length: 50 }, (_, index) => index === 0 ? "Current" : `evidence${index}`).join(" ")];
  globalThis.fetch = async (_url, init) => {
    calls.push("responses");
    const request = JSON.parse(String(init?.body)) as { input: string; text: { format: { type: string; strict: boolean; name: string } } };
    assert.equal(request.text.format.type, "json_schema");
    assert.equal(request.text.format.strict, true);
    assert.equal(request.text.format.name, "outreach_composer_draft");
    const stage = calls.length as 1 | 2 | 3;
    return new Response(JSON.stringify({ status: "completed", output_text: JSON.stringify(draft({ sequenceStage: `EMAIL_${stage}` as ComposerStructuredDraft["sequenceStage"], subject: `Stage ${stage}`, bodyPlainText: stageBodies[stage - 1] })) }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = {
    from(table: string) {
      tables.push(table);
      return {
        insert(_value: unknown) {
          if (table === "ai_outreach_drafts") return { select() { return { single: async () => ({ data: { id: "draft-1" }, error: null }) }; } };
          return { select: async () => ({ data: [{ id: "version-1" }, { id: "version-2" }, { id: "version-3" }], error: null }) };
        },
      };
    },
  };
  try {
    const result = await createComposerSequence(client as any, input, "operator-1", "account-1", "brief-1", null);
    assert.equal(result.generated.length, 3);
    assert.equal(calls.length, 3);
    assert.deepEqual(tables, ["ai_outreach_drafts", "ai_outreach_draft_versions"]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("validation rejects model-generated signature, unknown evidence and unapproved links", () => {
  assert.throws(() => validateOutreachComposerDraft(input, draft({ bodyPlainText: `${words}\n\nRaphael Domalik\nEventSuite` }), { responseStatus: "completed", incompleteReason: null, refusalStatus: null, outputItemTypes: [], schemaValidationError: null, truncation: false, parserPath: "test" }), /signature/);
  assert.throws(() => validateOutreachComposerDraft(input, draft({ personalisationEvidenceIds: ["unknown"] }), { responseStatus: "completed", incompleteReason: null, refusalStatus: null, outputItemTypes: [], schemaValidationError: null, truncation: false, parserPath: "test" }), /unknown evidence/);
  assert.throws(() => validateOutreachComposerDraft(input, draft({ bodyPlainText: `${words} https://evil.example` }), { responseStatus: "completed", incompleteReason: null, refusalStatus: null, outputItemTypes: [], schemaValidationError: null, truncation: false, parserPath: "test" }), /body word count|unapproved URL/);
});

test("stop states cannot be bypassed by a model draft", () => {
  const stopped = { ...input, sequence: { stage: "EMAIL_2" as const, stopState: "REPLIED" as const } };
  assert.throws(() => validateOutreachComposerDraft(stopped, draft({ sequenceStage: "EMAIL_2" }), { responseStatus: "completed", incompleteReason: null, refusalStatus: null, outputItemTypes: [], schemaValidationError: null, truncation: false, parserPath: "test" }), /stopped sequence/);
  assert.doesNotThrow(() => validateOutreachComposerDraft(stopped, draft({ sequenceStage: "EMAIL_2", status: "DO_NOT_DRAFT", bodyPlainText: "", personalisationEvidenceIds: [] }), { responseStatus: "completed", incompleteReason: null, refusalStatus: null, outputItemTypes: [], schemaValidationError: null, truncation: false, parserPath: "test" }));
});

test("human edits remain bounded, deterministic and isolated from sending", async () => {
  const edited = validateHumanEditedComposerText("A relevant question", words, "EMAIL_1");
  assert.match(edited.renderedBody, /LinkedIn: https:\/\/www\.linkedin\.com\/in\/raphaeldomalik\//);
  assert.throws(() => validateHumanEditedComposerText("A relevant question", `${words}\nSee https://evil.example`, "EMAIL_1"), /URL not allowlisted/);
  const tables: string[] = [];
  const client = { from(table: string) { tables.push(table); return { insert(value: unknown) { assert.equal((value as any).draft_version_id, "version-1"); return { select() { return this; }, single: async () => ({ data: { id: "review-1" }, error: null }) }; } }; } };
  await recordComposerReview(client as any, { versionId: "version-1", action: "EDIT_APPROVE", actorId: "operator-1", editedSubject: edited.subject, editedBody: edited.bodyPlainText, reasonTags: ["MANUAL_REWRITE"], stage: "EMAIL_1" });
  assert.deepEqual(tables, ["ai_outreach_draft_reviews"]);
});

test("Composer flags are server-only and default disabled", () => {
  const flags = productionActivation({});
  assert.equal(flags.outreachComposer, false);
  assert.equal(flags.outreachComposerPersistence, false);
  assert.equal(outreachComposerProductionEnabled({}), false);
  assert.equal(outreachComposerProductionEnabled({ [PRODUCTION_ACTIVATION_FLAGS.outreachComposer]: "true", [PRODUCTION_ACTIVATION_FLAGS.outreachComposerPersistence]: "true" }), true);
});

test("Composer migration is isolated from legacy sending tables", async () => {
  const sql = await readFile("supabase/migrations/20260822000001_ai_outreach_composer_v1.sql", "utf8");
  assert.match(sql, /ai_outreach_drafts/);
  assert.match(sql, /ai_outreach_draft_versions/);
  assert.match(sql, /ai_outreach_draft_reviews/);
  assert.match(sql, /enable row level security/g);
  const executableSql = sql.replace(/--.*$/gm, "").replace(/comment on table[\s\S]*?;\s*/gi, "");
  assert.doesNotMatch(executableSql, /outreach_messages|outreach_sequences|sendEmail|cron/i);
});

test("Composer route is default-gated and has no legacy send or cron path", async () => {
  const route = await readFile("app/api/ai-sales/outreach-composer/route.ts", "utf8");
  const post = route.slice(route.indexOf("export async function POST"));
  assert.ok(post.indexOf("if (!outreachComposerProductionEnabled())") < post.indexOf("const { client, user, member } = await actor()"));
  assert.doesNotMatch(route, /outreach_messages|outreach_sequences|sendApprovedOutreachMessage|processDueOutreachMessages/);
});
