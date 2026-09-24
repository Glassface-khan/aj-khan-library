const fs = require('fs');

const path = 'index.html';
let s = fs.readFileSync(path, 'utf8');

const openTag = '<script type="__bundler/template">';
const closeTag = '</script>';
const tagPos = s.indexOf(openTag);
if (tagPos < 0) throw new Error('Bundler template open tag not found');
const encodedStart = tagPos + openTag.length;
const encodedEnd = s.indexOf(closeTag, encodedStart);
if (encodedEnd < 0) throw new Error('Bundler template close tag not found');

let decoded = JSON.parse(s.slice(encodedStart, encodedEnd));

const fetchBooksBlock = /\n  fetchBooks = \(attempt = 0\) => \{[\s\S]*?\n  \};/;
if (!fetchBooksBlock.test(decoded)) {
  if (decoded.includes('AJK books-live fallback')) {
    console.log('books-live fallback already installed');
    process.exit(0);
  }
  throw new Error('Current fetchBooks implementation not found');
}

const replacement = `
  fetchBooksLiveFallback = () => {
    // AJK books-live fallback: same-origin, fast and deploy-coupled.
    // BooksData remains the canonical live source; this file prevents stale
    // bundled/localStorage catalogues from surviving a cold Apps-Script start.
    const url = 'books-live.json?_=' + Date.now();
    return fetch(url, { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error('books_live_http_' + r.status);
        return r.json();
      })
      .then(data => {
        const raw = data && data.books;
        const books = (typeof raw === 'string') ? JSON.parse(raw || '[]') : raw;
        if (!Array.isArray(books) || !books.length) throw new Error('books_live_empty');
        // Never let the fallback overwrite fresher BooksData that already arrived.
        if (this._liveBooksLoaded) return;
        this.setState({ books });
        try { localStorage.setItem('ajk_author_books_draft', JSON.stringify({ books })); } catch (e) {}
      })
      .catch(() => {});
  };

  fetchBooks = (attempt = 0) => {
    if (attempt === 0) this.fetchBooksLiveFallback();

    // BooksData is still the canonical final source. Cache-bust and retry
    // transient Apps-Script cold starts; on success it replaces the fallback.
    const url = this.SCRIPT_URL + '?action=getBooks&_=' + Date.now();
    fetch(url, { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error('getBooks_http_' + r.status);
        return r.json();
      })
      .then(data => {
        const books = JSON.parse(data.books || '[]');
        if (!Array.isArray(books) || !books.length) throw new Error('getBooks_empty');
        this._liveBooksLoaded = true;
        this.setState({ books });
        try { localStorage.setItem('ajk_author_books_draft', JSON.stringify({ books })); } catch (e) {}
      })
      .catch(() => {
        if (attempt < 3) {
          const delay = 900 * (attempt + 1);
          setTimeout(() => this.fetchBooks(attempt + 1), delay);
        }
      });
  };`;

decoded = decoded.replace(fetchBooksBlock, replacement);
if (!decoded.includes('AJK books-live fallback')) throw new Error('fallback marker missing after patch');

const encoded = JSON.stringify(decoded);
s = s.slice(0, encodedStart) + encoded + s.slice(encodedEnd);

// Final structural validation: the bundled template must remain valid JSON.
const verifyStart = s.indexOf(openTag);
const verifyEncodedStart = verifyStart + openTag.length;
const verifyEncodedEnd = s.indexOf(closeTag, verifyEncodedStart);
JSON.parse(s.slice(verifyEncodedStart, verifyEncodedEnd));

fs.writeFileSync(path, s, 'utf8');
console.log('Installed books-live fallback and JSON-validated index.html:', s.length);
