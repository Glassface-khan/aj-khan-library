/** Fixed, read-only Supabase file signer for a single GitHub OIDC workflow. */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";
import {createRemoteJWKSet,jwtVerify} from "npm:jose@5";
const AUD="ajk-audio-single-file-pilot-20261023";
const WF="Glassface-khan/aj-khan-library/.github/workflows/ajk-single-file-pilot.yml@refs/heads/main";
const PATH="d4a451a9-0a49-4bce-a323-d3038fce4714/m4b-007.m4b";
const SIZE=4744868;
const KEYS=createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
Deno.serve(async req=>{
  const headers={"Content-Type":"application/json","Cache-Control":"no-store"};
  if(req.method!=="POST")return new Response('{"ok":false}',{status:405,headers});
  try{
    const token=/^Bearer\s+(.+)$/i.exec(req.headers.get("authorization")||"")?.[1];
    if(!token)throw new Error("unauthorized");
    const {payload}=await jwtVerify(token,KEYS,{issuer:"https://token.actions.githubusercontent.com",audience:AUD});
    if(payload.repository!=="Glassface-khan/aj-khan-library"||
       String(payload.repository_id)!=="1332010124"||
       payload.ref!=="refs/heads/main"||payload.workflow_ref!==WF||payload.event_name!=="push")
       throw new Error("unauthorized");
    const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!url||!key)throw new Error("not_configured");
    const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const files=await db.storage.from("audiobook-downloads").list("d4a451a9-0a49-4bce-a323-d3038fce4714",{search:"m4b-007.m4b",limit:100});
    if(files.error||!(files.data||[]).some(f=>f.name==="m4b-007.m4b"&&Number(f.metadata?.size)===SIZE))
      throw new Error("source_mismatch");
    const sign=await db.storage.from("audiobook-downloads").createSignedUrl(PATH,600);
    if(sign.error||!sign.data?.signedUrl)throw new Error("sign_failed");
    return new Response(JSON.stringify({ok:true,path:PATH,bytes:SIZE,signedUrl:sign.data.signedUrl}),{status:200,headers});
  }catch(_){
    return new Response('{"ok":false}',{status:403,headers});
  }
});
