/** Owner-only M4B backup coordination. One ready audiobook per authenticated GitHub run. */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";
import {createRemoteJWKSet,jwtVerify} from "npm:jose@5";

const AUD="ajk-private-auto-m4b-backup-v1";
const WF="Glassface-khan/aj-khan-library/.github/workflows/ajk-private-auto-m4b-backup.yml@refs/heads/main";
const PILOT="6a51a8af-29e1-46b6-9c6c-66907f4f3c3b";
const ALREADY_ARCHIVED=new Set<string>(); // Existing export backups are idempotent and conflict-checked
const STORAGE="audiobook-downloads";
const SIZES={maxFile:50000000,maxTotal:1000000000,maxParts:30};
const JWKS=createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
const H={"Content-Type":"application/json","Cache-Control":"no-store"};
const fail=()=>new Response('{"ok":false}',{status:403,headers:H});
const ok=(body:any)=>new Response(JSON.stringify({ok:true,...body}),{status:200,headers:H});

Deno.serve(async(req)=>{
 if(req.method!=="POST")return new Response('{"ok":false}',{status:405,headers:H});
 try{
   const jwt=/^Bearer\s+(.+)$/i.exec(req.headers.get("authorization")||"")?.[1];
   if(!jwt)throw new Error("auth");
   const {payload}=await jwtVerify(jwt,JWKS,{issuer:"https://token.actions.githubusercontent.com",audience:AUD});
   if(payload.repository!=="Glassface-khan/aj-khan-library"||
      String(payload.repository_id)!=="1332010124"||
      payload.workflow_ref!==WF||payload.ref!=="refs/heads/main"||
      !["push","schedule","workflow_dispatch"].includes(String(payload.event_name)))
      throw new Error("oidc_scope");
   const input=await req.json();
   if(!input||!["claim","finish"].includes(input.op))throw new Error("op");
   const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
   if(!url||!key)throw new Error("config");
   const db=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
   const pilot=payload.event_name==="push";
   const manual=payload.event_name==="workflow_dispatch";
   const runId=Number(payload.run_id);
   if(!Number.isSafeInteger(runId)||runId<=0)throw new Error("run_id");
   const targetJobId=manual?String(input.targetJobId||""):"";
   if(manual&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetJobId))throw new Error("target_required");
   if(!manual&&input.targetJobId)throw new Error("target_event");
   async function manifest(exportJob:any) {
      const declared=(exportJob.files||[]).filter((f:any)=>f.format==="M4B");
      if(declared.length<1||declared.length>SIZES.maxParts)return null;
      let sum=0;
      const entries=[];
      const seen=new Set<string>();
      const listed=await db.storage.from(STORAGE).list(exportJob.id,{limit:100});
      if(listed.error)return null;
      for(const f of declared){
        if(typeof f.name!=="string"||!/^m4b-[0-9]{3}\.m4b$/.test(f.name)||
            seen.has(f.name)||f.path!==exportJob.id+"/"+f.name||
            !Number.isSafeInteger(Number(f.bytes))||Number(f.bytes)<1||
            Number(f.bytes)>SIZES.maxFile)return null;
        seen.add(f.name);sum+=Number(f.bytes);
        const match=(listed.data||[]).filter((s:any)=>s.name===f.name);
        if(match.length!==1||Number(match[0]?.metadata?.size)!==Number(f.bytes))return null;
        entries.push({name:f.name,bytes:Number(f.bytes)});
      }
      if(sum>SIZES.maxTotal)return null;
      entries.sort((a,b)=>a.name.localeCompare(b.name));
      for(let i=0;i<entries.length;i++)if(entries[i].name!==`m4b-${String(i+1).padStart(3,'0')}.m4b`)return null;
      return entries;
   }
   if(input.op==="claim"){
     let query=db.from("audiobook_download_jobs")
       .select("id,audio_book_id,source_fingerprint,status,files,created_at")
       .eq("status","ready");
     if(manual)query=query.eq("id",targetJobId);
     const jobs=await query.order("created_at",{ascending:true}).limit(manual?1:40);
     if(jobs.error)throw new Error("jobs");
     for(const job of jobs.data||[]){
       if(pilot?job.id!==PILOT:ALREADY_ARCHIVED.has(job.id))continue;
       const prior=await db.from("audiobook_drive_backups")
         .select("status").eq("audio_book_id",job.audio_book_id)
         .eq("source_fingerprint",job.source_fingerprint).maybeSingle();
       if(prior.error)throw new Error("prior");
       if(prior.data?.status==="ready")continue;
       const book=await db.from("audio_books")
         .select("id,title,narrator_name,voice_key,language_code,status,is_active")
         .eq("id",job.audio_book_id).single();
       if(book.error||book.data?.is_active!==true||book.data?.status!=="ready")continue;
       const entries=await manifest(job);
       if(!entries)continue;
       const reserved=await db.rpc("ajk_claim_m4b_backup",{p_export_job_id:job.id,p_run_id:runId});
       if(reserved.error)throw new Error("reservation");
       if(reserved.data!==true)continue;
       const files=[];
       for(const f of entries){
         const signed=await db.storage.from(STORAGE).createSignedUrl(job.id+"/"+f.name,1800);
         if(signed.error||!signed.data?.signedUrl)throw new Error("sign");
         files.push({...f,url:signed.data.signedUrl});
       }
       return ok({mode:pilot?"pilot":manual?"manual":"scheduled",jobId:job.id,audioBookId:job.audio_book_id,
         fingerprint:job.source_fingerprint,book:{title:book.data.title,
         narrator:book.data.narrator_name||"A. J. Khan",language:book.data.language_code},files});
     }
     return ok({mode:pilot?"pilot":manual?"manual":"scheduled",jobId:null});
   }
   const jobId=String(input.jobId||"");
   if(!/^[a-f0-9-]{36}$/.test(jobId)||!Array.isArray(input.files))throw new Error("finish_args");
   if(pilot?jobId!==PILOT:ALREADY_ARCHIVED.has(jobId))throw new Error("edition_not_authorized");
   const got=await db.from("audiobook_download_jobs")
      .select("id,audio_book_id,source_fingerprint,status,files").eq("id",jobId).eq("status","ready").single();
   if(got.error)throw new Error("unknown_job");
   const entries=await manifest(got.data);
   if(!entries||input.files.length!==entries.length)throw new Error("finish_manifest");
   const folderId=String(input.folderId||"");
   if(!/^[a-zA-Z0-9_-]{10,200}$/.test(folderId))throw new Error("finish_folder");
   const seen=new Set<string>(),verified=[];
   for(const item of input.files){
     const expected=entries.find(f=>f.name===item.name);
     if(!expected||seen.has(item.name)||item.bytes!==expected.bytes||
        !/^[a-zA-Z0-9_-]{10,200}$/.test(String(item.id||""))||
        !/^[a-f0-9]{32}$/.test(String(item.md5||""))||
        !/^[a-f0-9]{64}$/.test(String(item.sha256||"")))throw new Error("finish_file");
     seen.add(item.name);
     verified.push({name:item.name,id:item.id,bytes:item.bytes,md5:item.md5,sha256:item.sha256});
   }
   const result=await db.from("audiobook_drive_backups").update({
      audio_book_id:got.data.audio_book_id,source_fingerprint:got.data.source_fingerprint,
      status:"ready",folder_id:folderId,files:verified,progress_total:entries.length,
      progress_done:entries.length,error_detail:null,worker_run_id:Number(payload.run_id),
      updated_at:new Date().toISOString()
    }).eq("audio_book_id",got.data.audio_book_id)
      .eq("source_fingerprint",got.data.source_fingerprint)
      .eq("status","copying").eq("worker_run_id",runId).select("id,status").maybeSingle();
   if(result.error){console.error("AJK_FINISH_WRITE_ERROR",result.error.code,result.error.message);throw new Error("finish_write");}
   if(!result.data){console.error("AJK_FINISH_NO_MATCH",jobId,runId);throw new Error("finish_not_owner");}
   return ok({finished:true,partCount:entries.length});
 }catch(e){console.error("AJK_BACKUP_EDGE_FAILURE",e instanceof Error?e.message:"unknown");return fail();}
});