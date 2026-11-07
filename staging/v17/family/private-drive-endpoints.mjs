import {validatePrivateDriveManifest} from './private-drive-manifest.mjs';
// AF3 V17: private Drive manifest read bridge, staging only.
// Never trust browser-supplied file IDs, byte counts, URLs or chapter markers.
// Call only from an authenticated Edge Function with service-role database client.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILE=/^[a-zA-Z0-9_-]{10,200}$/;
export function createPrivateDriveEndpoints({hasSlot,loadManifest,loadChapterIds}) {
  if(typeof hasSlot!=='function'||typeof loadManifest!=='function'||typeof loadChapterIds!=='function') throw Error('TRUSTED_DEPENDENCIES_REQUIRED');
  async function source(body) {
    const bookId=String(body?.bookId??'');
    if(!UUID.test(bookId)) throw Error('INVALID_BOOK_ID');
    await hasSlot({bookId,...pickCredentials(body)});
    const manifest=await loadManifest(bookId);
    const chapterIds=await loadChapterIds(bookId);
    const verified=validatePrivateDriveManifest(manifest,{bookId,chapterIds});
    return {ok:true,source:{bookId,drive:true,...verified}};
  }
  async function part(body) {
    const bookId=String(body?.bookId??'');
    // The existing V17 player uses the field 'part', not 'partNumber'.
    const partNumber=body?.part;
    if(!UUID.test(bookId)||!Number.isInteger(partNumber)||partNumber<1)throw Error('INVALID_PART_REQUEST');
    await hasSlot({bookId,...pickCredentials(body)});
    const manifest=await loadManifest(bookId);
    const chapterIds=await loadChapterIds(bookId);
    const verified=validatePrivateDriveManifest(manifest,{bookId,chapterIds});
    const p=verified.parts[partNumber-1];
    if(!p||!FILE.test(p.fileId??'')||!Number.isSafeInteger(p.bytes)||
      p.bytes<1||p.bytes>48*1024*1024)throw Error('PRIVATE_PART_UNAVAILABLE');
    return {ok:true,bookId,partNumber,fileId:p.fileId,bytes:p.bytes};
  }
  return {source,part};
}
function pickCredentials(body){
  return {code:body?.code,adminToken:body?.adminToken,factorySession:body?.factorySession};
}
