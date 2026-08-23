import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("prospect queue uses a bounded list projection and server pagination", async () => {
  const source = await readFile("app/api/operator/route.ts", "utf8");
  const listSection = source.slice(source.indexOf("async function prospectList"), source.indexOf("async function prospectDetail"));
  assert.match(listSection, /PROSPECT_LIST_FIELDS/);
  assert.doesNotMatch(listSection, /select\("\*"\)/);
  assert.match(listSection, /limit\(PROSPECT_LIST_LIMIT\)/);
  assert.match(listSection, /slice\(\(safePage - 1\) \* pageSize, safePage \* pageSize\)/);
  assert.match(listSection, /total: ordered\.length/);
  assert.match(listSection, /select\("id,account_id,name,full_name,title,role_title,verification_status,metadata"\)/);
  assert.match(listSection, /Promise\.all/);
});

test("prospect detail is an explicit lazy read and retains existing RLS path", async () => {
  const route = await readFile("app/api/operator/route.ts", "utf8");
  const ui = await readFile("app/operator/operator-views.tsx", "utf8");
  assert.match(route, /view === "prospect-detail"/);
  assert.match(route, /from\("research_evidence"\)\.select\("\*"\)\.eq\("account_id", accountId\)/);
  assert.match(ui, /view=prospect-detail&candidateId=/);
  assert.match(ui, /Loading evidence and review history/);
  assert.match(ui, /detailCache/);
  assert.doesNotMatch(ui.slice(ui.indexOf("export function ProspectsView"), ui.indexOf("const siteTypeLabelsForFilter")), /await refresh\(\)/);
});

test("queue state is encoded server-side and filter changes reset only on actual changes", async () => {
  const source = await readFile("app/operator/operator-views.tsx", "utf8");
  const active = source.slice(source.indexOf("export function ProspectsView"), source.indexOf("const siteTypeLabelsForFilter"));
  for (const parameter of ["queue", "search", "territory", "prospectType", "reviewState", "contactState", "emailState", "priority", "page", "pageSize"]) assert.match(active, new RegExp(`${parameter}`));
  assert.match(active, /if \(queue !== key\)/);
  assert.match(active, /if \(size !== pageSize\)/);
  assert.match(active, /data\.page && data\.page !== page/);
});

test("email actions are independently locked and scoped to one message", async () => {
  const source = await readFile("app/operator/operator-views.tsx", "utf8");
  assert.match(source, /emailBusyKeys/);
  assert.match(source, /if \(emailBusyKeys\.has\(busyKey\)\) return/);
  assert.match(source, /disabled=\{emailBusyKeys\.has\(String\(editKey\)\)\}/);
  assert.match(source, /setComposerDrafts\(\(current\) => current\.map\(\(item\) => item\.versionId === draft\.versionId/);
  assert.match(source, /action: "revise"/);
  assert.doesNotMatch(source, /Send|Schedule|Publish|Enrol|Activate sequence/);
});

test("performance migration indexes queue dimensions without changing RLS", async () => {
  const source = await readFile("supabase/migrations/20260823000001_operator_prospect_performance_v1.sql", "utf8");
  assert.match(source, /add column if not exists updated_at/);
  assert.match(source, /status, territory_code, updated_at desc/);
  assert.match(source, /origin, status, updated_at desc/);
  assert.doesNotMatch(source, /create policy|drop policy|revoke|grant/);
});
