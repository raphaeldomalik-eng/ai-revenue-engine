import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { crawlVenueOfficialSite } from "../src/nexus/source-discovery/venue/crawl.ts";
import { closeSharedBrowser, createPlaywrightRenderAdapter } from "../src/nexus/source-discovery/render-playwright.ts";
import { classifyWaveOutcome, evidenceIsUseful } from "./venue-crawler-wave1-lib.ts";

async function main() {
  console.log("=== RUNNING CONTROLLED CRAWLER PROOF (6 VENUES) ===");

  // Read manifest from Event-project
  const manifestPath = resolve(process.cwd(), "../Event-project/scripts/ops/manifest-next-crawl-programme.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  const q1 = manifest.queues.websiteKnownNeverCrawled.filter((x: any) => Boolean(x.website));
  const q2 = manifest.queues.technicalFailuresRetry;
  const q3 = manifest.queues.thinCrawlsExpand;

  const spaSites = q2.filter((x: any) => x.failureReasons?.includes("STATIC_RENDER_REQUIRED"));
  const nonSpaFailures = q2.filter((x: any) => !x.failureReasons?.includes("STATIC_RENDER_REQUIRED"));

  // Select 6 proof candidates: 2 thin, 2 previous failures, 2 SPA sites
  const proofTargets: Array<{ listingId: string; venueName: string; website: string; category: string }> = [
    { listingId: q3[0].listingId, venueName: q3[0].venueName, website: q3[0].website, category: "thin-expansion" },
    { listingId: q3[1].listingId, venueName: q3[1].venueName, website: q3[1].website, category: "thin-expansion" },
    { listingId: nonSpaFailures[0].listingId, venueName: nonSpaFailures[0].venueName, website: nonSpaFailures[0].website, category: "failure-retry" },
    { listingId: nonSpaFailures[1].listingId, venueName: nonSpaFailures[1].venueName, website: nonSpaFailures[1].website, category: "failure-retry" },
    { listingId: spaSites[0].listingId, venueName: spaSites[0].venueName, website: spaSites[0].website, category: "spa-headless" },
    { listingId: spaSites[1].listingId, venueName: spaSites[1].venueName, website: spaSites[1].website, category: "spa-headless" },
  ];

  console.log(`Selected ${proofTargets.length} proof targets:`);
  for (const t of proofTargets) {
    console.log(`- [${t.category}] ${t.venueName} (${t.website})`);
  }

  const renderAdapter = createPlaywrightRenderAdapter();
  const results = [];

  try {
    for (const target of proofTargets) {
      console.log(`\nCrawling: ${target.venueName} [${target.website}]...`);
      const started = Date.now();
      try {
        const crawlResult = await crawlVenueOfficialSite({
          authorisedUrl: target.website,
          venueName: target.venueName,
          renderAdapter,
        });

        const crawl = crawlResult.crawl;
        const documents = crawl?.documents ?? [];
        const html = documents.filter((d) => d.kind !== "PDF");
        const pdfs = documents.filter((d) => d.kind === "PDF");
        const useful = evidenceIsUseful(crawlResult.evidence);
        const contacts = crawlResult.evidence?.contacts ?? [];
        const emails = contacts.filter((c) => c.type === "email").map((c) => c.value);

        const outcome = classifyWaveOutcome({
          refusal: crawlResult.refusal,
          sameSite: crawlResult.sameSite,
          status: crawl?.stats.status ?? null,
          failureClass: crawl?.stats.failureClass ?? null,
          stopReason: crawl?.observability?.stopReason ?? crawlResult.refusal,
          warnings: crawl?.stats.warnings ?? [],
          htmlPages: html.length,
          pdfDocuments: pdfs.length,
          renderNeeded: crawl?.observability?.renderNeededButUnavailable.length ?? 0,
          useful,
        });

        const row = {
          listingId: target.listingId,
          venueName: target.venueName,
          website: target.website,
          category: target.category,
          outcome,
          stopReason: crawl?.observability?.stopReason ?? null,
          sameSite: crawlResult.sameSite,
          pages: html.length,
          requests: crawl?.stats.requestCount ?? 0,
          emails,
          spaces: crawlResult.evidence?.spaces.length ?? 0,
          capacities: crawlResult.evidence?.capacities.length ?? 0,
          practicalFacts: crawlResult.evidence?.practicalFacts.length ?? 0,
          renderedPages: crawl?.observability?.renderedPages ?? 0,
          elapsedMs: Date.now() - started,
        };

        console.log(`Result: outcome=${row.outcome}, pages=${row.pages}, emails=${emails.join(", ") || "none"}, facts=${row.practicalFacts}, spaces=${row.spaces}, rendered=${row.renderedPages}, time=${row.elapsedMs}ms`);
        results.push(row);
      } catch (err: any) {
        console.error(`Crawl error for ${target.venueName}:`, err.message);
        results.push({
          listingId: target.listingId,
          venueName: target.venueName,
          website: target.website,
          category: target.category,
          outcome: "FAILED",
          error: err.message,
          elapsedMs: Date.now() - started,
        });
      }
    }
  } finally {
    await closeSharedBrowser();
  }

  console.log("\n=== PROOF SUMMARY ===");
  console.table(results.map((r) => ({
    venue: r.venueName.slice(0, 25),
    category: r.category,
    outcome: r.outcome,
    pages: (r as any).pages ?? 0,
    emails: (r as any).emails?.length ?? 0,
    facts: (r as any).practicalFacts ?? 0,
    rendered: (r as any).renderedPages ?? 0,

  })));

  const outPath = resolve(process.cwd(), "docs/quality/proof-crawl-results.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`Proof results saved to ${outPath}`);
}

main().catch((err) => {
  console.error("Proof runner failed:", err);
  process.exit(1);
});
