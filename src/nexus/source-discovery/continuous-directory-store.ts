import type {SupabaseClient} from '@supabase/supabase-js';
import type {ContinuousLedger,Reservation,Completion} from './continuous-directory-policy.ts';
import {SupabaseNexusResultStore} from '../persistence.ts';
export class SupabaseDirectoryResultStore extends SupabaseNexusResultStore{
 constructor(private readonly directoryClient:SupabaseClient){super(directoryClient)}
 override async set(key:string,result:Record<string,unknown>){const {data,error}=await this.directoryClient.rpc('store_nexus_directory_result',{p_key:key,p_result:result});if(error)throw error;if(!['STORED','REUSED'].includes(data?.state))throw Error('DIRECTORY_RESULT_NOT_STORED');}
}
/** Shared database reservations enforce budgets across workers, restarts and concurrent ticks. */
export class SupabaseContinuousDirectoryLedger implements ContinuousLedger{
 constructor(private readonly client:SupabaseClient){}
 async isQuarantined(policyId:string,identityKey:string){const {data,error}=await this.client.from('nexus_directory_work_receipt').select('reservation_key').eq('policy_id',policyId).eq('identity_key',identityKey).eq('state','QUARANTINED').limit(1);if(error)throw error;return Boolean(data?.length);}
 async reserve(reservation:Reservation){const {data,error}=await this.client.rpc(reservation.runId?'reserve_nexus_directory_run_work':'reserve_nexus_directory_work',{p_reservation:reservation});if(error)throw error;return data?.state==='RESERVED';}
 async nextEligibleAt(reservation:Reservation){
  // Mirror the existing reservation guard across policy epochs. This is a
  // read of the original receipts; no retry date or usage history is changed.
  const {data,error}=await this.client.from('nexus_directory_work_receipt').select('queue_id,state,next_attempt_at,lease_until').eq('identity_key',reservation.identityKey).in('state',['RESERVED','RETRYABLE']);if(error)throw error;
  const dates=(data??[]).flatMap(row=>row.state==='RESERVED'?[Date.parse(row.lease_until)]:row.queue_id===reservation.queueId?[Date.parse(row.next_attempt_at)]:[]).filter(time=>Number.isFinite(time)&&time>Date.now());
  return dates.length?new Date(Math.max(...dates)).toISOString():null;
 }
 async complete(receipt:Completion){const {data,error}=await this.client.rpc('complete_nexus_directory_work',{p_receipt:receipt});if(error)throw error;if(data?.state!=='RECORDED')throw Error('DIRECTORY_RECEIPT_NOT_RECORDED');}
}
