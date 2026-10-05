import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3042';
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACTS_DIR = 'C:\\Users\\rapha\\.gemini\\antigravity\\brain\\9d0a7940-294c-419c-b6cd-6096120ef4fd';
const DOCS_DIR = path.resolve('docs/product/operator-workspace-v1-design-pack/catalogue');

fs.mkdirSync(DOCS_DIR, { recursive: true });
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

const VIEWPORTS = [
  { width: 1366, height: 768, label: '1366x768' },
  { width: 1440, height: 900, label: '1440x900' },
  { width: 1920, height: 1080, label: '1920x1080' },
];

async function saveScreenshot(page, stateName, viewportLabel) {
  const filename = `${stateName}-${viewportLabel}.png`;
  const docsPath = path.join(DOCS_DIR, filename);
  const artifactPath = path.join(ARTIFACTS_DIR, filename);

  const buffer = await page.screenshot({ fullPage: false });
  fs.writeFileSync(docsPath, buffer);
  fs.writeFileSync(artifactPath, buffer);
  console.log(`Saved: ${filename} (${buffer.length} bytes)`);
}

async function run() {
  console.log('Starting Playwright screenshot capture...');
  const browser = await chromium.launch({
    executablePath: EDGE_PATH,
    headless: true,
  });

  for (const vp of VIEWPORTS) {
    console.log(`\n================ Processing Viewport: ${vp.label} ================`);
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    // 1. catalogue-collection
    console.log(`Capturing 01_catalogue-collection [${vp.label}]...`);
    await page.goto(`${BASE_URL}/operator/catalogue`, { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr.catalogue-table-row', { timeout: 15000 });
    await page.waitForTimeout(500);
    await saveScreenshot(page, '01_catalogue-collection', vp.label);

    // 2. overview-drawer
    console.log(`Capturing 02_overview-drawer [${vp.label}]...`);
    const firstRow = page.locator('tbody tr.catalogue-table-row').first();
    await firstRow.click();
    await page.waitForSelector('.catalogue-workbench-panel', { timeout: 5000 });
    await page.waitForTimeout(500);
    await saveScreenshot(page, '02_overview-drawer', vp.label);

    // 3. evidence
    console.log(`Capturing 03_evidence [${vp.label}]...`);
    await page.click('button.workbench-tab:has-text("Evidence")');
    await page.waitForTimeout(400);
    await saveScreenshot(page, '03_evidence', vp.label);

    // 4. classification
    console.log(`Capturing 04_classification [${vp.label}]...`);
    await page.click('button.workbench-tab:has-text("Classification")');
    await page.waitForTimeout(400);
    await saveScreenshot(page, '04_classification', vp.label);

    // 5. channels
    console.log(`Capturing 05_channels [${vp.label}]...`);
    await page.click('button.workbench-tab:has-text("Channels")');
    await page.waitForTimeout(400);
    await saveScreenshot(page, '05_channels', vp.label);

    // 6. research-budgets
    console.log(`Capturing 06_research-budgets [${vp.label}]...`);
    await page.click('button.workbench-tab:has-text("Research")');
    await page.waitForTimeout(400);
    await saveScreenshot(page, '06_research-budgets', vp.label);

    // 7. promote-to-pro
    console.log(`Capturing 07_promote-to-pro [${vp.label}]...`);
    const proBtn = page.locator('button.operator-button:has-text("Promote to Pro")');
    if (await proBtn.isVisible()) {
      await proBtn.click();
      await page.waitForTimeout(300);
      const proReasonInput = page.locator('input[placeholder*="Reason for manual promotion"]');
      if (await proReasonInput.isVisible()) {
        await proReasonInput.fill('Verified key festival operator for direct outbound pipeline');
      }
      await page.waitForTimeout(400);
    }
    await saveScreenshot(page, '07_promote-to-pro', vp.label);

    // 8. promote-to-enterprise
    console.log(`Capturing 08_promote-to-enterprise [${vp.label}]...`);
    const entBtn = page.locator('button.operator-button:has-text("Promote to Enterprise")');
    if (await entBtn.isVisible()) {
      await entBtn.click();
      await page.waitForTimeout(300);
      const reasonInput = page.locator('input[placeholder*="Reason for enterprise investigation"]');
      const gapInput = page.locator('input[placeholder*="Unverified capacity"]');
      if (await reasonInput.isVisible()) {
        await reasonInput.fill('High-capacity convention venue identified for corporate pilot');
        await gapInput.fill('Unverified maximum banquet hall capacity');
      }
      await page.waitForTimeout(400);
    }
    await saveScreenshot(page, '08_promote-to-enterprise', vp.label);

    // 9. listing-resources
    console.log(`Capturing 09_listing-resources [${vp.label}]...`);
    await page.click('button.workbench-tab:has-text("Listing")');
    await page.waitForTimeout(400);
    await saveScreenshot(page, '09_listing-resources', vp.label);

    // 10. invalid-entity
    console.log(`Capturing 10_invalid-entity [${vp.label}]...`);
    await page.goto(`${BASE_URL}/operator/catalogue?saved=invalid_provider_refs`, { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr.catalogue-table-row', { timeout: 15000 });
    const invalidRow = page.locator('tbody tr.catalogue-table-row').first();
    await invalidRow.click();
    await page.waitForSelector('.catalogue-workbench-panel', { timeout: 5000 });
    await page.click('button.workbench-tab:has-text("Research")');
    await page.waitForTimeout(400);
    await saveScreenshot(page, '10_invalid-entity', vp.label);

    // 11. web-verification-saved-view
    console.log(`Capturing 11_web-verification-saved-view [${vp.label}]...`);
    await page.goto(`${BASE_URL}/operator/catalogue?saved=needs_web_verification`, { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr.catalogue-table-row', { timeout: 15000 });
    await page.waitForTimeout(500);
    await saveScreenshot(page, '11_web-verification-saved-view', vp.label);

    // 12. empty-error-loading-states
    console.log(`Capturing 12_empty-error-loading-states [${vp.label}]...`);
    await page.goto(`${BASE_URL}/operator/catalogue?search=NonExistentEntityQuery999`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.operator-empty', { timeout: 15000 });
    await page.waitForTimeout(500);
    await saveScreenshot(page, '12_empty-error-loading-states', vp.label);

    await context.close();
  }

  await browser.close();
  console.log('\nAll 12 visual acceptance screenshots captured across 3 viewports successfully!');
}

run().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
