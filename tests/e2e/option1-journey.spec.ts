import {test,expect} from '@playwright/test';
import {option1Journey} from '../fixtures/option1-journey';
import {handleOrganisationContactRequest} from '../../src/ai-sales-team/organisation-contact-http';

test('operator links a verified portfolio, explicitly selects Apollo replay and saves a person without provider or communication access',async({page,request})=>{
  const actualGate=await request.post('/api/ai-sales/contact-research',{data:{action:'search',candidateId:'hall',provider:'APOLLO_REPLAY'}});
  expect(actualGate.status()).toBe(503);
  const f=option1Journey();
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1')return route.abort();
    if(url.pathname==='/api/operator'){
      const detail=url.searchParams.get('view')==='prospect-detail';
      return route.fulfill({json:{access:'OPERATOR',runs:[],candidates:detail?f.candidates.filter(candidate=>candidate.id===url.searchParams.get('candidateId')):[],inventoryCounts:{ALL:2,NEEDS_REVIEW:0,QUALIFIED:2},total:0,page:1,pageCount:1}});
    }
    if(url.pathname==='/api/ai-sales/contact-research'){
      const browserRequest=route.request();
      const response=await handleOrganisationContactRequest(new Request(browserRequest.url(),{method:browserRequest.method(),...(browserRequest.method()==='POST'?{body:browserRequest.postData()}: {})}),{enabled:true,production:false,authorize:async()=>({actor:f.actor,deps:f.deps})});
      return route.fulfill({status:response.status,body:await response.text(),contentType:'application/json'});
    }
    return route.continue();
  });
  await page.goto('/operator/prospects?prospect=hall');
  const panel=page.getByRole('region',{name:'Organisation decision-maker research'});
  await expect(panel.getByLabel('Existing Nexus organisation ID')).toBeVisible();
  await panel.getByLabel('Existing Nexus organisation ID').fill(f.identity.nexusOrganisationId);
  await panel.getByRole('button',{name:'Link verified organisation'}).click();
  await expect(panel.getByRole('heading',{name:'Example Events',exact:true})).toBeVisible();
  await expect(panel.getByLabel('Related operator venues')).toContainText('Example Theatre');
  await expect(panel.getByRole('button',{name:'Review organisation shortlist'})).toBeDisabled();
  await panel.getByLabel('Research provider').selectOption('APOLLO_REPLAY');
  await panel.getByRole('button',{name:'Review organisation shortlist'}).click();
  await expect(panel.getByLabel('Relevant role shortlist')).toContainText('Alex Example');
  await expect(panel.getByLabel('Relevant role shortlist')).not.toContainText('Casey Example');
  await panel.getByRole('button',{name:'Save selection for Alex Example'}).click();
  await expect(panel.getByText('Human selection saved · replay evidence · no verified email')).toBeVisible();
  await page.reload();
  await expect(panel.getByText('Human selection saved · replay evidence · no verified email')).toBeVisible();
  expect(f.tables.organisation_contact_intelligence).toHaveLength(1);
  expect(f.tables.contacts).toEqual([f.contact]);expect(f.tables.product_opportunities).toEqual([f.opportunity]);
  await panel.getByText('Human selection saved · replay evidence · no verified email').scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-results/option1-contact-intelligence.png'});
});
