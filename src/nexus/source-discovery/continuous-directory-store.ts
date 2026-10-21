import type {SupabaseClient} from '@supabase/supabase-js';
import type {ContinuousLedger,Reservation,Completion} from './continuous-directory-policy.ts';
/** Shared database reservations enforce budgets across workers, restarts and concurrent ticks. */
export class SupabaseContinuousDirectoryLedger implements ContinuousLedger{
 constructor(private readonly client:SupabaseClient){}
 async reserve(reservation:Reservation){const {data,error}=await this.client.rpc('reserve_nexus_directory_work',{p_reservation:reservation});if(error)throw error;return data?.state==='RESERVED';}
 async complete(receipt:Completion){const {data,error}=await this.client.rpc('complete_nexus_directory_work',{p_receipt:receipt});if(error)throw error;if(data?.state!=='RECORDED')throw Error('DIRECTORY_RECEIPT_NOT_RECORDED');}
}
