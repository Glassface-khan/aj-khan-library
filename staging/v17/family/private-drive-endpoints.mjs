// AF3 V17: private Drive manifest read bridge, staging only.
// Never trust browser-supplied file IDs, byte counts, URLs or chapter markers.
// Call only from an authenticated Edge Function with service-role database client.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILE=/^[a-zA-Z0-9_-]{10,200}$/;
export function createPrivateDriveEndpoints({hasSlot,loadManifest}) {
  if(typeof hasSlot!=='function'||typeof loadManifest!=='function') throw Error('TRUSTED_DEPENDENCIES_REQUIRED');
  async function source(body) {
    const bookId=String(body?.bookId??'');
    if(!UUID.test(bookId)) throw Error('INVALID_BOOK_ID');
    await hasSlot({bookId,...pickCredentials(body)});
    const manifest=await loadManifest(bookId);
    if(!manifest||manifest.bookId!==bookId||!Array.isArray(manifest.parts)||
      manifest.parts.length<1||manifest.parts.length>500) throw Error('PRIVATE_MANIFEST_UNAVAILABLE');
    let duration=0;
    const parts=manifest.parts.map((p,i)=>{
      if(!FILE.test(p?.fileId??'')||!Number.isSafeInteger(p.bytes)||
        p.bytes<1||p.bytes>48*1024*1024||!Number.isFinite(p.durationSeconds)||
        p.durationSeconds<=1||p.durationSeconds>48*3600) throw Error('INVALID_PRIVATE_MANIFEST');
      duration+=p.durationSeconds;
      return {number:i+1,fileId:p.fileId,bytes:p.bytes,info:{durationSeconds:p.durationSeconds}};
    });
    if(!Array.isArray(manifest.chapters)||!manifest.chapters.length)throw Error('INVALID_PRIVATE_MANIFEST');
    const chapters=manifest.chapters.map(c=>({id:c.id,start:c.start}));
    if(chapters.some((c,i)=>typeof c.id!=='string'||!c.id||
      !Number.isFinite(c.start)||(i===0?c.start!==0:c.start<=chapters[i-1].start)||
      c.start>=duration))throw Error('INVALID_PRIVATE_MANIFEST');
    return {ok:true,source:{bookId,drive:true,parts,chapters,info:{durationSeconds:duration}}};
  }
  async function part(body) {
    const bookId=String(body?.bookId??'');
    // The existing V17 player uses the field 'part', not 'partNumber'.
    const partNumber=body?.part;
    if(!UUID.test(bookId)||!Number.isInteger(partNumber)||partNumber<1)throw Error('INVALID_PART_REQUEST');
    await hasSlot({bookId,...pickCredentials(body)});
    const manifest=await loadManifest(bookId);
    const p=manifest?.bookId===bookId&&Array.isArray(manifest.parts)?manifest.parts[partNumber-1]:null;
    if(!p||!FILE.test(p.fileId??'')||!Number.isSafeInteger(p.bytes)||
      p.bytes<1||p.bytes>48*1024*1024)throw Error('PRIVATE_PART_UNAVAILABLE');
    return {ok:true,bookId,partNumber,fileId:p.fileId,bytes:p.bytes};
  }
  return {source,part};
}
function pickCredentials(body){
  return {code:body?.code,adminToken:body?.adminToken,factorySession:body?.factorySession};
}
