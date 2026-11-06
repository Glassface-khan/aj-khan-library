// Adapted from AF3 V17 multi_player. Only verified book metadata belongs here.
export function createM4bTimeline(document) {
  const entries = document?.parts ?? [document];
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 500) {
    throw new RangeError('Invalid M4B part count');
  }

  let duration = 0;
  const parts = entries.map((entry, index) => {
    const seconds = entry?.info?.durationSeconds;
    if (!Number.isFinite(seconds) || seconds <= 1 || seconds > 48 * 3600) {
      throw new RangeError('Invalid M4B part duration');
    }
    const part = { number: index + 1, start: duration, duration: seconds };
    duration += seconds;
    return part;
  });

  const expected = document?.info?.durationSeconds;
  if (!Number.isFinite(expected) || Math.abs(expected - duration) > 0.02) {
    throw new RangeError('M4B book duration mismatch');
  }

  return {
    duration,
    locate(seconds) {
      if (!Number.isFinite(seconds)) throw new TypeError('Invalid book position');
      // Match V17 seeking: a boundary belongs to the following part.
      const target = Math.max(0, Math.min(duration - 0.01, seconds));
      for (let i = parts.length - 1; i >= 0; i--) {
        if (target >= parts[i].start) {
          return { partNumber: parts[i].number, localSeconds: target - parts[i].start };
        }
      }
    },
    bookSeconds(partNumber, localSeconds) {
      if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > parts.length) {
        throw new RangeError('Invalid M4B part number');
      }
      if (!Number.isFinite(localSeconds)) throw new TypeError('Invalid part position');
      const part = parts[partNumber - 1];
      return part.start + Math.max(0, Math.min(part.duration, localSeconds));
    },
  };
}
