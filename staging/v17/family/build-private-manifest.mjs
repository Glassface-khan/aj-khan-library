// AF3 V17 - build a private Drive manifest from ffprobe chapter metadata.
// Node 20+. Input files MUST remain private; never commit generated manifest.
// Usage: node build-private-manifest.mjs <private-input.json> <private-output.json>
// Input: {bookId, parts:[{fileId,bytes,probe:{format:{duration},chapters:[{start_time,tags:{title}}]}}], catalog:[{id,title}]}
// File names/IDs are intentionally absent from this source.
import {readFile,writeFile} from 'node:fs/promises';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('INPUT_AND_OUTPUT_REQUIRED');
const data=JSON.parse(await readFile(input,'utf8'));
if(!Array.isArray(data.parts)||!Array.isArray(data.catalog)||data.parts.length<1)throw Error('INVALID_INPUT');
const parts=[];const chapters=[];let offset=0;
for(const [i,p] of data.parts.entries()){
 const duration=Number(p.probe?.format?.duration);
 if(!Number.isFinite(duration)||duration<=1||!Number.isSafeInteger(p.bytes))throw Error('INVALID_PART');
 parts.push({fileId:p.fileId,bytes:p.bytes,durationSeconds:duration});
 for(const ch of p.probe.chapters??[]){
  const start=Number(ch.start_time);
  if(!Number.isFinite(start)||start<0||start>=duration)throw Error('INVALID_CHAPTER');
  chapters.push({title:String(ch.tags?.title??'').trim(),start:Math.round((offset+start)*1000)/1000});
 }
 offset+=duration;
}
if(chapters.length!==data.catalog.length)throw Error('CATALOG_CHAPTER_COUNT_MISMATCH');
const mapped=chapters.map((ch,i)=>{
 if(ch.title!==String(data.catalog[i].title??'').trim()||!data.catalog[i].id)
  throw Error('CATALOG_CHAPTER_ORDER_MISMATCH_'+i);
 return {id:data.catalog[i].id,start:ch.start};
});
const manifest={bookId:data.bookId,durationSeconds:Math.round(offset*1000)/1000,parts,chapters:mapped};
await writeFile(output,JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({ok:true,parts:parts.length,chapters:mapped.length,durationSeconds:manifest.durationSeconds}));
