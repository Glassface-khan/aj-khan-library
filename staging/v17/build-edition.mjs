// Build the pilot mapping offline from a ready V17 registry row and the matching
// legacy catalog edition. Neither Google Drive IDs nor credentials are emitted.
import {readFileSync} from 'node:fs';
import {createPlayback} from '../../audio-m4b-playback.mjs';
import {registeredSource} from '../supabase/audio-library/m4b-source.mjs';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const [rowPath, bookPath, backupPath] = process.argv.slice(2);
const row = read(rowPath);
const book = read(bookPath);
const doc = typeof row.document === 'string' ? JSON.parse(row.document) : row.document;
const normalize = value => String(value ?? '').normalize('NFC').trim().toLowerCase();
if (row.state !== 'ready' || !book.id || !book.title ||
    normalize(book.title) !== normalize(doc.info.title)) throw Error('Edition/title mismatch');
const backup = read(backupPath);
const media = doc.parts ? doc.parts.map(p => p.edition) : [doc.edition];
const archived = [...backup.files].sort((a,b)=>a.name.localeCompare(b.name));
if (backup.audio_book_id !== book.id || archived.length !== media.length ||
    media.some((edition,i) => archived[i].id !== edition.drive_file_id ||
      Number(archived[i].bytes) !== Number(edition.size) ||
      !archived[i].md5 || archived[i].md5 !== edition.drive_md5)) {
  throw Error('Archive receipt does not match the legacy edition');
}
const chapters = doc.info.chapters;
if (chapters.length !== book.chapters.length ||
    chapters.some((c,i) => !book.chapters[i].id || normalize(c.title) !== normalize(book.chapters[i].title))) {
  throw Error('Chapter mapping needs review');
}
const entry = {slug:row.id, info:{durationSeconds:doc.info.durationSeconds,sha256:doc.edition.sha256},
  chapters:chapters.map((c,i)=>({id:book.chapters[i].id, start:c.start}))};
if (doc.parts) {
  if (doc.parts.some((p,i)=>p.number!==i+1)) throw Error('Part order mismatch');
  entry.parts = doc.parts.map(p=>({durationSeconds:p.info.durationSeconds,sha256:p.edition.sha256}));
}
const mapping = {[book.id]:entry};
// Validation only. The real private hostname is configured separately.
createPlayback(registeredSource(mapping, book.id, 'https://validation.ts.net'),book.chapters);
console.log(JSON.stringify(mapping));
