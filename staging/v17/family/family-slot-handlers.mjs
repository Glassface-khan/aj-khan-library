// AF3 V17 pilot backend bridge. Never deploy without binding to the existing
// server-side verifyAccess() implementation. This module has no browser exports.
// Dependencies are injected for isolated tests; supabase must be service-role.
// The caller must NOT accept listenerId/isAdmin/fullAudioAccess from request JSON.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createFamilySlotHandlers({verifyAccess, supabase}) {
  if (typeof verifyAccess !== 'function' || !supabase?.from || !supabase?.rpc) {
    throw Error('TRUSTED_BACKEND_DEPENDENCIES_REQUIRED');
  }
  async function authorize(body) {
    const bookId = String(body?.bookId ?? '');
    if (!UUID.test(bookId)) throw Error('INVALID_BOOK_ID');
    // Never derive identity from the request body.
    const access = await verifyAccess(body);
    const listenerId = String(access?.listenerId ?? '');
    if (!access?.ok || !listenerId || listenerId.length > 200) throw Error('UNAUTHORIZED');
    const {data:book,error} = await supabase.from('audio_books')
      .select('id,title,is_active,status').eq('id',bookId).maybeSingle();
    if (error) throw error;
    if (!book || book.is_active !== true || book.status !== 'ready') throw Error('BOOK_UNAVAILABLE');
    if (access.fullAudioAccess !== true && access.audioAccess?.[book.title] !== true) {
      throw Error('FORBIDDEN');
    }
    return {bookId,listenerId,isOwner:access.isAdmin === true};
  }
  async function assignment(body) {
    const a = await authorize(body);
    const {data,error} = await supabase.rpc('af3_assign_family_book',{
      p_listener_id:a.listenerId,p_audio_book_id:a.bookId,p_is_owner:a.isOwner
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.assigned) throw Error('ASSIGNMENT_FAILED');
    return {ok:true,activeCount:row.active_count,slotLimit:row.slot_limit};
  }
  async function removal(body) {
    // Removal must still work after a book is archived, deactivated, or its
    // listening grant is revoked. Only the authenticated listener's own slot
    // may be removed; the RPC never deletes audio or Drive originals.
    const bookId = String(body?.bookId ?? '');
    if (!UUID.test(bookId)) throw Error('INVALID_BOOK_ID');
    const access = await verifyAccess(body);
    const listenerId = String(access?.listenerId ?? '');
    if (!access?.ok || !listenerId || listenerId.length > 200) throw Error('UNAUTHORIZED');
    const {data,error} = await supabase.rpc('af3_remove_family_book',{
      p_listener_id:listenerId,p_audio_book_id:bookId
    });
    if (error) throw error;
    // No Drive API calls, deletions, or mutation of original audio objects.
    return {ok:true,removed:data === true};
  }
  async function hasSlot(body) {
    const a = await authorize(body);
    const {data,error} = await supabase.from('af3_family_book_slots')
      .select('audio_book_id').eq('listener_id',a.listenerId)
      .eq('audio_book_id',a.bookId).maybeSingle();
    if (error) throw error;
    if (!data) throw Error('BOOK_NOT_ASSIGNED');
    return {ok:true,listenerId:a.listenerId,bookId:a.bookId};
  }
  return {assignment,removal,hasSlot};
}
// Integration contract:
// 1. Call assignment/removal ONLY after server verifyAccess, never client claims.
// 2. m4bSource/m4bPart MUST call hasSlot before revealing Drive IDs.
// 3. For Drive file IDs, validate each belongs to the authorized book and
//    belongs to the private verified Drive manifest; never trust a client fileId.
// 4. Do not wire these handlers into production until SQL and security tests pass.
