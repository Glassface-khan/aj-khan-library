import assert from 'node:assert/strict';
import { probePrivateDriveM4b } from './drive-range-probe.mjs';
const fileId = '0123456789abcdef';
let called = 0;
const fetchImpl = async (url, options) => {
  called++;
  assert.equal(url, 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media');
  assert.equal(options.headers.Range, 'bytes=0-1');
  assert.equal(options.headers.Authorization, 'Bearer ephemeral-token');
  return {status:206,headers:new Headers({'content-range':'bytes 0-1/1000000','content-type':'audio/mp4'}),body:{cancel:async()=>{}}};
};
const r=await probePrivateDriveM4b({fileId,accessToken:'ephemeral-token',fetchImpl});
assert.equal(r.rangeSupported,true);
assert.equal(r.authorized,true);
assert.equal(called,1);
await assert.rejects(probePrivateDriveM4b({fileId:'!',accessToken:'token',fetchImpl}),/INVALID_FILE_ID/);
await assert.rejects(probePrivateDriveM4b({fileId,accessToken:'',fetchImpl}),/MISSING_OAUTH_TOKEN/);
console.log('AF3 Drive range probe: mock assertions passed');
for (const status of [401, 403, 404, 429, 500, 503]) {
  let cancelled = false;
  const failed = await probePrivateDriveM4b({fileId, accessToken:'ephemeral-token',
    fetchImpl:async()=>({status,headers:new Headers(),body:{cancel:async()=>{cancelled=true;}}})});
  assert.equal(failed.authorized,false);
  assert.equal(failed.rangeSupported,false);
  assert.equal(cancelled,true);
}

