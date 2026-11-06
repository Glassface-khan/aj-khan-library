// Only server-registered, verified editions may be advertised by the pilot.
export function registeredSource(config, bookId, origin) {
  const entry = config[bookId];
  if (!entry) return null;
  const host = new URL(origin);
  if (host.protocol !== 'https:' || !host.hostname.endsWith('.ts.net') ||
      host.username || host.password || host.href !== host.origin + '/' ||
      !/^[a-z0-9-]{1,80}$/.test(entry.slug)) throw Error('INVALID_M4B_SOURCE');
  const base = host.origin + '/drive-private/books/' + entry.slug;
  const parts = entry.parts ?? [entry.info];
  if (!Array.isArray(parts) || !parts.length || parts.length > 500) throw Error('INVALID_M4B_SOURCE');
  return {
    info: { durationSeconds: entry.info.durationSeconds },
    chapters: entry.chapters.map(({id, start}) => ({id, start})),
    parts: parts.map((part, i) => ({
      info: {durationSeconds: part.durationSeconds},
      url: base + (entry.parts ? '/part/' + (i + 1) : '') + '/audio.m4b',
    })),
  };
}
