// Exercise the emitted runtime without inherited staging credentials or database access.
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('KICKS_')&&!k.startsWith('PG')&&!k.startsWith('CF_ACCESS_')&&k!=='DATABASE_URL'&&k!=='NODE_ENV'));
Object.assign(env,{NODE_ENV:'development',KICKS_ENVIRONMENT:'staging',HOST:'127.0.0.1',PORT:'3004'});
const child=spawn(process.execPath,['services/api/dist/start.js'],{cwd:root,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
let stderr='';child.stderr.on('data',b=>stderr+=b.toString());child.stdout.resume();
let ok=false;
try {
 for(let i=0;i<30;i++){
  if(child.exitCode!==null)break;
  try{const response=await fetch('http://127.0.0.1:3004/health',{signal:AbortSignal.timeout(1000)});if(response.ok){console.log('PASS compiled API startup with copied runtime assets (no database credentials)');ok=true;break;}}catch{}
  await delay(500);
 }
 if(!ok){console.error('FAIL compiled API startup');console.error(stderr.slice(0,5000));process.exitCode=1;}
}finally{child.kill();}
