import { downloadSnapshot, downloadFilePath } from "./download_helpers.ts";
const table = "audiobook_drive_backups";
function checked(result: any) { if (result.error) throw result.error; return result.data; }
export async function driveBackupOperation(db: any, op: string, body: any, runId: number | null) {
  const now = () => new Date().toISOString();
  if (op === "driveBackupStatus" || op === "requestDriveBackup") {
    const snapshot = await downloadSnapshot(db, String(body.bookId || ""));
    let job = checked(await db.from(table).select("*").eq("audio_book_id", snapshot.book.id).eq("source_fingerprint", snapshot.fingerprint).maybeSingle());
    if (op === "requestDriveBackup") {
      // Packaging and backup are independent queues; never regenerate spoken audio.
      checked(await db.from("audiobook_download_jobs").upsert({audio_book_id: snapshot.book.id, source_fingerprint: snapshot.fingerprint}, {onConflict:"audio_book_id,source_fingerprint",ignoreDuplicates:true}));
      checked(await db.from("audiobook_download_jobs").update({status:"queued",error_detail:null,updated_at:now()}).eq("audio_book_id", snapshot.book.id).eq("source_fingerprint", snapshot.fingerprint).eq("status","failed"));
      if (!job) {
        checked(await db.from(table).upsert({audio_book_id: snapshot.book.id, source_fingerprint: snapshot.fingerprint}, {onConflict:"audio_book_id,source_fingerprint",ignoreDuplicates:true}));
      } else if (["failed","connection_required"].includes(job.status)) {
        checked(await db.from(table).update({status:"queued",error_detail:null,updated_at:now()}).eq("id",job.id).in("status",["failed","connection_required"]));
      }
      job = checked(await db.from(table).select("*").eq("audio_book_id", snapshot.book.id).eq("source_fingerprint", snapshot.fingerprint).single());
    }
    return {ok:true,status:job?.status || "not_requested",progressDone:job?.progress_done || 0,progressTotal:job?.progress_total || 0,
      folderUrl:job?.status === "ready" && job.folder_id ? "https://drive.google.com/drive/folders/"+job.folder_id : null,
      error:job?.error_detail || null};
  }
  if (!Number.isSafeInteger(runId) || !runId) throw new Error("WORKER_UNAUTHORIZED");
  if (op === "driveBackupClaim") {
    checked(await db.from(table).update({status:"failed",error_detail:"Sicherung unterbrochen. Bitte erneut starten.",updated_at:now()}).eq("status","copying").lt("updated_at",new Date(Date.now()-2*3600000).toISOString()));
    const waiting = checked(await db.from(table).select("*").eq("status","queued").order("created_at").limit(30));
    for (const candidate of waiting || []) {
      const snapshot = await downloadSnapshot(db,candidate.audio_book_id).catch(()=>null);
      if (!snapshot || snapshot.fingerprint !== candidate.source_fingerprint) {
        checked(await db.from(table).update({status:"failed",error_detail:"Hörbuchfassung geändert. Bitte Sicherung erneut anfordern.",updated_at:now()}).eq("id",candidate.id).eq("status","queued"));
        continue;
      }
      const downloads = checked(await db.from("audiobook_download_jobs").select("*").eq("audio_book_id",candidate.audio_book_id).eq("source_fingerprint",candidate.source_fingerprint).maybeSingle());
      if (downloads?.status === "failed") {
        checked(await db.from(table).update({status:"failed",error_detail:"Download-Vorbereitung fehlgeschlagen. Bitte erneut starten.",updated_at:now()}).eq("id",candidate.id).eq("status","queued"));
        continue;
      }
      if (downloads?.status !== "ready") continue;
      const files = (downloads.files || []).filter((f: any)=> /^m4b-\d{3}\.m4b$/.test(f.name));
      if (!files.length) throw new Error("DOWNLOAD_FORMAT_MISSING");
      const job = checked(await db.from(table).update({status:"copying",worker_run_id:runId,progress_total:files.length,progress_done:0,updated_at:now()}).eq("id",candidate.id).eq("status","queued").select("*").maybeSingle());
      if (!job) continue;
      const sources = [];
      for (const file of files) {
        if(file.path !== downloadFilePath(downloads.id,file.name)) throw new Error("INVALID_DOWNLOAD_FILE");
        const link = checked(await db.storage.from("audiobook-downloads").createSignedUrl(file.path,3600));
        sources.push({name:file.name,bytes:file.bytes,url:link.signedUrl});
      }
      return {ok:true,job,book:snapshot.book,files:sources};
    }
    return {ok:true,job:null};
  }
  const job = checked(await db.from(table).select("*").eq("id",String(body.jobId || "")).eq("status","copying").eq("worker_run_id",runId).single());
  if (op === "driveBackupProgress") {
    const done = Number(body.done);
    if (!Number.isInteger(done) || done < job.progress_done || done > job.progress_total) throw new Error("INVALID_PROGRESS");
    checked(await db.from(table).update({progress_done:done,updated_at:now()}).eq("id",job.id).eq("worker_run_id",runId).eq("status","copying"));
    return {ok:true};
  }
  if (op !== "driveBackupFinish") throw new Error("UNKNOWN_OPERATION");
  const success = body.success === true;
  let files = [];
  if (success) {
    const snapshot = await downloadSnapshot(db,job.audio_book_id);
    if (snapshot.fingerprint !== job.source_fingerprint) throw new Error("EDITION_CHANGED");
    if (!/^[a-zA-Z0-9_-]{10,200}$/.test(String(body.folderId || "")) || !Array.isArray(body.files) || body.files.length !== job.progress_total) throw new Error("INVALID_BACKUP_FILES");
    const download = checked(await db.from("audiobook_download_jobs").select("files").eq("audio_book_id",job.audio_book_id).eq("source_fingerprint",job.source_fingerprint).eq("status","ready").single());
    const expected = download.files.filter((f: any)=> /^m4b-\d{3}\.m4b$/.test(f.name));
    const seen = new Set();
    for (const f of body.files) {
      const source = expected.find((x: any)=>x.name === f.name);
      if (!source || source.bytes !== f.bytes || seen.has(f.name) || !/^[a-zA-Z0-9_-]{10,200}$/.test(String(f.id || "")) || !/^[a-f0-9]{32}$/.test(String(f.md5 || ""))) throw new Error("INVALID_BACKUP_FILES");
      seen.add(f.name);files.push({name:f.name,id:f.id,bytes:f.bytes,md5:f.md5});
    }
  }
  const connection = body.reason === "connection_required";
  checked(await db.from(table).update({status:success?"ready":connection?"connection_required":"failed",folder_id:success?body.folderId:job.folder_id,files:success?files:job.files,progress_done:success?job.progress_total:job.progress_done,
    error_detail:success?null:connection?"Google Drive noch nicht verbunden. Einmalige Einrichtung erforderlich.":"Drive-Sicherung fehlgeschlagen. Bitte erneut versuchen.",updated_at:now()}).eq("id",job.id).eq("worker_run_id",runId).eq("status","copying"));
  return {ok:true};
}
