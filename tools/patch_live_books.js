const fs = require('fs');

const path = 'index.html';
let s = fs.readFileSync(path, 'utf8');

const oldDecoded = `  fetchBooks = () => {
    fetch(this.SCRIPT_URL + '?action=getBooks')
      .then(r => r.json())
      .then(data => {
        const books = JSON.parse(data.books || '[]');
        if (Array.isArray(books) && books.length) {
          this.setState({ books });
          localStorage.setItem('ajk_author_books_draft', JSON.stringify({ books }));
        }
      })
      .catch(() => {});
  };`;

const newDecoded = `  fetchBooks = (attempt = 0) => {
    // AJK live book revalidation: never trust a stale browser/PWA draft as
    // the final source. Always request the current BooksData snapshot with a
    // cache-busting query and retry short-lived Apps-Script/network failures.
    const url = this.SCRIPT_URL + '?action=getBooks&_=' + Date.now();
    fetch(url, { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error('getBooks_http_' + r.status);
        return r.json();
      })
      .then(data => {
        const books = JSON.parse(data.books || '[]');
        if (!Array.isArray(books) || !books.length) throw new Error('getBooks_empty');
        this.setState({ books });
        try { localStorage.setItem('ajk_author_books_draft', JSON.stringify({ books })); } catch (e) {}
      })
      .catch(() => {
        if (attempt < 3) {
          const delay = 800 * (attempt + 1);
          setTimeout(() => this.fetchBooks(attempt + 1), delay);
        }
      });
  };`;

if (!s.includes('AJK live book revalidation')) {
  const oldEncoded = JSON.stringify(oldDecoded).slice(1, -1);
  const newEncoded = JSON.stringify(newDecoded).slice(1, -1);
  const first = s.indexOf(oldEncoded);
  const second = first < 0 ? -1 : s.indexOf(oldEncoded, first + oldEncoded.length);
  if (first < 0) throw new Error('fetchBooks marker not found');
  if (second >= 0) throw new Error('fetchBooks marker occurs more than once');
  s = s.slice(0, first) + newEncoded + s.slice(first + oldEncoded.length);
}

if (!s.includes('AJK live book revalidation')) throw new Error('patch marker missing');

const templateMatch = s.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/);
if (!templateMatch) throw new Error('Bundler template not found');
JSON.parse(templateMatch[1]);

fs.writeFileSync(path, s, 'utf8');
console.log('Patched live book refresh and JSON-validated index.html:', s.length);
