/** Fixed, read-only Supabase file signer for a single GitHub OIDC workflow. */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";
import {createRemoteJWKSet,jwtVerify} from "npm:jose@5";
const AUD="ajk-the-missing-cover-m4b-backup-20261023";
const WF="Glassface-khan/aj-khan-library/.github/workflows/ajk-the-missing-cover-m4b-backup.yml@refs/heads/main";
const PARTS=[["m4b-001.m4b",40070807],["m4b-002.m4b",35627812],["m4b-003.m4b",35648815],["m4b-004.m4b",37049335],["m4b-005.m4b",32529828]] as const;
const EXPORT="562e7af4-a66b-4a6a-94bb-5ba2412e495b";
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
    const files=await db.storage.from("audiobook-downloads").list(EXPORT,{limit:100});
    if(files.error)throw new Error("storage_list");
    const output=[];
    for(const [name,bytes] of PARTS){
      if(!(files.data||[]).some(f=>f.name===name&&Number(f.metadata?.size)===bytes))throw new Error("source_mismatch");
      const signed=await db.storage.from("audiobook-downloads").createSignedUrl(EXPORT+"/"+name,900);
      if(signed.error||!signed.data?.signedUrl)throw new Error("sign_failed");
      output.push({name,bytes,url:signed.data.signedUrl});
    }
    return new Response(JSON.stringify({ok:true,edition:"The Missing Cover / Peter Yearsley / EN",files:output}),{status:200,headers});
  }catch(_){
    return new Response('{"ok":false}',{status:403,headers});
  }
});
