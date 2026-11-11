import { readFileSync, statSync } from 'node:fs';
import { planTerminalUrlBackfill } from '../src/nexus/source-discovery/terminal-url-backfill.ts';
const [input, ...extra] = process.argv.slice(2);
if (!input || extra.length) throw new Error('Usage: node --experimental-strip-types scripts/plan-terminal-url-backfill.ts <retained-results-export.json> (offline dry-run only)');
if (statSync(input).size > 50 * 1024 * 1024) throw new Error('TERMINAL_BACKFILL_INPUT_TOO_LARGE');
const records: unknown = JSON.parse(readFileSync(input, 'utf8'));
if (!Array.isArray(records)) throw new Error('TERMINAL_BACKFILL_EXPECTED_RESULT_ARRAY');
console.log(JSON.stringify(planTerminalUrlBackfill(records), null, 2));
