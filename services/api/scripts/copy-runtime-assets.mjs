import {copyFile, mkdir, readdir} from 'node:fs/promises';
const source=new URL('../src/',import.meta.url);
const destination=new URL('../dist/',import.meta.url);
await mkdir(destination,{recursive:true});
for(const file of await readdir(source)){
  if(file.endsWith('.mjs')&&!file.endsWith('.test.mjs')){
    await copyFile(new URL(file,source),new URL(file,destination));
    console.log(`Copied runtime asset: ${file}`);
  }
}
