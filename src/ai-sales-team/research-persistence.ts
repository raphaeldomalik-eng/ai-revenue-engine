import type {SupabaseClient} from '@supabase/supabase-js';
import type {AiSalesPerson} from './model.ts';

// A refresh records new observations in evidence/brief history. Existing commercial
// state belongs to its verified source or human workflow, not this research run.
export async function saveResearchedContact(client:SupabaseClient,accountId:string,person:AiSalesPerson){
  const existing=await client.from('contacts').select('id').eq('account_id',accountId).eq('full_name',person.name).maybeSingle();
  if(existing.error)throw existing.error;
  if(existing.data)return;
  const values={account_id:accountId,full_name:person.name,role_title:person.role,verification_status:person.kind==='FACT'?'UNVERIFIED':'UNKNOWN',source:'ai_sales_team',metadata:{sourceUrl:person.sourceUrl,evidenceKind:person.kind,confidence:person.confidence}};
  const result=await client.from('contacts').insert(values);
  if(result.error)throw result.error;
}
export async function saveResearchedOpportunity(client:SupabaseClient,values:Record<string,unknown>){
  const existing=await client.from('product_opportunities').select('id').eq('account_id',values.account_id).eq('product_id',values.product_id).maybeSingle();
  if(existing.error)throw existing.error;
  if(existing.data)return existing.data.id as string;
  const result=await client.from('product_opportunities').insert(values).select('id').single();
  if(result.error)throw result.error;return result.data.id as string;
}
