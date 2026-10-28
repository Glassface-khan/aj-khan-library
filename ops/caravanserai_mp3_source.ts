/** One-off read-only signer, bound to one repository/branch/workflow and deadline. */
import {createRemoteJWKSet,jwtVerify} from 'npm:jose@5.9.6';
import manifest from './caravanserai_mp3_manifest.json' with {type:'json'};
const branch='refs/heads/ops/caravanserai-mp3-copy-20261028';
const workflow='Glassface-khan/aj-khan-library/.github/workflows/caravanserai-mp3-copy.yml@'+branch;
const prefix='standalone-car/mike-jordan/EN/';
const keys=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
Deno.serve(async req=>{
  try {
    if(req.method!=='POST'||Date.now()>Date.parse('2026-10-30T00:00:00Z'))throw Error('closed');
    const token=/^Bearer\s+(.+)$/i.exec(req.headers.get('authorization')||'')?.[1];
    if(!token)throw Error('auth');
    const {payload}=await jwtVerify(token,keys,{issuer:'https://token.actions.githubusercontent.com',audience:'ajk-caravanserai-mp3-copy-20261028'});
    if(payload.repository!=='Glassface-khan/aj-khan-library'||String(payload.repository_id)!=='1332010124'||payload.ref!==branch||payload.workflow_ref!==workflow||payload.event_name!=='push')throw Error('scope');
    const input=await req.json();
    const entry=manifest.find(e=>e.name===input.name);
    if(input.op!=='source'||!entry)throw Error('manifest');
    const base=Deno.env.get('SUPABASE_URL');
    const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if(base!=='https://ipoqyjrojljmbqslmxxf.supabase.co'||!key)throw Error('config');
    const auth={'Authorization':'Bearer '+key,'apikey':key,'Content-Type':'application/json'};
    const listed=await fetch(base+'/storage/v1/object/list/audiobooks',{method:'POST',headers:auth,body:JSON.stringify({prefix,search:entry.name,limit:100})});
    if(!listed.ok)throw Error('list');
    const matches=(await listed.json()).filter((x:any)=>x.name===entry.name);
    if(matches.length!==1||Number(matches[0].metadata?.size)!==entry.bytes||String(matches[0].metadata?.eTag).replaceAll('"','')!==entry.etag)throw Error('changed_source');
    const signed=await fetch(base+'/storage/v1/object/sign/audiobooks/'+prefix+entry.name,{method:'POST',headers:auth,body:JSON.stringify({expiresIn:600})});
    if(!signed.ok)throw Error('sign');
    const body=await signed.json();
    if(typeof body.signedURL!=='string'||!body.signedURL.startsWith('/object/sign/audiobooks/'+prefix+entry.name+'?'))throw Error('url');
    return new Response(JSON.stringify({ok:true,name:entry.name,bytes:entry.bytes,url:base+'/storage/v1'+body.signedURL}),{headers});
  } catch (_) {return new Response('{"ok":false}',{status:403,headers});}
});
