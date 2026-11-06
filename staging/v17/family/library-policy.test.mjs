import assert from 'node:assert/strict';
import { capacityForRole, decideAssignment, decideRemoval } from './library-policy.mjs';

assert.equal(capacityForRole('admin'), 3);
assert.equal(capacityForRole('guest'), 1);
assert.throws(() => capacityForRole('unknown'), /UNKNOWN_ROLE/);
assert.deepEqual(decideAssignment({role:'guest',currentBookIds:[],requestedBookId:'a'}),
  {allowed:true,reason:'SLOT_AVAILABLE'});
assert.deepEqual(decideAssignment({role:'guest',currentBookIds:['a'],requestedBookId:'b'}),
  {allowed:false,reason:'LIBRARY_FULL'});
assert.deepEqual(decideAssignment({role:'guest',currentBookIds:['a'],requestedBookId:'a'}),
  {allowed:true,reason:'ALREADY_ASSIGNED'});
assert.deepEqual(decideAssignment({role:'admin',currentBookIds:['a','b'],requestedBookId:'c'}),
  {allowed:true,reason:'SLOT_AVAILABLE'});
assert.deepEqual(decideAssignment({role:'admin',currentBookIds:['a','b','c'],requestedBookId:'d'}),
  {allowed:false,reason:'LIBRARY_FULL'});
assert.deepEqual(decideRemoval({currentBookIds:['a'],requestedBookId:'a'}),
  {removeAssignment:true,deleteDriveFile:false,revokeDrivePermission:false});
console.log('AF3 family policy: 9 assertions passed');
