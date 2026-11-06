// Private pilot fixture from verified Drive metadata and Supabase backup registry.
// This is metadata only. Do not publish this module to public site assets.
// Every part stays private; no sharing or token is embedded.
export const lampKeeper = Object.freeze({
  title: 'The Lamp Keeper',
  narrator: 'Mike Jordan',
  language: 'EN',
  folderId: '1DTe1e04r4ybB2FQ8x6_6ivUFYjJv0euJ',
  parts: Object.freeze([
    {index:1,id:'1v54Io9QidgSZ7yyTwpHNMgDZzfAbuRFd',name:'m4b-001.m4b',bytes:39139616},
    {index:2,id:'13Naps0btEqnUzFDFEyCY-LI0fJo0VRdo',name:'m4b-002.m4b',bytes:38070907},
    {index:3,id:'13im_gLZV1EGq0hCTnK_TkdPRtUFhZBmp',name:'m4b-003.m4b',bytes:38378055},
    {index:4,id:'1IsEzwzjD3pkzl0XF7s17omEDolJvC2y9',name:'m4b-004.m4b',bytes:40678316},
    {index:5,id:'11XkZL7Sa9knx6cvQumI-d3y6T7vUtjsK',name:'m4b-005.m4b',bytes:20322986}
  ])
});
export function validateMultipartBook(book) {
  if (!book || !Array.isArray(book.parts) || book.parts.length === 0) throw Error('EMPTY_BOOK');
  const seen = new Set();
  for (const [i,part] of book.parts.entries()) {
    if (part.index !== i+1 || seen.has(part.id) || !Number.isSafeInteger(part.bytes) || part.bytes<=0) {
      throw Error('INVALID_PART_SEQUENCE');
    }
    seen.add(part.id);
  }
  return {bookCount:1,partCount:book.parts.length,totalBytes:book.parts.reduce((n,p)=>n+p.bytes,0)};
}
