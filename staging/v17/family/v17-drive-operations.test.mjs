import test from 'node:test';
import assert from 'node:assert/strict';
import {createV17DriveOperations,handleV17DriveOperation} from './v17-drive-operations.mjs';
const bookId='5849d4bf-f7ef-4b38-a1ab-dae70497428f';
const chapterId='fe41c065-e745-4ae5-afb7-22b4e45b801c';
const manifest={bookId,parts:[{fileId:'PrivateDrivePart0001',bytes:1024,durationSeconds:100}],
 chapters:[{id:chapterId,start:0}],durationSeconds:100};
function fakeBackend(){
 const assigned=new Set();
 const queries=[];
 const supabase={
  from(table){
   const filters={};let ordering;
   const chain={
    select(){return chain;},
    eq(key,value){filters[key]=value;return chain;},
    order(key){ordering=key;return chain;},
    async maybeSingle(){
     queries.push({table,filters:{...filters}});
     if(table==='audio_books')return {data:{id:bookId,title:'The Lamp Keeper',is_active:true,status:'ready'}};
     if(table==='af3_family_book_slots')return {data:assigned.has(filters.listener_id+'|'+filters.audio_book_id)?{audio_book_id:bookId}:null};
     if(table==='af3_private_drive_manifests')return {data:{manifest}};
     throw Error('unexpected table '+table);
    },
    then(resolve,reject){
     if(table!=='audio_chapters'||ordering!=='chapter_index')throw Error('unexpected catalog query');
     return Promise.resolve({data:[{id:chapterId,chapter_index:0}]}).then(resolve,reject);
    }
   };
   return chain;
  },
  async rpc(name,args){
   if(name==='af3_assign_family_book'){
    assigned.add(args.p_listener_id+'|'+args.p_audio_book_id);
    return {data:[{assigned:true,active_count:1,slot_limit:3}]};
   }
   if(name==='af3_remove_family_book'){
    return {data:assigned.delete(args.p_listener_id+'|'+args.p_audio_book_id)};
   }
   throw Error('unexpected RPC');
  }
 };
 return {supabase,queries};
}
test('end-to-end operations deny unassigned book, then return authorized Drive source',async()=>{
 const {supabase,queries}=fakeBackend();
 const operations=createV17DriveOperations({supabase,verifyAccess:async()=>({ok:true,listenerId:'owner-1',allowed:true,isAdmin:true})});
 await assert.rejects(handleV17DriveOperation(operations,{op:'m4bSource',bookId}),/BOOK_NOT_ASSIGNED/);
 assert.equal((await handleV17DriveOperation(operations,{op:'familyAssign',bookId})).activeCount,1);
 const source=await handleV17DriveOperation(operations,{op:'m4bSource',bookId});
 assert.equal(source.source.parts[0].fileId,manifest.parts[0].fileId);
 assert.equal(source.source.chapters[0].id,chapterId);
 assert.ok(queries.some(q=>q.table==='af3_private_drive_manifests'));
 const part=await handleV17DriveOperation(operations,{op:'m4bPart',bookId,part:1});
 assert.equal(part.fileId,manifest.parts[0].fileId);
 assert.equal((await handleV17DriveOperation(operations,{op:'familyRemove',bookId})).removed,true);
 await assert.rejects(handleV17DriveOperation(operations,{op:'m4bSource',bookId}),/BOOK_NOT_ASSIGNED/);
});
test('denies untrusted operations and unauthorized identity before manifest read',async()=>{
 const {supabase,queries}=fakeBackend();
 const operations=createV17DriveOperations({supabase,verifyAccess:async()=>({ok:true,listenerId:'listener-1',allowed:false,isAdmin:false})});
 await assert.rejects(handleV17DriveOperation(operations,{op:'m4bSource',bookId,listenerId:'owner-1',isAdmin:true}),/FORBIDDEN/);
 assert.equal(queries.some(q=>q.table==='af3_private_drive_manifests'),false);
 await assert.rejects(handleV17DriveOperation(operations,{op:'unknown',bookId}),/UNKNOWN_V17_OPERATION/);
});
