import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDrivePartSource} from './drive-part-source.mjs';
const parts=[{fileId:'0123456789abcdef',bytes:4},{fileId:'fedcba9876543210',bytes:3}];
test('V17 one-based part numbers select backend-authorized Drive IDs',async()=>{
 const seen=[],revoked=[];
 const source=createDrivePartSource({parts,getToken:async()=> 'ephemeral',
   fetchImpl:async(url,options)=>{seen.push(url);assert.equal(options.headers.Authorization,'Bearer ephemeral');return new Response(new Uint8Array(url.includes(parts[0].fileId)?4:3));},
   urls:{createObjectURL:()=> 'blob:private-'+seen.length,revokeObjectURL:x=>revoked.push(x)}});
 assert.equal(await source.source(1),'blob:private-1');
 assert.equal(await source.source(2),'blob:private-2');
 assert.deepEqual(seen.map(x=>x.split('/').at(-1).split('?')[0]),parts.map(x=>x.fileId));
 assert.deepEqual(revoked,[],'previous part stays valid until player confirms source handoff');
 source.releasePrevious();
 assert.deepEqual(revoked,['blob:private-1']);
 source.dispose();assert.deepEqual(revoked,['blob:private-1','blob:private-2']);
 await assert.rejects(source.source(1),/SOURCE_CLOSED/);
});
test('invalid metadata, part indices and missing OAuth provider fail closed',async()=>{
 assert.throws(()=>createDrivePartSource({parts:[{fileId:'bad',bytes:4}],getToken:async()=>''}),/INVALID_PRIVATE_DRIVE_SOURCE/);
 assert.throws(()=>createDrivePartSource({parts,getToken:null}),/OAUTH_PROVIDER_REQUIRED/);
 const source=createDrivePartSource({parts,getToken:async()=>''});
 await assert.rejects(source.source(0),/INVALID_PART_NUMBER/);
 await assert.rejects(source.source(3),/INVALID_PART_NUMBER/);
 source.dispose();
});
