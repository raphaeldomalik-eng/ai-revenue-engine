import fs from 'node:fs';
import path from 'node:path';
import {consumeDirectorySearchEvidence,type HeldSearchEvidence} from '../src/nexus/search/directory-held-search.ts';
import type {NexusResultStore} from '../src/nexus/executor.ts';
const [jobsFile,evidenceFile,outputFile,stateFile]=process.argv.slice(2);
if(!jobsFile||!evidenceFile||!outputFile||!stateFile)throw Error('Usage: replay-directory-held-search.ts jobs.json evidence.json output.json checkpoint.json');
const resolved=[jobsFile,evidenceFile,outputFile,stateFile].map(p=>path.resolve(p));if(new Set(resolved).size!==4)throw Error('DIRECTORY_SEARCH_PATH_COLLISION');
const jobs=JSON.parse(fs.readFileSync(jobsFile,'utf8')) as Array<{request:unknown;work:unknown}>;
const evidence=JSON.parse(fs.readFileSync(evidenceFile,'utf8')) as HeldSearchEvidence[];
if(!Array.isArray(jobs)||jobs.length>100||!Array.isArray(evidence)||evidence.length>200)throw Error('DIRECTORY_SEARCH_BATCH_TOO_LARGE');
fs.mkdirSync(path.dirname(stateFile),{recursive:true});
// Single local replay process; the exclusive lock prevents concurrent checkpoint overwrite.
const lock=fs.openSync(stateFile+'.lock','wx');
try{
 const state:Record<string,Record<string,unknown>>=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{};
 const store:NexusResultStore={async get(key){return state[key]??null},async set(key,value){state[key]=value;fs.writeFileSync(stateFile+'.tmp',JSON.stringify(state));fs.renameSync(stateFile+'.tmp',stateFile)}};
 const output=[];for(const job of jobs){const input=job.request as {identity:{country:string;venueName:string;locality:string}};const query=`"${input.identity.venueName}" "${input.identity.locality}" "${input.identity.country==='GB'?'United Kingdom':'South Africa'}" official website`;
  const held=evidence.filter(e=>e.query===query&&e.country===input.identity.country);
  try{output.push({...job,consumed:await consumeDirectorySearchEvidence(job.request,held,{store})})}catch(error){output.push({...job,heldSearchState:'DEFERRED',error:error instanceof Error?error.message:String(error)})}
 }
 fs.mkdirSync(path.dirname(outputFile),{recursive:true});fs.writeFileSync(outputFile+'.tmp',JSON.stringify(output,null,2));fs.renameSync(outputFile+'.tmp',outputFile);
 const historyFile=outputFile+'.history.json',history=new Map<string,unknown>();for(const row of fs.existsSync(historyFile)?JSON.parse(fs.readFileSync(historyFile,'utf8')):[])history.set(row.request.requestId,row);for(const row of output)history.set((row.request as {requestId:string}).requestId,row);
 fs.writeFileSync(historyFile+'.tmp',JSON.stringify([...history.values()]));fs.renameSync(historyFile+'.tmp',historyFile);
 console.log(JSON.stringify({jobs:jobs.length,consumed:output.filter(r=>'consumed' in r).length,deferred:output.filter(r=>'error' in r).length,cacheReused:output.filter(r=>'consumed' in r&&r.consumed.cacheReused).length,actualSearchApiCalls:0,actualWebsiteRequests:0,productionWrites:0}));
}finally{fs.closeSync(lock);fs.unlinkSync(stateFile+'.lock')}
