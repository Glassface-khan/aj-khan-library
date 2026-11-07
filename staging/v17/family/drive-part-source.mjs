import {createDriveAudioAdapter} from './drive-audio-adapter.mjs';

// Connects the existing V17 M4B part numbering to the private Drive blob adapter.
// Only backend-authorized file IDs and sizes may enter this function.
// The caller owns the Google OAuth token provider; no token is persisted here.
export function createDrivePartSource({parts,getToken,fetchImpl,urls}) {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 500 ||
      parts.some(p => !p || !/^[\w-]{10,200}$/.test(p.fileId ?? '') ||
        !Number.isSafeInteger(p.bytes) || p.bytes < 1 || p.bytes > 48*1024*1024)) {
    throw Error('INVALID_PRIVATE_DRIVE_SOURCE');
  }
  if (typeof getToken !== 'function') throw Error('OAUTH_PROVIDER_REQUIRED');
  const adapter = createDriveAudioAdapter({getToken,fetchImpl,urls});
  let closed = false;
  return {
    async source(partNumber) {
      if (closed) throw Error('SOURCE_CLOSED');
      if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > parts.length) {
        throw Error('INVALID_PART_NUMBER');
      }
      return adapter.resolvePart(parts[partNumber-1]);
    },
    releasePrevious() { if (closed) throw Error('SOURCE_CLOSED'); adapter.releasePrevious(); },
    dispose() { closed = true; adapter.dispose(); },
    get count() { return parts.length; }
  };
}
