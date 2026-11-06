import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createPlayback} from '../audio-m4b-playback.mjs';
import {registeredSource} from '../staging/supabase/audio-library/m4b-source.mjs';

const sourceText = readFileSync(new URL('../audio-library.js',import.meta.url),'utf8');
const functions = sourceText.slice(sourceText.indexOf('  async function startBook('),sourceText.indexOf('  async function openAdmin('));
const harness = new Function('state','api','Audio','render','friendlyError','loadCatalog','localStorage','moduleForTest',
  functions.replace("import('./audio-m4b-playback.mjs')",'Promise.resolve(moduleForTest)') +
  '\nreturn {startBook,loadChapter,saveProgress,onEnded,seekBook};');

class Media extends EventTarget {
  readyState = 0; paused = true; currentTime = 0; src = '';
  load() { this.readyState = 0; this.paused = true; this.currentTime = 0; }
  metadata(duration) { this.duration = duration; this.readyState = 1; this.dispatchEvent(new Event('loadedmetadata')); }
  async play() { this.paused = false; }
  pause() { this.paused = true; }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
}

for (const count of [1,6]) {
  test('legacy controls with '+count+' M4B part(s)', async()=>{
    const chapters = Array.from({length:count*2},(_,i)=>({id:'ch'+i,title:'chapter '+i}));
    const book = {id:'edition',m4bAvailable:true,chapters,progress:{chapter_id:'ch1',position_seconds:2}};
    const entry = {slug:'edition',info:{durationSeconds:count*20},
      chapters:chapters.map((c,i)=>({id:c.id,start:i*10}))};
    if(count>1)entry.parts=Array.from({length:count},()=>({durationSeconds:20}));
    const source=registeredSource({edition:entry},'edition','https://owner.test.ts.net');
    const calls=[];
    const api=async msg=>{calls.push(msg);return {source}};
    const state={catalog:[book],playbackRate:1,lastSavedAt:0,lastSavedPosition:-1};
    const p=harness(state,api,Media,()=>{},String,async()=>{},{setItem(){}},{createPlayback});
    await p.startBook(book.id);
    const audio=state.audio;
    audio.metadata(20);
    assert.equal(audio.currentTime,12);
    for(let i=1;i<count;i++){
      audio.currentTime=20;
      await p.onEnded();
      audio.metadata(20);
      assert.ok(audio.src.endsWith('/part/'+(i+1)+'/audio.m4b'));
      assert.equal(audio.currentTime,0);
      assert.equal(audio.paused,false);
    }
    await p.loadChapter(book,chapters[0],3,true);
    if(count>1)audio.metadata(20);
    assert.equal(audio.currentTime,3);
    await p.saveProgress(false,false,true);
    assert.equal(book.progress.chapter_id,'ch0');
    assert.equal(book.progress.position_seconds,3);
    const last=chapters.at(-1);
    await p.loadChapter(book,last,1,true);
    if(count>1)audio.metadata(20);
    assert.equal(audio.currentTime,11);
    audio.currentTime=20;await p.onEnded();
    assert.equal(book.progress.completed,true);
    assert.equal(book.progress.chapter_id,last.id);
    assert.equal(calls.filter(c=>c.op==='chapterUrl').length,0);
  });
}
test('reject unexpected origin and mismatched chapter mapping',()=>{
  const entry={slug:'book',info:{durationSeconds:10},chapters:[{id:'x',start:0}]};
  assert.throws(()=>registeredSource({book:entry},'book','https://example.org'));
  assert.throws(()=>createPlayback(registeredSource({book:entry},'book','https://test.ts.net'),[{id:'wrong'}]));
});

test('inactive CARAVANSERAI pilot requires the registered edition and the exact authenticated owner', async()=>{
  const {permitsOwnerPilot,caravanseraiId}=await import('../staging/supabase/audio-library/m4b-source.mjs');
  const registered={[caravanseraiId]:{}};
  const owner={isAdmin:true,listenerId:'owner'};
  assert.equal(permitsOwnerPilot(owner,'owner',registered),true);
  for(const access of [{...owner,isAdmin:false},{...owner,listenerId:'other'},null])
    assert.equal(permitsOwnerPilot(access,'owner',registered),false);
  assert.equal(permitsOwnerPilot(owner,'',registered),false);
  assert.equal(permitsOwnerPilot(owner,'owner',{}),false);
});
