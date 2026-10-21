import type { SupabaseClient } from "@supabase/supabase-js";
import type { BatchRequestReceipt, BatchRequestReservation, NexusResultStore } from "./executor.ts";
import type { ContentExecutionStore } from "./content-interpretation.ts";

export class SupabaseNexusResultStore implements NexusResultStore, ContentExecutionStore {
  constructor(private readonly client: SupabaseClient) {}
  async reserveOrganisationSeedSearch(programmeId:string,key:string,fingerprint:string):Promise<boolean>{
    const {data,error}=await this.client.rpc("reserve_organisation_seed_search",{p_programme_id:programmeId,p_idempotency_key:key,p_request_fingerprint:fingerprint});
    if(error)throw error;return data?.state==="RESERVED";
  }

  async reserveModelCall(key: string, fingerprint: string): Promise<boolean> {
    const { error } = await this.client.from("nexus_content_model_reservations").insert({ idempotency_key: key, request_fingerprint: fingerprint });
    if (!error) return true;
    if (error.code !== "23505") throw error;
    const { data, error: readError } = await this.client.from("nexus_content_model_reservations").select("request_fingerprint").eq("idempotency_key", key).single();
    if (readError) throw readError;
    if (data.request_fingerprint !== fingerprint) throw new Error("CONTENT_IDEMPOTENCY_COLLISION");
    return false;
  }

  async get(key: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await this.client.from("nexus_executor_results").select("result_payload").eq("idempotency_key", key).maybeSingle();
    if (error) throw error;
    return (data?.result_payload as Record<string, unknown> | null) ?? null;
  }

  async set(key: string, result: Record<string, unknown>): Promise<void> {
    const { error } = await this.client.from("nexus_executor_results").upsert({ idempotency_key: key, contract_version: String(result.contractVersion ?? "unknown"), request_id: String(result.requestId ?? result.discoveryRequestId ?? "unknown"), result_payload: result }, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (error) throw error;
  }

  async reserveBatchRequest(input: BatchRequestReservation): Promise<boolean> {
    const { data, error } = await this.client.rpc("reserve_nexus_source_discovery_batch_request", {
      p_scope_id: input.scopeId, p_manifest_sha256: input.manifestSha256, p_valid_from: input.validFrom, p_valid_until: input.validUntil,
      p_max_venues: input.maxVenues, p_max_requests_per_venue: input.maxRequestsPerVenue, p_max_total_requests: input.maxTotalRequests,
      p_listing_id: input.listingId, p_host: input.host, p_idempotency_key: input.idempotencyKey,
      p_request_sha256: input.requestSha256, p_request_budget: input.requestBudget,
    });
    if (error) throw error;
    return data?.state === "RESERVED";
  }

  async completeBatchRequest(input: BatchRequestReceipt): Promise<void> {
    const { data, error } = await this.client.rpc("complete_nexus_source_discovery_batch_request", {
      p_scope_id: input.scopeId, p_listing_id: input.listingId, p_idempotency_key: input.idempotencyKey,
      p_status: input.status, p_request_count: input.requestCount, p_bytes_read: input.bytesRead, p_result_status: input.resultStatus,
    });
    if (error) throw error;
    if (data?.state !== "RECORDED") throw new Error("BATCH_SCOPE_RECEIPT_NOT_RECORDED");
  }
}
