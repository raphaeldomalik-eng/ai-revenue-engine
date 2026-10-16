import fs from 'node:fs';
import path from 'node:path';

process.loadEnvFile('.env.production.local');
const secret = process.env.NEXUS_HMAC_SECRET?.trim();
if (!secret) {
  console.error('NEXUS_HMAC_SECRET is missing from .env.production.local');
  process.exit(1);
}

const MANIFEST_PATH = path.resolve('..', 'Event-project', 'scripts', 'ops', 'manifest-next-crawl-programme.json');
const RESULTS_JSONL_PATH = path.resolve('docs', 'quality', '2026-10-16-venue-serper-discovery-results.jsonl');
const SUMMARY_AIRE_PATH = path.resolve('docs', 'quality', '2026-10-16-venue-serper-discovery-summary.json');
const SUMMARY_EP_PATH = path.resolve('..', 'Event-project', 'scripts', 'ops', 'recovery-serper-discovery-summary.json');

const ENDPOINT = 'https://ai-revenue-engine-pearl.vercel.app/api/admin/website-discovery';
const MAX_BUDGET_USD = 2.00;
const COST_PER_CALL_USD = 0.001;
const MAX_ALLOWED_CALLS = Math.floor(MAX_BUDGET_USD / COST_PER_CALL_USD); // 2,000 calls
const CHUNK_SIZE = 5;

// Load manifest
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const fullQueue = manifest.queues.websiteDiscovery || [];
console.log(`Loaded ${fullQueue.length} venues from manifest websiteDiscovery queue.`);

// Check existing progress for resume capability
const completedListingIds = new Set();
if (fs.existsSync(RESULTS_JSONL_PATH)) {
  const lines = fs.readFileSync(RESULTS_JSONL_PATH, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.listingId) completedListingIds.add(parsed.listingId);
    } catch {
      // ignore
    }
  }
  console.log(`Found ${completedListingIds.size} already completed venues in ${RESULTS_JSONL_PATH}.`);
}

const pendingVenues = fullQueue.filter((v) => !completedListingIds.has(v.listingId));
console.log(`Pending venues to process: ${pendingVenues.length}`);

// Parse args for --limit (e.g. for testing) or --concurrency
const args = process.argv.slice(2);
let limit = pendingVenues.length;
const limitArgIdx = args.indexOf('--limit');
if (limitArgIdx !== -1 && args[limitArgIdx + 1]) {
  limit = parseInt(args[limitArgIdx + 1], 10);
  console.log(`Limiting execution to ${limit} venues.`);
}

let concurrency = 3;
const concurrencyArgIdx = args.indexOf('--concurrency');
if (concurrencyArgIdx !== -1 && args[concurrencyArgIdx + 1]) {
  concurrency = parseInt(args[concurrencyArgIdx + 1], 10);
}
console.log(`Concurrency set to ${concurrency}.`);

const targetVenues = pendingVenues.slice(0, limit);

// Process chunks
const chunks = [];
for (let i = 0; i < targetVenues.length; i += CHUNK_SIZE) {
  chunks.push(targetVenues.slice(i, i + CHUNK_SIZE));
}
console.log(`Prepared ${chunks.length} chunks of up to ${CHUNK_SIZE} venues.`);

let totalSerperCalls = 0;
let totalCostUsd = 0;
let acceptedWebsites = 0;
let noCredibleWebsite = 0;
let candidatesAmbiguous = 0;
let errors = 0;
let stoppedDueToBudget = false;

async function processChunk(chunk, chunkIndex) {
  if (totalSerperCalls >= MAX_ALLOWED_CALLS || totalCostUsd >= MAX_BUDGET_USD) {
    stoppedDueToBudget = true;
    return;
  }

  const payload = {
    action: 'discover',
    venues: chunk.map((v) => ({
      listingId: v.listingId,
      venueName: v.venueName,
      city: v.city,
      country: 'ZA',
      placeId: v.placeId,
    })),
    options: { maxSearchCalls: 1 },
  };

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-nexus-admin-secret': secret,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Chunk ${chunkIndex + 1} HTTP error ${res.status}: ${errText}`);
      errors += chunk.length;
      return;
    }

    const data = await res.json();
    const serperCallsInChunk = data.serperCalls ?? 0;
    totalSerperCalls += serperCallsInChunk;
    totalCostUsd = totalSerperCalls * COST_PER_CALL_USD;

    for (const r of data.results || []) {
      fs.appendFileSync(RESULTS_JSONL_PATH, JSON.stringify(r) + '\n');
      if (r.websiteStatus === 'OFFICIAL_WEBSITE_DISCOVERED_AND_VERIFIED') {
        acceptedWebsites += 1;
      } else if (r.websiteStatus === 'WEBSITE_CANDIDATES_AMBIGUOUS') {
        candidatesAmbiguous += 1;
      } else if (r.websiteStatus === 'NO_CREDIBLE_WEBSITE_FOUND') {
        noCredibleWebsite += 1;
      } else if (r.websiteStatus === 'ERROR') {
        errors += 1;
      }
    }

    const progressPct = (((chunkIndex + 1) / chunks.length) * 100).toFixed(1);
    console.log(
      `[${progressPct}%] Chunk ${chunkIndex + 1}/${chunks.length} done | ` +
      `Serper calls: ${totalSerperCalls} ($${totalCostUsd.toFixed(3)}) | ` +
      `Accepted: ${acceptedWebsites} | Ambiguous: ${candidatesAmbiguous} | No site: ${noCredibleWebsite} | Errors: ${errors}`
    );
  } catch (err) {
    console.error(`Chunk ${chunkIndex + 1} network exception:`, err.message);
    errors += chunk.length;
  }
}

