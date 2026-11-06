// AF3 family pilot: deterministic, side-effect-free server-side library policy.
// Invoke within an authenticated database transaction with a per-listener lock.
// Do not trust role or listener ID supplied by the browser.
export function capacityForRole(role) {
  if (role === 'admin') return 3;
  if (role === 'guest') return 1;
  throw new Error('UNKNOWN_ROLE');
}

export function decideAssignment({ role, currentBookIds, requestedBookId }) {
  if (!Array.isArray(currentBookIds) || !currentBookIds.every(
    id => typeof id === 'string' && id.length > 0
  )) throw new Error('INVALID_LIBRARY');
  if (typeof requestedBookId !== 'string' || !requestedBookId.trim()) {
    throw new Error('INVALID_BOOK');
  }
  const distinct = new Set(currentBookIds);
  if (distinct.has(requestedBookId)) return { allowed: true, reason: 'ALREADY_ASSIGNED' };
  if (distinct.size >= capacityForRole(role)) {
    return { allowed: false, reason: 'LIBRARY_FULL' };
  }
  return { allowed: true, reason: 'SLOT_AVAILABLE' };
}

// Removing a personal assignment NEVER removes or changes the Drive original.
// A Drive permission is independent and must be revoked separately if needed.
export function decideRemoval({ currentBookIds, requestedBookId }) {
  if (!Array.isArray(currentBookIds)) throw new Error('INVALID_LIBRARY');
  return { removeAssignment: currentBookIds.includes(requestedBookId),
    deleteDriveFile: false, revokeDrivePermission: false };
}
