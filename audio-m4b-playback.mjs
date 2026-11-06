import {createM4bTimeline} from './audio-m4b-timeline.mjs';

export function createPlayback(source, chapters) {
  const timeline = createM4bTimeline(source);
  const marks = source.chapters;
  if (!Array.isArray(marks) || !marks.length || marks.length !== chapters.length ||
      marks.some((m,i) => m.id !== chapters[i].id || !Number.isFinite(m.start) ||
        (i === 0 ? m.start !== 0 : m.start <= marks[i-1].start) || m.start >= timeline.duration)) {
    throw Error('M4B chapter mapping mismatch');
  }
  function position(seconds) {
    let i=marks.length-1;
    while (i>0 && marks[i].start>seconds) i--;
    return {chapter:chapters[i], offset:seconds-marks[i].start};
  }
  return {
    timeline, position,
    source(part) { return source.parts[part-1].url; },
    chapterTime(id, offset) {
      const i=marks.findIndex(m=>m.id===id);
      if(i<0) throw Error('Unknown chapter');
      const end=marks[i+1]?.start ?? timeline.duration;
      return Math.min(Math.max(marks[i].start,end-0.01),marks[i].start+Math.max(0,offset));
    },
    parts:source.parts.length,
  };
}
