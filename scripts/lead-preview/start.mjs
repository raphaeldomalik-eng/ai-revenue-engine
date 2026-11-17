import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
// Clean environment: inherit OS/runtime essentials only, never application/provider secrets.
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(key)));
Object.assign(env,{AIRE_LEAD_PREVIEW:'1',AIRE_LEAD_PREVIEW_SECRET:randomBytes(32).toString('hex'),AIRE_LEAD_PREVIEW_DATA_KEY:process.argv.includes('--fresh')?String(Date.now()):'default',NEXT_TELEMETRY_DISABLED:'1'});
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3123'],{env,stdio:'inherit',windowsHide:true});
child.on('exit',code=>process.exit(code??1));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
