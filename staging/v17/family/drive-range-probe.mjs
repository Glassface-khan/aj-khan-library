// Browser-side, opt-in Drive API capability probe. No upload, mutation, or public link.
// Access token must come from a short-lived, consented Google OAuth flow.
// Do not persist tokens in localStorage, URLs, Supabase, or logs.
export async function probePrivateDriveM4b({ fileId, accessToken, fetchImpl = fetch }) {
  if (!/^[a-zA-Z0-9_-]{10,200}$/.test(fileId ?? '')) throw Error('INVALID_FILE_ID');
  if (typeof accessToken !== 'string' || !accessToken) throw Error('MISSING_OAUTH_TOKEN');
  const url = 'https://www.googleapis.com/drive/v3/files/' +
    encodeURIComponent(fileId) + '?alt=media';
  const response = await fetchImpl(url, {
    method: 'GET',
    mode: 'cors',
    cache: 'no-store',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      Range: 'bytes=0-1'
    }
  });
  // 200 means the server ignored Range; do not load a full book into memory.
  // Abort immediately, before consuming the response body.
  try {
    const range = response.headers.get('content-range') ?? '';
    const type = response.headers.get('content-type') ?? '';
    return {
      rangeSupported: response.status === 206 && /^bytes 0-1\/\d+$/.test(range),
      status: response.status,
      contentType: type,
      authorized: response.status === 200 || response.status === 206,
      corsReachable: true
    };
  } finally {
    await response.body?.cancel();
  }
}
