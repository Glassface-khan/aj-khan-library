import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const code = await readFile(new URL('../../../audio-google-drive-oauth.mjs', import.meta.url), 'utf8');
function harness({clientId='12345-abc.apps.googleusercontent.com', expiry=3600}={}) {
  let requestCount=0, config, requests=[];
  const context={
    Date, Promise, Error, Number, Boolean,
    document:{
      querySelector:()=>({content:clientId}),
      createElement:()=>({}),
      head:{appendChild(script){script.onload();}}
    },
    window:{google:{accounts:{oauth2:{initTokenClient(opts){
      config=opts;
      return {requestAccessToken(opts){requestCount++;requests.push(opts);}};
    }}}}}
  };
  vm.createContext(context);
  const transformed=code.replaceAll('export function ','function ').replaceAll('export async function ','async function ')+
    '\n globalThis.api={prepareDriveOAuth,connectDriveFromClick,getDriveToken,hasDriveToken,clearDriveToken};';
  vm.runInContext(transformed,context);
  return {api:context.api, respond:(v)=>config.callback(v), cancelled:()=>config.error_callback(),
    get requests(){return requests},get requestCount(){return requestCount}};
}

test('preparation never opens OAuth popup; click opens exactly once',async()=>{
  const h=harness();await h.api.prepareDriveOAuth();
  assert.equal(h.requestCount,0);
  const p=h.api.connectDriveFromClick();
  assert.equal(h.requestCount,1);
  h.respond({access_token:'test-only',expires_in:3600});
  assert.equal(await p,'test-only');
  assert.equal(await h.api.getDriveToken(),'test-only');
  assert.equal(h.requests[0].prompt,'consent');
});

test('simultaneous click calls reuse pending OAuth request',async()=>{
  const h=harness();await h.api.prepareDriveOAuth();
  const p=h.api.connectDriveFromClick();
  const p2=h.api.connectDriveFromClick();
  assert.equal(p,p2);assert.equal(h.requestCount,1);
  h.respond({access_token:'abc',expires_in:3600});await p;
});

test('token cleared in memory cannot be refreshed without click',async()=>{
  const h=harness();await h.api.prepareDriveOAuth();
  const p=h.api.connectDriveFromClick();h.respond({access_token:'abc',expires_in:3600});await p;
  h.api.clearDriveToken();
  await assert.rejects(h.api.getDriveToken(),/GOOGLE_DRIVE_RECONNECT_REQUIRED/);
  await assert.rejects(h.api.getDriveToken({refresh:true}),/GOOGLE_DRIVE_RECONNECT_REQUIRED/);
  assert.equal(h.requestCount,1);
});

test('invalid OAuth client ID rejected before any request',async()=>{
  const h=harness({clientId:'invalid'});await assert.rejects(h.api.prepareDriveOAuth(),/GOOGLE_DRIVE_OAUTH_NOT_CONFIGURED/);
  assert.equal(h.requestCount,0);
});

test('OAuth denial and popup cancellation reject safely',async()=>{
  const h=harness();await h.api.prepareDriveOAuth();
  const p=h.api.connectDriveFromClick();h.respond({error:'access_denied'});
  await assert.rejects(p,/GOOGLE_DRIVE_OAUTH_DENIED/);
  const p2=h.api.connectDriveFromClick();h.cancelled();
  await assert.rejects(p2,/GOOGLE_DRIVE_OAUTH_CANCELLED/);
});
