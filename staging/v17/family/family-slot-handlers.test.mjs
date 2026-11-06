import test from 'node:test';
import assert from 'node:assert/strict';
import {createFamilySlotHandlers} from './family-slot-handlers.mjs';
const ID='123e4567-e89b-42d3-a456-426614174000';
function setup(access={ok:true,listenerId:'guest-1',isAdmin:false,audioAccess:{'Pilot Book':true}}){
 const calls=[];
 const supabase={
  from(table){
   calls.push(['table',table]);
   const chain={select(){return chain},eq(){return chain},
    async maybeSingle(){return {data:table==='audio_books'
      ? {id:ID,title:'Pilot Book',is_active:true,status:'ready'}
      : {audio_book_id:ID},error:null}}};
   return chain;
  },
  async rpc(name,args){calls.push(['rpc',name,args]);return {data:name.includes('assign')
    ? [{assigned:true,active_count:1,slot_limit:1}]:true,error:null}}
 };
 return {handlers:createFamilySlotHandlers({verifyAccess:async()=>access,supabase}),calls};
}
test('guest assignment uses server identity and guest limit',async()=>{
 const {handlers,calls}=setup();
 const result=await handlers.assignment({bookId:ID,listenerId:'forged',isAdmin:true});
 assert.equal(result.slotLimit,1);
 assert.deepEqual(calls.find(x=>x[0]==='rpc')[2],{
  p_listener_id:'guest-1',p_audio_book_id:ID,p_is_owner:false});
});
test('owner flag derives only from verified access',async()=>{
 const {handlers,calls}=setup({ok:true,listenerId:'owner',isAdmin:true,fullAudioAccess:true});
 await handlers.assignment({bookId:ID,isAdmin:false});
 assert.equal(calls.find(x=>x[0]==='rpc')[2].p_is_owner,true);
});
test('denies unauthorized book before slot RPC',async()=>{
 const {handlers,calls}=setup({ok:true,listenerId:'guest-1',audioAccess:{}});
 await assert.rejects(handlers.assignment({bookId:ID}),/FORBIDDEN/);
 assert.equal(calls.some(x=>x[0]==='rpc'),false);
});
test('denies unverified identity',async()=>{
 const {handlers,calls}=setup({ok:false,listenerId:'forged',fullAudioAccess:true});
 await assert.rejects(handlers.assignment({bookId:ID}),/UNAUTHORIZED/);
 assert.equal(calls.some(x=>x[0]==='rpc'),false);
});
test('removal never calls Drive',async()=>{
 const {handlers,calls}=setup();
 assert.deepEqual(await handlers.removal({bookId:ID}),{ok:true,removed:true});
 assert.deepEqual(calls.filter(x=>x[0]==='rpc').map(x=>x[1]),['af3_remove_family_book']);
});
test('hasSlot requires authenticated entitlement and assignment',async()=>{
 const {handlers,calls}=setup();
 assert.equal((await handlers.hasSlot({bookId:ID})).bookId,ID);
 assert.ok(calls.some(x=>x[0]==='table'&&x[1]==='af3_family_book_slots'));
});
