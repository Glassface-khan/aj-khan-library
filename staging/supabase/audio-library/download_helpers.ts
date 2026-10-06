export async function downloadSnapshot(db: any, bookId: string) {
 const b=await db.from("audio_books").select("id,title,narrator_name,language_code,cover_url,status,is_active").eq("id",bookId).maybeSingle();
 if(b.error)throw b.error;
 if(!b.data||!b.data.is_active||b.data.status!=="ready")throw new Error("DOWNLOAD_BOOK_UNAVAILABLE");
 const c=await db.from("audio_chapters").select("id,chapter_index,title,storage_path,duration_seconds,byte_size,updated_at").eq("audio_book_id",bookId).order("chapter_index");
 if(c.error)throw c.error;
 if(!c.data?.length||c.data.some((x:any)=>!x.storage_path))throw new Error("DOWNLOAD_BOOK_UNAVAILABLE");
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(c.data)));
 const fingerprint=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
 return {book:b.data,chapters:c.data,fingerprint};
}
export function downloadFilePath(jobId: string,name: string){
 if(!/^[0-9a-f-]{36}$/i.test(jobId)||! /^(mp3-\d{3}\.zip|m4b-\d{3}\.m4b)$/.test(name))throw new Error("INVALID_DOWNLOAD_FILE");
 return jobId+"/"+name;
}
