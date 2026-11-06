import { decideAssignment } from './library-policy.mjs';

// Only call with the result of the existing server-side checkAudioAccess verifier.
// NEVER pass unverified client-provided isAdmin, listenerId or audioAccess here.
export function authorizeFamilyAssignment({ verifiedAccess, bookTitle, assignedBookIds, bookId }) {
  if (verifiedAccess?.ok !== true ||
      typeof verifiedAccess.listenerId !== 'string' ||
      !verifiedAccess.listenerId.trim()) throw new Error('UNAUTHORIZED');
  if (typeof bookTitle !== 'string' || !bookTitle.trim()) throw new Error('INVALID_BOOK_TITLE');
  const role = verifiedAccess.isAdmin === true ? 'admin' : 'guest';
  const entitled = verifiedAccess.fullAudioAccess === true ||
    verifiedAccess.audioAccess?.[bookTitle] === true;
  if (!entitled) return {allowed:false,reason:'NOT_ENTITLED'};
  return {...decideAssignment({role,currentBookIds:assignedBookIds,requestedBookId:bookId}),
    listenerId:verifiedAccess.listenerId,role};
}

// Caller must re-check entitlement and slot count INSIDE the same locked DB transaction.
// This pure helper intentionally cannot enforce concurrent assignments by itself.
