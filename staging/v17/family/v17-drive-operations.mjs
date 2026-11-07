// AF3 V17 private Drive backend wiring. STAGING ONLY.
// Mount these operations in the existing audio-library Edge Function only
// after the slot migration and private manifest source are independently verified.
import {createFamilySlotHandlers} from './family-slot-handlers.mjs';
import {createPrivateDriveEndpoints} from './private-drive-endpoints.mjs';

export function createV17DriveOperations({verifyAccess,supabase,loadManifest,loadChapterIds}) {
  const slots=createFamilySlotHandlers({verifyAccess,supabase});
  const drive=createPrivateDriveEndpoints({hasSlot:slots.hasSlot,loadManifest,loadChapterIds});
  return Object.freeze({
    familyAssign:slots.assignment,
    familyRemove:slots.removal,
    m4bSource:drive.source,
    m4bPart:drive.part
  });
}

// Safe dispatcher contract: caller must never spread client JSON into a
// privileged database query, nor pass caller-supplied listenerId/isAdmin.
// Existing audio-library routes remain untouched until explicit deployment.
export async function handleV17DriveOperation(operations,body) {
  const op=String(body?.op??'');
  if(!Object.hasOwn(operations,op)||typeof operations[op]!=='function')
    throw Error('UNKNOWN_V17_OPERATION');
  return operations[op](body);
}
