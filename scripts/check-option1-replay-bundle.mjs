import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

// Verify the actual deploy trace, not just the source configuration.
const trace=resolve('.next/server/app/api/ai-sales/contact-research/route.js.nft.json');
const expected=realpathSync('tests/fixtures/option1-apollo-replay.json');
const files=JSON.parse(readFileSync(trace,'utf8')).files;
const bundled=files.map(file=>resolve(dirname(trace),file)).find(file=>{
  try{return realpathSync(file)===expected;}catch{return false;}
});
assert.ok(bundled,'Contact-research deployment bundle must include its configured synthetic replay file');
const replay=JSON.parse(readFileSync(bundled,'utf8'));
assert.equal(replay.domain,'operator.example');
assert.ok(Array.isArray(replay.people)&&replay.people.length>0);
console.log('OPTION1_REPLAY_BUNDLE_PASS: synthetic replay file is present and readable in the function trace');