async function run() {
  const startTime = Date.now();
  console.log(`\n=== Starting Serper Website Discovery Programme ===`);
  console.log(`Max budget ceiling: $${MAX_BUDGET_USD.toFixed(2)} (${MAX_ALLOWED_CALLS} queries)`);

  // Process chunks with bounded concurrency
  let activeIndex = 0;
  async function worker() {
    while (activeIndex < chunks.length) {
      if (stoppedDueToBudget) break;
      const idx = activeIndex++;
      await processChunk(chunks[idx], idx);
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

  // Read all rows from results file for comprehensive summary
  const allResults = fs.readFileSync(RESULTS_JSONL_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const finalAccepted = allResults.filter(r => r.websiteStatus === 'OFFICIAL_WEBSITE_DISCOVERED_AND_VERIFIED');
  const finalAmbiguous = allResults.filter(r => r.websiteStatus === 'WEBSITE_CANDIDATES_AMBIGUOUS');
  const finalNone = allResults.filter(r => r.websiteStatus === 'NO_CREDIBLE_WEBSITE_FOUND');
  const finalErrors = allResults.filter(r => r.websiteStatus === 'ERROR');

  const summary = {
    executedAt: new Date().toISOString(),
    elapsedSeconds: parseFloat(elapsedSec),
    budgetEnforcement: {
      budgetCapUsd: MAX_BUDGET_USD,
      maxAllowedCalls: MAX_ALLOWED_CALLS,
      totalSerperCalls,
      totalCostUsd,
      stoppedDueToBudget,
    },
    inventoryCounts: {
      totalManifestQueue: fullQueue.length,
      previouslyCompleted: completedListingIds.size,
      processedInThisRun: targetVenues.length,
      totalResultsSaved: allResults.length,
    },
    outcomes: {
      acceptedOfficialWebsites: finalAccepted.length,
      ambiguousCandidates: finalAmbiguous.length,
      noCredibleWebsiteFound: finalNone.length,
      errors: finalErrors.length,
    },
    nextCrawlReadyCohort: {
      count: finalAccepted.length,
      description: "Venues with newly discovered and identity-verified official websites ready for internal crawling.",
      sample: finalAccepted.slice(0, 10).map(r => ({
        listingId: r.listingId,
        venueName: r.venueName,
        officialWebsite: r.officialWebsite?.url,
        verificationSignals: r.officialWebsite?.verificationSignals,
      })),
    },
  };

  fs.writeFileSync(SUMMARY_AIRE_PATH, JSON.stringify(summary, null, 2));
  fs.writeFileSync(SUMMARY_EP_PATH, JSON.stringify(summary, null, 2));

  console.log(`\n=== Website Discovery Summary ===`);
  console.log(`Total Venues Processed: ${allResults.length} / ${fullQueue.length}`);
  console.log(`Accepted Official Websites: ${finalAccepted.length}`);
  console.log(`Ambiguous Matches: ${finalAmbiguous.length}`);
  console.log(`No Credible Website Found: ${finalNone.length}`);
  console.log(`Errors: ${finalErrors.length}`);
  console.log(`Serper Queries Used: ${totalSerperCalls}`);
  console.log(`Total Cost: $${totalCostUsd.toFixed(4)} (Ceiling: $${MAX_BUDGET_USD.toFixed(2)})`);
  console.log(`Elapsed Time: ${elapsedSec}s`);
  console.log(`Summaries saved to:`);
  console.log(`  - ${SUMMARY_AIRE_PATH}`);
  console.log(`  - ${SUMMARY_EP_PATH}`);
}

run().catch(console.error);
