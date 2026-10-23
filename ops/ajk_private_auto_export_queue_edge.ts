/** Private, OIDC-authenticated export queue feeder. Creates at most ONE existing-audio export. */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";
import {createRemoteJWKSet,jwtVerify} from "npm:jose@5";

const AUD="ajk-private-auto-export-queue-v1";
const WF="Glassface-khan/aj-khan-library/.github/workflows/ajk-private-auto-export-queue.yml@refs/heads/main";
const PILOT="f2762a61-edb2-4724-9f3d-a833070596eb"; // The Book of Seven Thieves
const PER_DAY=42;
const MAX_CHAPTERS=120,MAX_MP3_BYTES=600000000;
const JWKS=createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
const HEAD={"content-type":"application/json","cache-control":"no-store"};
const out=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:HEAD});

Deno.serve(async(req)=>{
 if(req.method!=="POST")return out({ok:false},405);
 try {
   const jwt=/^Bearer\s+(.+)$/i.exec(req.headers.get("authorization")||"")?.[1];
   if(!jwt)throw new Error("unauthorized");
   const {payload}=await jwtVerify(jwt,JWKS,{issuer:"https://token.actions.githubusercontent.com",audience:AUD});
   if(payload.repository!=="Glassface-khan/aj-khan-library"||
       String(payload.repository_id)!=="1332010124"||payload.workflow_ref!==WF||
       payload.ref!=="refs/heads/main"||!["push","schedule"].includes(String(payload.event_name)))throw new Error("untrusted_runner");
   const pilot=payload.event_name==="push";
   const url=Deno.env.get("SUPABASE_URL"),secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
   if(!url||!secret)throw new Error("backend_unavailable");
   const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
   const now=new Date();
   const active=await db.from("audiobook_download_jobs").select("id,status").in("status",["queued","building"]).limit(3);
   if(active.error)throw new Error("busy_query_failed");
   if((active.data||[]).length)return out({ok:true,state:"busy",active:(active.data||[]).length});
   const day=new Date(now.getTime()-86400000).toISOString();
   const sent=await db.from("audiobook_download_jobs").select("id",{count:"exact",head:true}).gte("created_at",day);
   if(sent.error)throw new Error("budget_query_failed");
   if((sent.count||0)>=PER_DAY)return out({ok:true,state:"daily_limit"});
   const recentFail=await db.from("audiobook_download_jobs").select("id",{count:"exact",head:true}).eq("status","failed").gte("updated_at",new Date(now.getTime()-4*3600000).toISOString());
   if(recentFail.error)throw new Error("failure_check");
   if((recentFail.count||0)>=3)return out({ok:true,state:"failure_stop"});
   const existing=await db.from("audiobook_download_jobs").select("audio_book_id");
   if(existing.error)throw new Error("existing_query_failed");
   const used=new Set((existing.data||[]).map((v:any)=>v.audio_book_id));
   const passed=await db.from("audiobook_factory_jobs")
      .select("audio_book_id,status,stage,qc_status")
      .eq("status","ready").eq("stage","published").eq("qc_status","passed");
   if(passed.error)throw new Error("qc_query_failed");
   const approved=new Set((passed.data||[]).map((v:any)=>v.audio_book_id).filter(Boolean));
   const all=await db.from("audio_books")
      .select("id,title,is_active,status,voice_key,language_code,site_book_id")
      .eq("status","ready").eq("is_active",true)
      .order("title",{ascending:true}).limit(150);
   if(all.error)throw new Error("books_query_failed");
   for(const b of all.data||[]){
     if(pilot?b.id!==PILOT:!approved.has(b.id))continue;
     if(used.has(b.id)||!approved.has(b.id))continue;
     const chapters=await db.from("audio_chapters")
       .select("id,chapter_index,title,storage_path,duration_seconds,byte_size,updated_at")
       .eq("audio_book_id",b.id).order("chapter_index",{ascending:true}).limit(MAX_CHAPTERS+1);
     if(chapters.error)throw new Error("chapters_read_failed");
     const files=chapters.data||[];
     if(files.length<1||files.length>MAX_CHAPTERS)continue;
     let bytes=0,valid=true;const paths=new Set<string>();
     for(let i=0;i<files.length;i++){
       const c=files[i];bytes+=Number(c.byte_size);
       if(c.chapter_index!==i||!c.storage_path||!c.storage_path.endsWith(".mp3")||
          paths.has(c.storage_path)||!Number.isSafeInteger(Number(c.byte_size))||
          Number(c.byte_size)<1000||Number(c.byte_size)>50000000||
          !Number.isFinite(Number(c.duration_seconds))||Number(c.duration_seconds)<=0)
          {valid=false;break;}
       paths.add(c.storage_path);
     }
     if(!valid||bytes>MAX_MP3_BYTES)continue;
     const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(files)));
     const fingerprint=Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,"0")).join("");
     const ins=await db.from("audiobook_download_jobs")
        .upsert({audio_book_id:b.id,source_fingerprint:fingerprint,status:"queued"},
          {onConflict:"audio_book_id,source_fingerprint",ignoreDuplicates:true})
        .select("id,status").maybeSingle();
     if(ins.error)throw new Error("enqueue_failed");
     if(!ins.data)return out({ok:true,state:"already_queued"});
     return out({ok:true,state:"queued",jobId:ins.data.id,title:b.title,chapters:files.length,bytes,mode:pilot?"pilot":"auto"});
   }
   return out({ok:true,state:"idle"});
 }catch(_){return out({ok:false,error:"private_export_queue_rejected"},403);}
});
