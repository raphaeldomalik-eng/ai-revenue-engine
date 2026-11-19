import {test,expect} from '@playwright/test';

test('partial work remains accountable and past manual contact retains evidence through API, audit and reload',async({page,context})=>{
 test.setTimeout(90000);
 const external:string[]=[];
 await context.route('**/*',route=>{if(!route.request().url().startsWith('http://127.0.0.1:3123/')){external.push(route.request().url());return route.abort();}return route.continue();});
 await page.goto('/lead-preview');await page.getByRole('button',{name:'Open synthetic operator',exact:true}).click();
 const initial=await page.evaluate(async()=>await(await fetch('/api/incoming-leads?view=all')).json());
 const demo=initial.leads.find((l:any)=>l.display_name==='Alex · synthetic demo'),owner=initial.members.find((m:any)=>m.member_role==='operator').user_id;
 const legacy=await page.evaluate(async({id,owner})=>{
  const res=await fetch('/api/incoming-leads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({leadId:id,action:'ASSIGN_OWNER',value:{ownerId:owner}})});return res.status;
 },{id:demo.id,owner});expect(legacy).toBe(200);
 await page.reload();await page.getByRole('button',{name:/^Incomplete work \d/}).click();
 const row=page.getByRole('row').filter({hasText:'Alex · synthetic demo'});await expect(row).toContainText('No next action');await expect(row).toContainText('No follow-up date');
 await expect(page.getByLabel('Incoming lead operational metrics')).toContainText('Incomplete work plans');
 await page.screenshot({path:'test-results/lead-accountability-incomplete.png',fullPage:true});
 await row.getByRole('button',{name:'Review',exact:true}).click();const drawer=page.getByRole('complementary',{name:'Quick review for Alex · synthetic demo'});
 await drawer.getByLabel('Recorded next action',{exact:true}).fill('Review the fictional manual-contact note');await drawer.getByLabel('Follow-up due',{exact:true}).fill('2026-11-20T09:00');
 await drawer.getByRole('button',{name:'Save work plan',exact:true}).click();
 // The complete plan leaves the incomplete-work queue; reopen through All records.
 await page.getByLabel('Close quick review').click();await page.getByRole('button',{name:/^All records \d/}).click();await row.getByRole('button',{name:'Review',exact:true}).click();
 await drawer.getByText('Record past manual contact',{exact:true}).click();const record=drawer.getByRole('button',{name:'Record manual contact evidence',exact:true});await expect(record).toBeDisabled();
 const noEvidence=await page.evaluate(async id=>(await fetch('/api/incoming-leads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({leadId:id,action:'MARK_CONTACTED'})})).status,demo.id);expect(noEvidence).toBe(400);
 await drawer.getByLabel('Contact occurred at',{exact:true}).fill('2026-11-17T09:00');await drawer.getByLabel('Contact receipt / evidence reference',{exact:true}).fill('synthetic-call-note-browser-123');await drawer.getByLabel('Manual contact summary',{exact:true}).fill('Fictional retrospective call note; no real contact made');await record.click();
 await expect(drawer.getByLabel('Contact receipt / evidence reference',{exact:true})).toHaveValue('');
 await drawer.getByText('Notes and audit history',{exact:true}).click();await expect(drawer.getByText(/Receipt \/ evidence: synthetic-call-note-browser-123/)).toBeVisible();await expect(drawer.getByText(/Delivery is not verified/)).toBeVisible();
 await page.screenshot({path:'test-results/lead-accountability-contact.png',fullPage:true});
 const detail=await page.evaluate(async id=>await(await fetch(`/api/incoming-leads?leadId=${id}`)).json(),demo.id);
 expect(new Date(detail.lead.last_contacted_at).toISOString()).toBe('2026-11-17T09:00:00.000Z');expect(detail.activities).toHaveLength(1);expect(detail.changes.filter((c:any)=>c.action==='MARK_CONTACTED')).toHaveLength(1);expect(detail.changes.find((c:any)=>c.action==='MARK_CONTACTED').new_values.contactEvidence.deliveryVerified).toBe(false);
 await page.reload();await expect(row).toContainText('Contacted');await row.getByRole('button',{name:'Review',exact:true}).click();await drawer.getByText('Notes and audit history',{exact:true}).click();await expect(drawer.getByText(/synthetic-call-note-browser-123/)).toBeVisible();
 await page.goto('/lead-preview');await page.getByRole('button',{name:'Open read-only viewer',exact:true}).click();
 const denied=await page.evaluate(async id=>(await fetch('/api/incoming-leads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({leadId:id,action:'MARK_CONTACTED',value:{contactedAt:'2026-11-17T09:00:00Z',channel:'PHONE',evidenceReference:'viewer-forbidden',summary:'Should not persist'}})})).status,demo.id);expect(denied).toBe(403);expect(external).toEqual([]);
});
