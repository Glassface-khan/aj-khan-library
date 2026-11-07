// Private manifest store: service-role Supabase client only. No browser access.
// The table is deliberately separate from public audio_books metadata.
export function createPrivateManifestStore(supabase) {
  if(!supabase?.from)throw Error('SERVICE_ROLE_CLIENT_REQUIRED');
  return {
    async loadManifest(bookId) {
      const {data,error}=await supabase.from('af3_private_drive_manifests')
        .select('manifest').eq('audio_book_id',bookId).maybeSingle();
      if(error)throw error;
      if(!data?.manifest)throw Error('PRIVATE_MANIFEST_NOT_FOUND');
      // Never merge any client-supplied metadata into this record.
      return data.manifest;
    },
    async loadChapterIds(bookId) {
      const {data,error}=await supabase.from('audio_chapters')
        .select('id,chapter_index').eq('audio_book_id',bookId)
        .order('chapter_index',{ascending:true});
      if(error)throw error;
      if(!Array.isArray(data)||data.length===0)throw Error('CATALOG_CHAPTERS_NOT_FOUND');
      if(data.some((c,i)=>c.chapter_index!==i))throw Error('CATALOG_CHAPTER_ORDER_INVALID');
      return data.map(c=>c.id);
    }
  };
}
