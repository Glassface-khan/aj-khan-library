import {createM4bTimeline} from './audio-m4b-timeline.mjs';
import {createDriveAudioAdapter} from './staging/v17/family/drive-audio-adapter.mjs';

export function createPlayback(source, chapters, options = {}) {
  const timeline = createM4bTimeline(source);
  const marks = source.chapters;
  if (!Array.isArray(marks) || !marks.length || marks.length !== chapters.length ||
      marks.some((m,i) => m.id !== chapters[i].id || !Number.isFinite(m.start) ||
        (i === 0 ? m.start !== 0 : m.start <= marks[i-1].start) || m.start >= timeline.duration)) {
    throw Error('M4B chapter mapping mismatch');
  }
  // Drive metadata is supplied only by the authenticated backend. No file IDs
  // or tokens are accepted from browser-local storage.
  const drive = source.drive === true;
  if (drive && (typeof options.getDriveToken !== 'function' ||
      source.parts.some(p => !/^[\w-]{10,200}$/.test(p.fileId ?? '') ||
        !Number.isSafeInteger(p.bytes) || p.bytes < 1 || p.bytes > 48*1024*1024))) {
    throw Error('PRIVATE_DRIVE_AUTH_OR_METADATA_REQUIRED');
  }
  const driveAdapter = drive ? createDriveAudioAdapter({getToken:options.getDriveToken}) : null;
  function position(seconds) {
    let i=marks.length-1;
    while (i>0 && marks[i].start>seconds) i--;
    return {chapter:chapters[i], offset:seconds-marks[i].start};
  }
  return {
    timeline, position,
    guest: source.guest === true,
    drive,
    async resolvePart(part) {
      if (!Number.isInteger(part) || part < 1 || part > source.parts.length) throw Error('INVALID_PART_NUMBER');
      return drive ? driveAdapter.resolvePart(source.parts[part-1]) : source.parts[part-1].url;
    },
    dispose() { driveAdapter?.dispose(); },
    source(part) { return source.parts[part-1].url; },
    chapterTime(id, offset) {
      const i=marks.findIndex(m=>m.id===id);
      if(i<0) throw Error('Unknown chapter');
      const end=marks[i+1]?.start ?? timeline.duration;
      return Math.max(marks[i].start, Math.min(end-0.01, marks[i].start+Math.max(0,offset)));
    },
    parts:source.parts.length,
  };
}
