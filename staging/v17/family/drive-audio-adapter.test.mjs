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
