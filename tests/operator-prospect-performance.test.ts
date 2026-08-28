import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("prospect queue uses a bounded list projection and server pagination", async () => {
  const source = await readFile("app/api/operator/route.ts", "utf8");
  const listSection = source.slice(source.indexOf("async function prospectList"), source.indexOf("async function prospectDetail"));
  assert.doesNotMatch(listSection, /PROSPECT_LIST_LIMIT|limit\(5000\)|\.slice\(/);
  assert.match(listSection, /rpc\("list_ai_prospect_queue"/);
  assert.match(listSection, /p_page_size: pageSize/);
  assert.match(listSection, /p_cursor: cursor/);
  assert.match(listSection, /encodeProspectQueueCursor/);
  assert.match(listSection, /total/);
  assert.match(listSection, /pageCount/);
  assert.match(listSection, /PAGINATION_CURSOR_INVALID/);
  assert.doesNotMatch(listSection, /from\("accounts"\)|from\("contacts"\)/);
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
  assert.match(active, /data\.pageCount/);
  assert.match(active, /cursorDirection/);
  assert.match(active, /setCursor\(null\)/);
  assert.match(active, /onNext=\{goNext\}/);
  assert.match(active, /onPrevious=\{goPrevious\}/);
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

test("performance and keyset migrations are ordered, forward-only and preserve RLS", async () => {
  const performancePath = "supabase/migrations/20260823000001_operator_prospect_performance_v1.sql";
  const keysetPath = "supabase/migrations/20260825000001_operator_prospect_keyset_pagination_v1.sql";
  const performance = await readFile(performancePath, "utf8");
  const keyset = await readFile(keysetPath, "utf8");
  assert.ok(performancePath < keysetPath);
  assert.match(performance, /add column if not exists updated_at/);
  assert.match(performance, /status, territory_code, updated_at desc/);
  assert.match(performance, /origin, status, updated_at desc/);
  assert.doesNotMatch(performance, /create or replace function public\.list_ai_prospect_queue/);
  assert.match(keyset, /territory_code, updated_at desc, id desc/);
  assert.match(keyset, /contacts_account_id_idx|contacts_account_id_idx/);
  assert.match(keyset, /create or replace function public\.list_ai_prospect_queue/);
  assert.match(keyset, /filtered_count/);
  assert.match(keyset, /count\(\*\)::integer as total/);
  assert.match(keyset, /security invoker/);
  assert.doesNotMatch(keyset, /list_ai_prospect_queue[\s\S]*security definer/);
  assert.doesNotMatch(keyset, /create policy/);
});
