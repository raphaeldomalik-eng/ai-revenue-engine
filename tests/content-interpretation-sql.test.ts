import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomBytes} from "node:crypto";
import {Client} from "pg";

test("real SQL reservations serialize concurrent callers and expired drafts purge without releasing spent budgets",{skip:!process.env.PROVIDER_CONTENT_TEST_DATABASE_URL},async()=>{
  const url=new URL(process.env.PROVIDER_CONTENT_TEST_DATABASE_URL!);
  assert.ok(["localhost","127.0.0.1"].includes(url.hostname));
  const database="provider_content_are_"+randomBytes(6).toString("hex");
  assert.match(database,/^provider_content_are_[a-f0-9]{12}$/);
  const admin=new Client({connectionString:url.href});await admin.connect();
  const clients:Client[]=[];
  try{
    await admin.query(`create database ${database}`);url.pathname="/"+database;
    for(let i=0;i<3;i++){const connection=new Client({connectionString:url.href});await connection.connect();clients.push(connection);}
    const [fixture,first,second]=clients;
    await fixture.query("do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon; end if; if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select from pg_roles where rolname='service_role') then create role service_role; end if; end $$; create schema auth; create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role',true) $$;");
    await fixture.query(readFileSync("supabase/migrations/20260921100000_nexus_executor_results.sql","utf8"));
    await fixture.query(readFileSync("supabase/migrations/20261009170000_content_interpretation_budget.sql","utf8"));
    await fixture.query(readFileSync("supabase/migrations/20261009183000_organisation_seed_budget.sql","utf8"));
    const key="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",fingerprint="1".repeat(64);
    const reservation="insert into public.nexus_content_model_reservations(idempotency_key,request_fingerprint) values($1::uuid,$2) on conflict do nothing returning idempotency_key";
    await first.query("begin");assert.equal((await first.query(reservation,[key,fingerprint])).rowCount,1);
    let settled=false;const concurrent=second.query(reservation,[key,fingerprint]).then(result=>{settled=true;return result;});
    await fixture.query("select pg_sleep(0.05)");assert.equal(settled,false,"The competing reservation must wait for the first transaction");
    await first.query("commit");assert.equal((await concurrent).rowCount,0,"Exactly one caller reserves the model budget");
    await fixture.query("insert into public.nexus_executor_results(idempotency_key,contract_version,request_id,result_payload) values($1,'nexus.content-interpretation-result.v1',$1,$2::jsonb)",[key,JSON.stringify({sourceExpiresAt:"2020-01-01T00:00:00.000Z",whyGoDraft:{text:"Expired recommendation"},execution:{modelCalls:1,costUSD:0.001},requestFingerprint:fingerprint})]);
    await assert.rejects(fixture.query("select public.purge_expired_content_interpretation_results()"),/SERVICE_ROLE_REQUIRED/);
    await fixture.query("select set_config('request.jwt.claim.role','service_role',false)");
    assert.equal((await fixture.query("select public.purge_expired_content_interpretation_results() as count")).rows[0].count,1);
    assert.equal((await fixture.query("select public.purge_expired_content_interpretation_results() as count")).rows[0].count,0);
    const record=(await fixture.query("select result_payload from public.nexus_executor_results")).rows[0].result_payload;
    assert.equal(record.whyGoDraft,null);assert.equal(record.execution.modelCalls,1);
    assert.equal((await fixture.query("select count(*)::int as count from public.nexus_content_model_reservations")).rows[0].count,1);
    const programme="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await fixture.query("insert into public.nexus_organisation_seed_programmes(id,account_allowance_ref,max_search_calls,active,expires_at,approved_by,approved_at) values($1::uuid,'verified-free-account-allowance',1,true,now()+interval '1 day',$1::uuid,now())",[programme]);
    for(const client of [first,second])await client.query("select set_config('request.jwt.claim.role','service_role',false)");
    await first.query("begin");assert.equal((await first.query("select public.reserve_organisation_seed_search($1::uuid,$2::uuid,$3) as receipt",[programme,key,fingerprint])).rows[0].receipt.state,"RESERVED");
    const competing=second.query("select public.reserve_organisation_seed_search($1::uuid,$2::uuid,$3) as receipt",[programme,"cccccccc-cccc-4ccc-8ccc-cccccccccccc",fingerprint]);
    await first.query("commit");assert.equal((await competing).rows[0].receipt.state,"CAP_EXHAUSTED");
    assert.equal((await fixture.query("select public.reserve_organisation_seed_search($1::uuid,$2::uuid,$3) as receipt",[programme,key,fingerprint])).rows[0].receipt.state,"ALREADY_RESERVED");
    assert.equal((await fixture.query("select count(*)::int as count from public.nexus_organisation_seed_search_reservations")).rows[0].count,1);
    await assert.rejects(fixture.query("select public.reserve_organisation_seed_search($1::uuid,$2::uuid,$3)",[programme,key,"2".repeat(64)]),/IDEMPOTENCY_COLLISION/);
    await fixture.query("set role anon");await assert.rejects(fixture.query("select * from public.nexus_content_model_reservations"),/permission denied/);await fixture.query("reset role");
  }finally{
    await Promise.allSettled(clients.map(connection=>connection.end()));
    await admin.query(`drop database if exists ${database}`);await admin.end();
  }
});
