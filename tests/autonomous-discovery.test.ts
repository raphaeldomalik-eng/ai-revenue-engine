import assert from "node:assert/strict";
import test from "node:test";
import { canonicalDiscoveryKey, evaluateDiscoveryCandidate, parseDiscovery } from "../src/ai-sales-team/discovery.ts";
import { readFileSync } from "node:fs";

const fact = (claim: string, sourceUrl = "https://example.org/event") => ({ claim, sourceUrl, sourceTitle: "Public event page", kind: "FACT" as const, confidence: "HIGH" as const });
const candidate = (overrides: Record<string, unknown> = {}) => ({ canonicalName: "Karoo Regional Festival", organiserName: "Karoo Events", website: "https://karoo.example.org", origin: "EVENT_FIRST" as const, relationshipHint: "PROSPECT" as const, facts: [fact("Karoo Events organises an annual regional festival with paid tickets and fragmented public event information.")], inferences: [], unknowns: [], ...overrides });

test("regional event-first candidate qualifies EGS without a size penalty", () => {
  const result = evaluateDiscoveryCandidate(candidate(), "ZA");
  assert.equal(result.status, "QUALIFIED");
  assert.equal(result.prospectIntelligence.eventConnection.state, "CONFIRMED");
  assert.equal(result.prospectIntelligence.primaryEntryOpportunity, "EGS");
  assert.equal(result.prospectIntelligence.commercialPriority, "HIGH");
});

test("university qualifies only from actual event activity, not AI topic similarity", () => {
  const topicOnly = evaluateDiscoveryCandidate(candidate({ canonicalName: "University AI Institute", organiserName: "University AI Institute", facts: [fact("The institute researches artificial intelligence.")] }), "ZA");
  const conference = evaluateDiscoveryCandidate(candidate({ canonicalName: "University Conference", organiserName: "University Faculty", facts: [fact("The faculty hosts an annual public conference with registration and a multi-session programme.")] }), "ZA");
  assert.equal(topicOnly.status, "REJECTED");
  assert.equal(conference.prospectIntelligence.eventConnection.state, "CONFIRMED");
  assert.notEqual(conference.status, "REJECTED");
});

test("competitor platform is blocked while a competitor customer remains a prospect", () => {
  const platform = evaluateDiscoveryCandidate(candidate({ canonicalName: "Example Ticketing Platform", organiserName: "Example Ticketing Platform", relationshipHint: "COMPETITOR", facts: [fact("Example Ticketing Platform provides event ticketing software.")] }), "ZA");
  const organiser = evaluateDiscoveryCandidate(candidate({ facts: [fact("The organiser runs an annual paid festival using another ticketing provider and has fragmented public information.")] }), "GB");
  assert.equal(platform.status, "BLOCKED");
  assert.equal(organiser.relationship, "PROSPECT");
  assert.equal(organiser.prospectIntelligence.outreachEligibility, "ELIGIBLE");
});

test("duplicate sources resolve to one canonical candidate and old or unsupported candidates do not qualify", () => {
  const parsed = parseDiscovery({ candidates: [candidate(), candidate({ facts: [fact("A venue listing confirms Karoo Events organises the annual regional festival.", "https://venue.example.org/listing")] })] }, "ZA");
  const old = evaluateDiscoveryCandidate(candidate({ canonicalName: "Historic Event", organiserName: "Historic Event", facts: [fact("A historical event took place in 2012.")] }), "ZA");
  assert.equal(parsed.length, 1);
  assert.equal(old.status, "REJECTED");
  assert.equal(canonicalDiscoveryKey("Karoo Events", "https://karoo.example.org"), canonicalDiscoveryKey("Karoo Events", "https://karoo.example.org/another-page"));
});

test("discovery migration is narrowly scoped and preserves internal-member RLS", () => {
  const sql = readFileSync("supabase/migrations/20260819000004_autonomous_prospect_discovery_v1.sql", "utf8");
  assert.match(sql, /create table if not exists public\.ai_prospect_discovery_runs/);
  assert.match(sql, /create table if not exists public\.ai_prospect_candidates/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /operators manage discovery runs/);
  assert.match(sql, /operators manage discovery candidates/);
});
