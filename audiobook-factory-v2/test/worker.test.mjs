import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";
import {signTicket,verifyTicket} from "../src/security.mjs";

const DOC= "03cd8d34-7e98-4e7b-a8d9-1683fdf13f50";
const BOOK="cfbbac3d-61d6-47b1-ab4c-2a2ae2a68a16";
const LISTENER="ea369218-c6db-462d-a43f-5b24f84c8fed";
const HOST="https://ajk-v2-pilot.workers.dev";
const PASS="test-only-strong-enough-ticket-hmac-secret-do-not-deploy";
const binary=new TextEncoder().encode("AJK test audio bytes -- completely synthetic");

function mockDb() {
  let book={id:BOOK,title:"Pilot Novel",status:"ready",is_published:1,
    cover_url:"",description:"",language_code:"EN",voice_name:"Test Voice"};
  const chapter={id:DOC,book_id:BOOK,book_title:"Pilot Novel",chapter_id:DOC,
    chapter_number:0,chapter_title:"Prologue",r2_key:"audio/pilot/prologue.mp3",
    status:"ready",is_published:1};
  const jobs=new Map();
  return {
    book,chapter,jobs,
    prepare(sql) {
      let args=[];
      return {
        bind(...values){args=values;return this;},
        async first() {
          if(sql.includes("FROM chapters c JOIN books b")) return args[0]===DOC
            ? {...chapter,status:book.status,is_published:book.is_published} : null;
          if(sql.includes("FROM production_jobs")) return jobs.get(args[0])||null;
          throw new Error("unexpected first SQL");
        },
        async all() {
          if(sql.includes("FROM books")) return {results:book.is_published&&book.status==="ready"?[book]:[]};
          if(sql.includes("FROM chapters")) return {results:args[0]===BOOK?
            [{id:DOC,chapter_number:0,title:"Prologue",duration_seconds:9}]:[]};
          if(sql.includes("FROM production_jobs")) return {results:[...jobs.values()]};
          throw new Error("unexpected all SQL");
        },
        async run() {
          if(sql.startsWith("INSERT INTO production_jobs")) {
            const [id,title,language_code,voice_key,stage]=args;
            jobs.set(id,{id,title,language_code,voice_key,stage,source_r2_key:null});
            return {meta:{changes:1}};
          }
          if(sql.startsWith("UPDATE production_jobs")) {
            const [source_r2_key,source_sha256,id]=args;
            const row=jobs.get(id);
            if(!row||row.stage!=="awaiting_source")return {meta:{changes:0}};
            Object.assign(row,{source_r2_key,source_sha256,stage:"awaiting_voice_preflight"});
            return {meta:{changes:1}};
          }
          throw new Error("unexpected write SQL");
        }
      };
    }
  };
}
function mockStorage() {
  let uploaded=[];
  return {
    uploaded,
    async put(k,data,metadata){uploaded.push({k,bytes:data.byteLength,metadata});return {key:k};},
    async get(key,options) {
      if(key!=="audio/pilot/prologue.mp3")return null;
      const range=options.range?.get("Range");
      let offset=0,length=binary.length;
      if(range) {
        const m=range.match(/^bytes=(\d+)-(\d*)$/);
        if(m) {offset=Number(m[1]); length=(m[2]?Number(m[2])+1:binary.length)-offset;}
      }
      return {size:binary.length,range:range?{offset,length}:undefined,
        body:new Blob([binary.slice(offset,offset+length)]).stream(),
        httpEtag:'"mock"',
        writeHttpMetadata(h){h.set("Content-Type","audio/mpeg")}};
    }
  };
}
function setup() {
  const DB=mockDb(),PRIVATE_AUDIO=mockStorage();
  const env={DB,PRIVATE_AUDIO,TICKET_SECRET:PASS,GAS_WEB_APP_URL:"https://script.google.com/macros/s/fake-id/exec"};
  const realFetch=globalThis.fetch;
  const seen=[];
  globalThis.fetch=async (url,opts)=>{
    const body=new URLSearchParams(opts.body);
    seen.push({url,method:opts.method,action:body.get("action"),book:body.get("bookTitle")});
    const okay=body.get("code")==="family-ok"||body.get("adminToken")==="author-ok";
    const admin=body.get("adminToken")==="author-ok";
    return Response.json(okay?{
      ok:true,isAdmin:admin,fullAudioAccess:admin,listenerId:LISTENER,
      allowed:admin||body.get("bookTitle")==="Pilot Novel",
      audioAccess:admin?{}:{"Pilot Novel":true}
    }:{ok:false});
  };
  return {env,DB,PRIVATE_AUDIO,seen,restore(){globalThis.fetch=realFetch}};
}
function post(path,data,origin="https://glassface-khan.github.io"){
  return new Request(HOST+path,{
    method:"POST",headers:{"Origin":origin,"Content-Type":"application/json"},
    body:JSON.stringify(data)
  });
}
const family={code:"family-ok"};
test("ticket HMAC validation and expiry",async()=>{
  const now=1_800_000_000;
  const tok=await signTicket({ch:DOC,book:BOOK,listener:LISTENER,exp:now+900},PASS,now);
  assert.equal((await verifyTicket(tok,PASS,now)).ch,DOC);
  assert.equal(await verifyTicket(tok+"x",PASS,now),null);
  assert.equal(await verifyTicket(tok,PASS,now+901),null);
});
test("no backend configured exposes no data",async()=>{
  const r=await worker.fetch(new Request(HOST+"/v1/catalog",{method:"POST"}),{});
  assert.equal(r.status,503);
});
test("health is private-resource agnostic",async()=>{
  const t=setup();try{
    const r=await worker.fetch(new Request(HOST+"/health"),t.env);
    assert.equal((await r.json()).configured,true);
  }finally{t.restore();}
});
test("family catalog respects existing Apps Script permissions",async()=>{
  const t=setup();try{
    const r=await worker.fetch(post("/v1/catalog",family),t.env);
    assert.equal(r.status,200);
    const d=await r.json();
    assert.equal(d.books.length,1);
    assert.equal(d.books[0].chapters[0].id,DOC);
    assert.equal(t.seen[0].method,"POST");
    assert.equal(t.seen[0].url.includes("family-ok"),false);
  }finally{t.restore();}
});
test("bad family code does not grant access",async()=>{
  const t=setup();try{
    assert.equal((await worker.fetch(post("/v1/catalog",{code:"invalid"}),t.env)).status,401);
  }finally{t.restore();}
});
test("direct cross-site browser calls are blocked",async()=>{
  const t=setup();try{
    assert.equal((await worker.fetch(post("/v1/catalog",family,"https://wrong.example"),t.env)).status,403);
  }finally{t.restore();}
});
test("ticket can stream synthetic private bytes, including HTTP 206",async()=>{
  const t=setup();try{
    const issue=await worker.fetch(post("/v1/chapter-ticket",
      {...family,chapter_id:DOC}),t.env);
    assert.equal(issue.status,200);
    const d=await issue.json();
    assert.ok(d.url.startsWith(HOST+"/v1/media/"));
    assert.equal(d.url.includes("audio/pilot"),false);
    const response=await worker.fetch(new Request(d.url,{
      headers:{"Range":"bytes=0-7","Origin":"https://glassface-khan.github.io"}
    }),t.env);
    assert.equal(response.status,206);
    assert.equal(response.headers.get("content-range"),"bytes 0-7/"+binary.length);
    assert.equal((await response.arrayBuffer()).byteLength,8);
  }finally{t.restore();}
});
test("tampered media ticket refused, unpublished chapter refused",async()=>{
  const t=setup();try{
    const d=await (await worker.fetch(post("/v1/chapter-ticket",
      {...family,chapter_id:DOC}),t.env)).json();
    assert.equal((await worker.fetch(new Request(d.url.replace(/.$/,"X")),t.env)).status,401);
    t.DB.book.is_published=0;
    assert.equal((await worker.fetch(new Request(d.url),t.env)).status,401);
  }finally{t.restore();}
});
test("admin creates draft job; family code cannot",async()=>{
  const t=setup();try{
    const body={title:"Test Novel",language_code:"EN",voice_key:"test_voice"};
    assert.equal((await worker.fetch(post("/v1/jobs",{...family,...body}),t.env)).status,401);
    const good=await worker.fetch(post("/v1/jobs",{adminToken:"author-ok",...body}),t.env);
    assert.equal(good.status,201);
    const d=await good.json();
    assert.equal(d.stage,"awaiting_source");
    assert.equal(t.DB.jobs.size,1);
  }finally{t.restore();}
});
test("upload accepts private valid small DOCX, never publishes automatically",async()=>{
  const t=setup();try{
    const d=await (await worker.fetch(post("/v1/jobs",{
      adminToken:"author-ok",title:"Another Pilot",language_code:"DE",voice_key:"sample"
    }),t.env)).json();
    const bytes=new Uint8Array([0x50,0x4b,0x03,0x04,1,2,3]);
    const up=await worker.fetch(new Request(HOST+"/v1/jobs/"+d.job_id+"/source",{
      method:"PUT",headers:{"X-Author-Token":"author-ok","Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
      body:bytes
    }),t.env);
    assert.equal(up.status,200);
    assert.equal((await up.json()).stage,"awaiting_voice_preflight");
    assert.equal(t.PRIVATE_AUDIO.uploaded.length,1);
    assert.equal(t.DB.jobs.get(d.job_id).stage,"awaiting_voice_preflight");
  }finally{t.restore();}
});
