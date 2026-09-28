import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const EXPECTED_REVISION = '2026-09-28-v1';
const manifest = JSON.parse(fs.readFileSync(new URL('../architecture/cross-product-boundary.json', import.meta.url), 'utf8'));
if (manifest.architectureContractRevision !== EXPECTED_REVISION) throw new Error(`ARCHITECTURE_CONTRACT_REVISION_MISMATCH: expected ${EXPECTED_REVISION}, got ${manifest.architectureContractRevision}`);
const base = process.env.ARCHITECTURE_BASE_REF || 'origin/main';
try { execFileSync('git', ['rev-parse', '--verify', base], { stdio: 'ignore' }); } catch { execFileSync('git', ['fetch', 'origin', 'main', '--depth=50'], { stdio: 'inherit' }); }
const diff = execFileSync('git', ['diff', '--unified=0', `${base}...HEAD`, '--', '.'], { encoding:'utf8', maxBuffer:20*1024*1024 });
const ignored=(file)=>!file || file==='ARCHITECTURE.md' || file==='architecture/cross-product-boundary.json' || file==='scripts/check-architecture-boundary.mjs' || file==='.github/workflows/architecture-boundary.yml' || file.startsWith('docs/') || file.includes('/retired/') || /(?:^|\/)(?:test|tests|fixtures?)(?:\/|$)/i.test(file) || /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(file);
let file=''; const added=[];
for (const line of diff.split(/\r?\n/)) { if (line.startsWith('+++ b/')) { file=line.slice(6); continue; } if (line.startsWith('+') && !line.startsWith('+++') && !ignored(file)) added.push({file,text:line.slice(1)}); }
const failures=[];
for (const rule of manifest.forbiddenAddedPatterns ?? []) { const re=new RegExp(rule.pattern,'i'); for (const row of added) if (re.test(row.text)) failures.push(`${row.file}: ${rule.reason}\n  + ${row.text.trim()}`); }
const allowed=new Set(manifest.allowedContracts ?? []); const contractRe=/(?:nexus|event-suite|intelligence)\.[a-z0-9-]+(?:\.[a-z0-9-]+)*\.v\d+/gi;
for (const row of added) for (const match of row.text.match(contractRe) ?? []) if (!allowed.has(match)) failures.push(`${row.file}: unknown/unlocked cross-product contract ${match}`);
if (failures.length) { console.error('ARCHITECTURE_BOUNDARY_FAIL'); for (const f of [...new Set(failures)]) console.error(`- ${f}`); process.exit(1); }
console.log(`ARCHITECTURE_BOUNDARY_PASS (${manifest.repositoryRole}, ${EXPECTED_REVISION})`);
