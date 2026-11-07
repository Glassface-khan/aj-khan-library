import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDriveAudioAdapter} from './drive-audio-adapter.mjs';
const part = {fileId:'0123456789abcdef',bytes:4};
test('refreshes once, passes token only in header, creates seekable media blob and revokes it',async()=>{
  let calls=0; let refreshed=false; const revoked=[];
  const adapter=createDriveAudioAdapter({
    getToken:async({refresh})=>{refreshed ||= refresh; return 'private-token';},
    fetchImpl:async(url,opts)=>{
      assert.ok(!url.includes('private-token'));
      assert.equal(opts.headers.Authorization,'Bearer private-token');
      return ++calls === 1 ? new Response('',{status:401}) : new Response(new Uint8Array(4));
    },
    urls:{createObjectURL:blob=>{assert.equal(blob.size,4);assert.equal(blob.type,'audio/mp4');return 'blob:private';},
      revokeObjectURL:url=>revoked.push(url)}
  });
  assert.equal(await adapter.resolvePart(part),'blob:private');
  assert.equal(refreshed,true);
  adapter.dispose(); assert.deepEqual(revoked,['blob:private']);
});
test('denies permissions, oversized responses and invalid metadata',async()=>{
  for(const response of [new Response('',{status:403}),new Response(new Uint8Array(5))]) {
    const adapter=createDriveAudioAdapter({getToken:async()=> 'token',fetchImpl:async()=>response});
    await assert.rejects(adapter.resolvePart(part),/DRIVE_PERMISSION_REQUIRED|DRIVE_SIZE_MISMATCH/);
  }
  const adapter=createDriveAudioAdapter({getToken:async()=>{throw Error('must not run');}});
  await assert.rejects(adapter.resolvePart({...part,bytes:100000000}),/INVALID_DRIVE_PART/);
});

test('rejects empty Drive response stream without creating a blob',async()=>{
 const adapter=createDriveAudioAdapter({getToken:async()=> 'token',
  fetchImpl:async()=>({status:200,body:null})});
 await assert.rejects(adapter.resolvePart(part),/CANCELLED_OR_EMPTY_RESPONSE/);
});

test('rejected token stops download and does not attempt a second fetch without consent',async()=>{
  let fetches=0, refreshes=0, blobs=0;
  const adapter=createDriveAudioAdapter({
    getToken:async({refresh})=>{
      if(refresh){refreshes++;throw Error('GOOGLE_DRIVE_RECONNECT_REQUIRED');}
      return 'expired-token';
    },
    fetchImpl:async(url,opts)=>{
      fetches++;
      assert.ok(!url.includes('expired-token'));
      assert.equal(opts.credentials,'omit');
      assert.equal(opts.cache,'no-store');
      assert.equal(opts.headers.Authorization,'Bearer expired-token');
      return new Response('',{status:401});
    },
    urls:{createObjectURL:()=>{blobs++;return 'blob:unexpected';},revokeObjectURL:()=>{}}
  });
  await assert.rejects(adapter.resolvePart(part),/GOOGLE_DRIVE_RECONNECT_REQUIRED/);
  assert.equal(fetches,1);
  assert.equal(refreshes,1);
  assert.equal(blobs,0);
});

test('switching chapters cancels an older in-flight Drive download',async()=>{
  let firstResolve, calls=0, blobs=0;
  const adapter=createDriveAudioAdapter({
    getToken:async()=> 'test-token',
    fetchImpl:async()=>{
      calls++;
      if(calls===1) return await new Promise(resolve=>{firstResolve=resolve;});
      return new Response(new Uint8Array(4));
    },
    urls:{createObjectURL:()=>{blobs++;return 'blob:latest';},revokeObjectURL:()=>{}}
  });
  const old=adapter.resolvePart(part);
  await Promise.resolve();await Promise.resolve();
  const latest=adapter.resolvePart(part);
  firstResolve(new Response(new Uint8Array(4)));
  await assert.rejects(old,/CANCELLED/);
  assert.equal(await latest,'blob:latest');
  assert.equal(blobs,1);
  adapter.dispose();
});

test('failed next part preserves current audio until explicit disposal',async()=>{
  let calls=0;
  const revoked=[];
  const adapter=createDriveAudioAdapter({
    getToken:async()=> 'test-token',
    fetchImpl:async()=>++calls===1 ? new Response(new Uint8Array(4)) : new Response('',{status:403}),
    urls:{createObjectURL:()=> 'blob:current',revokeObjectURL:url=>revoked.push(url)}
  });
  assert.equal(await adapter.resolvePart(part),'blob:current');
  await assert.rejects(adapter.resolvePart(part),/DRIVE_PERMISSION_REQUIRED/);
  assert.deepEqual(revoked,[]);
  adapter.dispose();
  assert.deepEqual(revoked,['blob:current']);
});

test('disposing during an in-flight request prevents any playable blob',async()=>{
  let release, blobs=0;
  const adapter=createDriveAudioAdapter({
    getToken:async()=> 'test-token',
    fetchImpl:async()=>await new Promise(resolve=>{release=resolve;}),
    urls:{createObjectURL:()=>{blobs++;return 'blob:unexpected';},revokeObjectURL:()=>{}}
  });
  const pending=adapter.resolvePart(part);
  await Promise.resolve();await Promise.resolve();
  assert.equal(typeof release,'function');
  adapter.dispose();
  release(new Response(new Uint8Array(4)));
  await assert.rejects(pending,/CANCELLED/);
  assert.equal(blobs,0);
});

test('truncated Drive response is rejected without replacing existing audio',async()=>{
  let calls=0, created=0;
  const revoked=[];
  const adapter=createDriveAudioAdapter({
    getToken:async()=> 'test-token',
    fetchImpl:async()=>new Response(new Uint8Array(++calls===1?4:3)),
    urls:{createObjectURL:()=>{created++;return 'blob:current';},revokeObjectURL:url=>revoked.push(url)}
  });
  assert.equal(await adapter.resolvePart(part),'blob:current');
  await assert.rejects(adapter.resolvePart(part),/DRIVE_SIZE_MISMATCH/);
  assert.equal(created,1);
  assert.deepEqual(revoked,[]);
  adapter.dispose();
  assert.deepEqual(revoked,['blob:current']);
});
