// AF3 V17: server-side manifest validator, never a browser input.
// The private manifest is injected from a trusted backend store; this module
// does not store Drive file IDs in the repository or public website.
const ID=/^[a-zA-Z0-9_-]{10,200}$/;
export function validatePrivateDriveManifest(manifest,{bookId,chapterIds}={}) {
  if(!manifest||manifest.bookId!==bookId||!Array.isArray(manifest.parts)||
    manifest.parts.length<1||manifest.parts.length>500||
    !Array.isArray(chapterIds)||!chapterIds.length||
    !Array.isArray(manifest.chapters)||manifest.chapters.length!==chapterIds.length)
    throw Error('INVALID_PRIVATE_MANIFEST');
  let duration=0;
  const seen=new Set();
  const parts=manifest.parts.map((p,index)=>{
    if(!ID.test(p?.fileId??'')||seen.has(p.fileId)||
      !Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>48*1024*1024||
      !Number.isFinite(p.durationSeconds)||p.durationSeconds<=1||p.durationSeconds>48*3600)
      throw Error('INVALID_PRIVATE_PART');
    seen.add(p.fileId);
    duration+=p.durationSeconds;
    return {number:index+1,fileId:p.fileId,bytes:p.bytes,info:{durationSeconds:p.durationSeconds}};
  });
  const chapters=manifest.chapters.map((c,index)=>{
    if(c?.id!==chapterIds[index]||!Number.isFinite(c.start)||
      (index===0?c.start!==0:c.start<=manifest.chapters[index-1].start)||
      c.start>=duration)throw Error('INVALID_CHAPTER_MAPPING');
    return {id:c.id,start:c.start};
  });
  if(!Number.isFinite(duration)||duration<=1||
    (Number.isFinite(manifest.durationSeconds)&&Math.abs(duration-manifest.durationSeconds)>0.02))
    throw Error('PRIVATE_DURATION_MISMATCH');
  return {parts,chapters,info:{durationSeconds:duration}};
}
