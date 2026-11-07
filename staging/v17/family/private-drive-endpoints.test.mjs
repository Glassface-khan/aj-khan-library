import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePrivateDriveManifest} from './private-drive-manifest.mjs';
import {createPrivateDriveEndpoints} from './private-drive-endpoints.mjs';
const bookId='5849d4bf-f7ef-4b38-a1ab-dae70497428f';
const ids=['chapter-1','chapter-2'];
const manifest={bookId,parts:[
 {fileId:'DrivePartABC123',bytes:1000,durationSeconds:100},
 {fileId:'DrivePartDEF456',bytes:2000,durationSeconds:150}
],chapters:[{id:ids[0],start:0},{id:ids[1],start:125}],durationSeconds:250};
test('valid private multipart manifest preserves order and duration',()=>{
 const out=validatePrivateDriveManifest(manifest,{bookId,chapterIds:ids});
 assert.equal(out.parts[1].number,2);
 assert.equal(out.info.durationSeconds,250);
 assert.deepEqual(out.chapters.map(x=>x.id),ids);
});
test('rejects duplicate Drive files and tampered chapter IDs',()=>{
 assert.throws(()=>validatePrivateDriveManifest({...manifest,parts:[manifest.parts[0],manifest.parts[0]]},{bookId,chapterIds:ids}),/INVALID_PRIVATE_PART/);
 assert.throws(()=>validatePrivateDriveManifest(manifest,{bookId,chapterIds:[ids[1],ids[0]]}),/INVALID_CHAPTER_MAPPING/);
});
test('rejects malformed duration and missing chapter',()=>{
 assert.throws(()=>validatePrivateDriveManifest({...manifest,durationSeconds:200},{bookId,chapterIds:ids}),/PRIVATE_DURATION_MISMATCH/);
 assert.throws(()=>validatePrivateDriveManifest({...manifest,chapters:manifest.chapters.slice(0,1)},{bookId,chapterIds:ids}),/INVALID_PRIVATE_MANIFEST/);
});
test('source and part enforce authorization and V17 response format',async()=>{
 let allowed=false;
 const api=createPrivateDriveEndpoints({
  hasSlot:async()=>{if(!allowed)throw Error('BOOK_NOT_ASSIGNED');},
  loadManifest:async()=>manifest,
  loadChapterIds:async()=>ids
 });
 await assert.rejects(api.source({bookId}),/BOOK_NOT_ASSIGNED/);
 allowed=true;
 const result=await api.source({bookId});
 assert.equal(result.ok,true);
 assert.equal(result.source.drive,true);
 assert.equal(result.source.parts.length,2);
 const part=await api.part({bookId,part:2});
 assert.equal(part.fileId,manifest.parts[1].fileId);
 await assert.rejects(api.part({bookId,part:3}),/PRIVATE_PART_UNAVAILABLE/);
});
