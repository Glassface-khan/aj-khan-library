const fs = require('fs');

const path = 'index.html';
let s = fs.readFileSync(path, 'utf8');

function replaceDecodedOnce(oldDecoded, newDecoded, label) {
  const oldEncoded = JSON.stringify(oldDecoded).slice(1, -1);
  const newEncoded = JSON.stringify(newDecoded).slice(1, -1);
  const first = s.indexOf(oldEncoded);
  const second = first < 0 ? -1 : s.indexOf(oldEncoded, first + oldEncoded.length);
  if (first < 0) throw new Error(label + ': marker not found');
  if (second >= 0) throw new Error(label + ': marker occurs more than once');
  s = s.slice(0, first) + newEncoded + s.slice(first + oldEncoded.length);
}

const current = [
  '  fetchBooks = (attempt = 0) => {',
  '    // AJK live book revalidation: never trust a stale browser/PWA draft as',
  '    // the final source. Always request the current BooksData snapshot with a',
  '    // cache-busting query and retry short-lived Apps-Script/network failures.',
  "    const url = this.SCRIPT_URL + '?action=getBooks&_=' + Date.now();",
  "    fetch(url, { cache: 'no-store' })",
  '      .then(r => {',
  "        if (!r.ok) throw new Error('getBooks_http_' + r.status);",
  '        return r.json();',
  '      })',
  '      .then(data => {',
  "        const books = JSON.parse(data.books || '[]');",
  "        if (!Array.isArray(books) || !books.length) throw new Error('getBooks_empty');",
  '        this.setState({ books });',
  "        try { localStorage.setItem('ajk_author_books_draft', JSON.stringify({ books })); } catch (e) {}",
  '      })',
  '      .catch(() => {',
  '        if (attempt < 3) {',
  '          const delay = 800 * (attempt + 1);',
  '          setTimeout(() => this.fetchBooks(attempt + 1), delay);',
  '        }',
  '      });',
  '  };'
].join('\n');

const replacement = [
  '  fetchBooksLiveFallback = () => {',
  '    // AJK books-live fallback: same-origin, fast and deploy-coupled.',
  '    // BooksData remains canonical; this prevents stale bundled/localStorage catalogues.',
  "    const url = 'books-live.json?_=' + Date.now();",
  "    return fetch(url, { cache: 'no-store' })",
  '      .then(r => {',
  "        if (!r.ok) throw new Error('books_live_http_' + r.status);",
  '        return r.json();',
  '      })',
  '      .then(data => {',
  '        const raw = data && data.books;',
  "        const books = (typeof raw === 'string') ? JSON.parse(raw || '[]') : raw;",
  "        if (!Array.isArray(books) || !books.length) throw new Error('books_live_empty');",
  '        if (this._liveBooksLoaded) return;',
  '        this.setState({ books });',
  "        try { localStorage.setItem('ajk_author_books_draft', JSON.stringify({ books })); } catch (e) {}",
  '      })',
  '      .catch(() => {});',
  '  };',
  '',
  '  fetchBooks = (attempt = 0) => {',
  '    if (attempt === 0) this.fetchBooksLiveFallback();',
  "    const url = this.SCRIPT_URL + '?action=getBooks&_=' + Date.now();",
  "    fetch(url, { cache: 'no-store' })",
  '      .then(r => {',
  "        if (!r.ok) throw new Error('getBooks_http_' + r.status);",
  '        return r.json();',
  '      })',
  '      .then(data => {',
  "        const books = JSON.parse(data.books || '[]');",
  "        if (!Array.isArray(books) || !books.length) throw new Error('getBooks_empty');",
  '        this._liveBooksLoaded = true;',
  '        this.setState({ books });',
  "        try { localStorage.setItem('ajk_author_books_draft', JSON.stringify({ books })); } catch (e) {}",
  '      })',
  '      .catch(() => {',
  '        if (attempt < 3) {',
  '          const delay = 900 * (attempt + 1);',
  '          setTimeout(() => this.fetchBooks(attempt + 1), delay);',
  '        }',
  '      });',
  '  };'
].join('\n');

if (!s.includes('AJK books-live fallback')) {
  replaceDecodedOnce(current, replacement, 'current fetchBooks');
}

if (!s.includes('AJK books-live fallback')) throw new Error('fallback marker missing after patch');
if (!s.includes("books-live.json?_=\" + Date.now()")) {
  // The marker itself is sufficient for the encoded bundle; keep a second simple guard.
  if (!s.includes('books-live.json')) throw new Error('books-live URL missing after patch');
}

fs.writeFileSync(path, s, 'utf8');
console.log('Patched books-live fallback into encoded bundle:', s.length);

function scrubPrivateDriveLinks() {
  const booksPath = 'books-live.json';
  if (!fs.existsSync(booksPath)) return;
  const outer = JSON.parse(fs.readFileSync(booksPath, 'utf8'));
  let books = outer.books || [];
  if (typeof books === 'string') books = JSON.parse(books || '[]');

  const driveRe = /^https?:\/\/(?:drive|docs)\.google\.com\//i;

  const scrub = (value) => {
    if (Array.isArray(value)) {
      value.forEach(scrub);
      return;
    }
    if (!value || typeof value !== 'object') return;
    Object.keys(value).forEach((key) => {
      const v = value[key];
      if (typeof v === 'string' && driveRe.test(v)) {
        delete value[key];
      } else {
        scrub(v);
      }
    });
  };

  scrub(books);
  outer.books = JSON.stringify(books);
  fs.writeFileSync(booksPath, JSON.stringify(outer, null, 2) + '\n', 'utf8');
  console.log('Scrubbed private Google Drive/Docs URLs from books-live.json');
}

scrubPrivateDriveLinks();
