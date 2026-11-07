// One bounded private M4B part in memory. Native audio seeks within its blob.
// The caller obtains consent through Google OAuth and supplies short-lived tokens.
export function createDriveAudioAdapter({getToken, fetchImpl = fetch, urls = URL}) {
  let activeUrl;
  let controller;
  let generation = 0;
  function dispose() {
    generation++;
    controller?.abort();
    if (activeUrl) urls.revokeObjectURL(activeUrl);
    activeUrl = undefined;
  }
  async function resolvePart(part) {
    if (!/^[\w-]{10,200}$/.test(part?.fileId ?? '') ||
        !Number.isSafeInteger(part.bytes) || part.bytes < 1 || part.bytes > 48 * 1024 * 1024) {
      throw Error('INVALID_DRIVE_PART');
    }
    controller?.abort();
    const request = ++generation;
    const abort = new AbortController();
    controller = abort;
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await getToken({refresh:attempt === 1});
      if (request !== generation) throw Error('CANCELLED');
      if (typeof token !== 'string' || !token) throw Error('OAUTH_REQUIRED');
      response = await fetchImpl('https://www.googleapis.com/drive/v3/files/' +
        encodeURIComponent(part.fileId) + '?alt=media', {
        headers:{Authorization:'Bearer ' + token}, signal:abort.signal,
        credentials:'omit', cache:'no-store', redirect:'error', mode:'cors'
      });
      if (response.status !== 401 || attempt === 1) break;
      await response.body?.cancel();
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw Error(response.status === 403 ? 'DRIVE_PERMISSION_REQUIRED' : 'DRIVE_FETCH_FAILED');
    }
    if (!response.body || request !== generation) throw Error('CANCELLED_OR_EMPTY_RESPONSE');
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > part.bytes) throw Error('DRIVE_SIZE_MISMATCH');
        chunks.push(chunk.value);
      }
      if (bytes !== part.bytes) throw Error('DRIVE_SIZE_MISMATCH');
      if (request !== generation) throw Error('CANCELLED');
      const next = urls.createObjectURL(new Blob(chunks,{type:'audio/mp4'}));
      if (request !== generation) { urls.revokeObjectURL(next); throw Error('CANCELLED'); }
      if (activeUrl) urls.revokeObjectURL(activeUrl);
      activeUrl = next;
      return next;
    } finally {
      try { await reader.cancel(); } catch (_) { /* cancellation must not hide original result */ }
      if (controller === abort) controller = undefined;
    }
  }
  return {resolvePart, dispose};
}
