import test from 'node:test';
import assert from 'node:assert/strict';
import { publicContactProfile } from '../src/nexus/source-discovery/extractors/profiles.ts';
import { acceptVenueEmail } from '../src/nexus/venue-email.ts';
import { venueCrawlProfiles } from '../src/nexus/source-discovery/venue/profiles.ts';
import { executeSourceDiscoveryRequest } from '../src/nexus/executor.ts';
import { validateSourceDiscoveryResult } from '../src/nexus/contracts.ts';

test('email recovery follows functions pages and relevant contact documents', () => {
  const p = publicContactProfile({ emailGoal: true, venueName: 'Hazlitt Theatre' });
  assert.ok(p.linkDimensions('https://venue.org/functions/', 'Functions').includes('PUBLIC_CONTACT:EMAIL'));
  assert.ok(p.pdfDimensions('https://venue.org/downloads/venue-hire.pdf', 'Venue hire pack')?.includes('PUBLIC_CONTACT:EMAIL'));
  assert.equal(p.pdfDimensions('https://venue.org/annual-accounts.pdf', 'Annual accounts'), null);
});

test('the venue acquisition profile preserves the email goal for functions and documents', () => {
  const profile = venueCrawlProfiles(undefined, { emailGoal: true, venueName: 'Hazlitt Theatre' }).find(p => p.extractor === 'PUBLIC_CONTACT')!;
  assert.ok(profile.linkDimensions('https://venue.org/functions/', 'Functions').includes('PUBLIC_CONTACT:EMAIL'));
  assert.ok(profile.pdfDimensions('https://venue.org/venue-hire.pdf', 'Hire pack')?.includes('PUBLIC_CONTACT:EMAIL'));
});

test('personal staff mailbox cannot stop the email search on the same domain', () => {
  assert.equal(acceptVenueEmail('jane.smith@venue.org', 'https://venue.org/contact/', 'Hazlitt Theatre', 'Contact: Jane Smith').accepted, false);
});

test('published university and council venue mailboxes retain their first-party relationship', () => {
  for (const [email, page, name] of [
    ['boxoffice@kent.ac.uk', 'https://thegulbenkian.co.uk/', 'Gulbenkian Arts Centre'],
    ['assemblyhall@islington.gov.uk', 'https://islingtonassemblyhall.co.uk/hire-the-venue/', 'Islington Assembly Hall'],
    ['hazlitt.boxoffice@parkwoodtheatres.co.uk', 'https://www.parkwoodtheatres.co.uk/hazlitt-theatre', 'Hazlitt Theatre'],
    ['artscape@artscape.co.za', 'https://www.artscape.co.za/', 'Artscape Theatre Centre'],
  ]) assert.equal(acceptVenueEmail(email!, page!, name!).accepted, true, email);
});

test('council venue mailbox survives extraction through the real executor', async () => {
  const request = {
    contractVersion: 'nexus.source-discovery-request.v1',
    discoveryRequestId: '44444444-4444-4444-8444-444444444441', idempotencyKey: '22222222-2222-4222-8222-222222222221', correlationId: '33333333-3333-4333-8333-333333333331',
    originatingProduct: 'event_suite_resources', subjectReference: { canonicalEntityId: null, candidateReference: { sourceSystem: 'event_suite_resources', sourceRecordId: 'Islington Assembly Hall' }, entityType: 'VENUE' },
    verifiedSourceUrl: 'https://islingtonassemblyhall.co.uk/', acquisitionGoal: 'VENUE_EMAIL', venueName: 'Islington Assembly Hall', requestedExtractors: ['PUBLIC_CONTACT'],
    freshnessRequirements: { maxAgeHours: 24 }, crawlBudget: { maxPages: 4, maxRequests: 10, maxBytesPerResponse: 100000, maxRedirects: 2, maxRetries: 0, timeoutMs: 1000, minRequestDelayMs: 0 }, existingEvidenceRefs: [], requestedBy: { actorType: 'PRODUCT', actorId: 'resources' }, createdAt: '2026-10-19T00:00:00Z',
  };
  const result = validateSourceDiscoveryResult(await executeSourceDiscoveryRequest(request, {
    resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async input => new URL(String(input)).pathname === '/robots.txt' ? new Response('User-agent: *\nAllow: /') : new Response('<html><body><a href="mailto:assemblyhall@islington.gov.uk">assemblyhall@islington.gov.uk</a></body></html>', { headers: { 'content-type': 'text/html' } }),
  }));
  assert.equal(result.guideEmailReady, true);
  assert.equal(result.publicContacts.find(c => c.type === 'EMAIL')?.reviewRequired, false);
});
