import test from 'node:test';
import assert from 'node:assert/strict';
import {createM4bTimeline} from '../../../audio-m4b-timeline.mjs';
import {createPlayback} from '../../../audio-m4b-playback.mjs';

function fixture() {
  const parts = [10, 20, 30].map((seconds, i) => ({
    info: {durationSeconds: seconds}, fileId: 'drive_file_id_' + i + '_12345', bytes: 4
  }));
  const chapters = [
    {id:'c1',start:0}, {id:'c2',start:10}, {id:'c3',start:35}
  ];
  return {source:{drive:true,guest:true,parts,info:{durationSeconds:60},chapters},
    chapters:chapters.map(({id})=>({id}))};
}

test('three private M4B parts have one continuous timeline with exact boundaries',()=>{
  const {source}=fixture();
  const t=createM4bTimeline(source);
  assert.deepEqual(t.locate(0),{partNumber:1,localSeconds:0});
  assert.deepEqual(t.locate(10),{partNumber:2,localSeconds:0});
  assert.deepEqual(t.locate(30),{partNumber:3,localSeconds:0});
  assert.deepEqual(t.locate(35),{partNumber:3,localSeconds:5});
  assert.equal(t.bookSeconds(3,5),35);
  assert.equal(t.duration,60);
});

test('Drive playback maps chapters across parts and rejects invalid part numbers',async()=>{
  const {source,chapters}=fixture();
  const p=createPlayback(source,chapters,{getDriveToken:async()=> 'test-only'});
  assert.equal(p.drive,true);
  assert.equal(p.parts,3);
  assert.equal(p.position(35).chapter.id,'c3');
  assert.equal(p.chapterTime('c2',5),15);
  await assert.rejects(p.resolvePart(0),/INVALID_PART_NUMBER/);
  await assert.rejects(p.resolvePart(4),/INVALID_PART_NUMBER/);
  p.dispose();
});

test('Drive metadata and chapter order must be consistent before playback',()=>{
  const {source,chapters}=fixture();
  assert.throws(()=>createPlayback(source,chapters),/PRIVATE_DRIVE_AUTH_OR_METADATA_REQUIRED/);
  assert.throws(()=>createPlayback({...source,parts:[...source.parts.slice(0,2),{...source.parts[2],bytes:50*1024*1024}]},
    chapters,{getDriveToken:async()=> 'test-only'}),/PRIVATE_DRIVE_AUTH_OR_METADATA_REQUIRED/);
  assert.throws(()=>createPlayback({...source,chapters:[source.chapters[0],source.chapters[2],source.chapters[1]]},
    chapters,{getDriveToken:async()=> 'test-only'}),/M4B chapter mapping mismatch/);
});
