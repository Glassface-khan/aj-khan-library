const fs = require('fs');

const path = 'index.html';
let s = fs.readFileSync(path, 'utf8');

// Proven extractor for this repository's bundled index format.
const templateMatch = s.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/);
if (!templateMatch) throw new Error('Bundler template not found');

let decoded = JSON.parse(templateMatch[1]);

const fetchBooksBlock = /\n  fetchBooks = \(attempt = 0\) => \{[\s\S]*?\n  \};/;
if (!fetchBooksBlock.test(decoded)) {
  if (decoded.includes('AJK books-live fallback')) {
    console.log('books-live fallback already installed');
    process.exit(0);
  }
  throw new Error('Current fetchBooks implementation not found');
}

const replacement = [
  '  fetchBooksLiveFallback = () => {',
  '    // AJK books-live fallback: same-origin, fast and deploy-coupled.',
  '    // BooksData remains canonical; this prevents stale bundled/localStorage catalogues.',
  "    const url = 'books-live.json?_=' + Date.now();",
  "    return fetch(url, { cache: 'no-store' })",
  "      .then(r => {",
  "        if (!r.ok) throw new Error('books_live_http_' + r.status);",
  "        return r.json();",
  "      })",
  "      .then(data => {",
  "        const raw = data && data.books;",
  "        const books = (typeof raw === 'string') ? JSON.parse(raw || '[]') : raw;",
  "        if (!Array.isArray(books) || !books.length) throw new Error('books_live_empty');",
  "        if (this._liveBooksLoaded) return;",
  "        this.setState({ books });",
  "        try { localStorage.setItem('ajk_author_books_draft', JSON.stringify({ books })); } catch (e) {}",
  "      })",
  "      .catch(() => {});",
  "  };",
  "",
  "  fetchBooks = (attempt = 0) => {",
  "    if (attempt === 0) this.fetchBooksLiveFallback();",
  "    const url = this.SCRIPT_URL + '?action=getBooks&_=' + Date.now();",
  "    fetch(url, { cache: 'no-store' })",
  "      .then(r => {",
  "        if (!r.ok) throw new Error('getBooks_http_' + r.status);",
  "        return r.json();",
  "      })",
  "      .then(data => {",
  "        const books = JSON.parse(data.books || '[]');",
  "        if (!Array.isArray(books) || !books.length) throw new Error('getBooks_empty');",
  "        this._liveBooksLoaded = true;",
  "        this.setState({ books });",
  "        try { localStorage.setItem('ajk_author_books_draft', JSON.stringify({ books })); } catch (e) {}",
  "      })",
  "      .catch(() => {",
  "        if (attempt < 3) {",
  "          const delay = 900 * (attempt + 1);",
  "          setTimeout(() => this.fetchBooks(attempt + 1), delay);",
  "        }",
  "      });",
  "  };"
].join('\\n');

decoded = decoded.replace(fetchBooksBlock, replacement);
if (!decoded.includes('AJK books-live fallback')) throw new Error('fallback marker missing after patch');

const newTag = '<script type="__bundler/template">' + JSON.stringify(decoded) + '</script>';
s = s.slice(0, templateMatch.index) + newTag + s.slice(templateMatch.index + templateMatch[0].length);

const verify = s.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/);
if (!verify) throw new Error('Bundler template missing after patch');
JSON.parse(verify[1]);

fs.writeFileSync(path, s, 'utf8');
console.log('Installed books-live fallback and JSON-validated index.html:', s.length);