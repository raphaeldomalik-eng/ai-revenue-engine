import type { SupabaseClient } from "@supabase/supabase-js";
import type { NexusResultStore } from "./executor.ts";

export class SupabaseNexusResultStore implements NexusResultStore {
  constructor(private readonly client: SupabaseClient) {}

  async get(key: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await this.client.from("nexus_executor_results").select("result_payload").eq("idempotency_key", key).maybeSingle();
    if (error) throw error;
    return (data?.result_payload as Record<string, unknown> | null) ?? null;
  }

  async set(key: string, result: Record<string, unknown>): Promise<void> {
    const { error } = await this.client.from("nexus_executor_results").upsert({ idempotency_key: key, contract_version: String(result.contractVersion ?? "unknown"), request_id: String(result.requestId ?? result.discoveryRequestId ?? "unknown"), result_payload: result }, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (error) throw error;
  }
}
