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

const originalDecoded = `  fetchBooks = () => {
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

const revalidatedDecoded = `  fetchBooks = (attempt = 0) => {
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

const safeDecoded = `  fetchBooks = (attempt = 0) => {
    // AJK canonical three-book fallback (23.09.2026).
    // The bundled seed may contain books deleted long ago. Before any network
    // request, reduce the visible catalogue to the current BooksData titles.
    // If the live request succeeds it replaces this fallback completely.
    const existing = Array.isArray(this.state.books) ? this.state.books : [];
    const byTitle = {};
    existing.forEach(b => { if (b && b.title) byTitle[b.title] = b; });

    const canonical = [
      {
        id: 'b_mub7ole69a6nsy',
        title: 'The Road it came by',
        kind: 'Literary Fiction · Muslim Fiction, Religious Fiction',
        hook: 'Across years of desert crossings, Maryam learns from her grandfather not only the stories of Jibril and the prophets, but the harder duty of knowing what can truthfully be carried forward—and what must be left unsaid.',
        status: 'Fertig',
        isFinished: true,
        wordCount: 83795,
        chapterCount: 43,
        translations: 'DE: fertig',
        epubUrl: 'https://drive.google.com/uc?export=download&id=1kMKAXtEa_50k3Y8-3BpucLmRKMM6GFh0',
        langs: { DE: { epubUrl: 'https://drive.google.com/uc?export=download&id=1kMKAXtEa_50k3Y8-3BpucLmRKMM6GFh0', wordCount: 83795, chapterCount: 43, hookSource: 'metadata-logline' } }
      },
      {
        id: 'cf51e477-1e07-4fe3-a21a-74423c94a942',
        title: \"The Mountain That Doesn't Answer\",
        kind: 'Literary Fiction / Adventure · Upmarket Fiction, Mountaineering Drama',
        hook: 'Omar Al-Badawi knows how to read a desert. Snow is another language. Seventeen years after his grandfather told him that the deepest silence might hold an answer, Omar leaves the Sinai for K2, the most unforgiving mountain of his life.',
        status: 'Fertig',
        isFinished: true,
        wordCount: 84869,
        chapterCount: 35,
        translations: 'EN: fertig',
        epubUrl: 'https://drive.google.com/uc?export=download&id=1UBMgqIUBIX82JCTWl65IJ9CSPyQHsA8p',
        coverUrl: 'https://lh3.googleusercontent.com/d/1OPl4X2bjQYJmW2rAeBIdGA11xmx_DrC2=w1000',
        langs: { EN: { epubUrl: 'https://drive.google.com/uc?export=download&id=1UBMgqIUBIX82JCTWl65IJ9CSPyQHsA8p', wordCount: 85836, chapterCount: 35, hookSource: 'file' } }
      },
      {
        id: 'b_the_weight_of_the_air_v1_4',
        title: 'The Weight of the Air',
        kind: 'Literary Speculative Fiction · Climate Fiction, Near-Future Science Fiction',
        hook: 'Karim al-Hassan once helped build the system that made clean air possible. Then he discovered where its waste went—and let the world believe he had died.',
        status: 'Fertig',
        isFinished: true,
        wordCount: 102522,
        chapterCount: 36,
        translations: 'EN: fertig',
        epubUrl: 'https://drive.google.com/uc?export=download&id=1FCYGHGNYc6jYS1zGll2jJQDwIJWV-1OS',
        coverUrl: 'https://lh3.googleusercontent.com/d/1hie0bB5v25CXaEzBapjS3n6tbsKMgvuA=w1000',
        langs: { EN: { epubUrl: 'https://drive.google.com/uc?export=download&id=1FCYGHGNYc6jYS1zGll2jJQDwIJWV-1OS', wordCount: 103318, chapterCount: 36, hookSource: 'file' } }
      }
    ];

    const fallback = canonical.map(b => Object.assign({}, byTitle[b.title] || {}, b));
    this.setState({ books: fallback });
    try { localStorage.setItem('ajk_author_books_draft', JSON.stringify({ books: fallback })); } catch (e) {}

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
          const delay = 900 * (attempt + 1);
          setTimeout(() => this.fetchBooks(attempt + 1), delay);
        }
      });
  };`;

if (!s.includes('AJK canonical three-book fallback')) {
  const revalidatedEncoded = JSON.stringify(revalidatedDecoded).slice(1, -1);
  const originalEncoded = JSON.stringify(originalDecoded).slice(1, -1);
  if (s.includes(revalidatedEncoded)) {
    replaceDecodedOnce(revalidatedDecoded, safeDecoded, 'revalidated fetchBooks');
  } else if (s.includes(originalEncoded)) {
    replaceDecodedOnce(originalDecoded, safeDecoded, 'original fetchBooks');
  } else {
    throw new Error('No known fetchBooks implementation found');
  }
}

if (!s.includes('AJK canonical three-book fallback')) throw new Error('safe fallback marker missing');

const templateMatch = s.match(/<script type=\"__bundler\\/template\">([\\s\\S]*?)<\\/script>/);
if (!templateMatch) throw new Error('Bundler template not found');
JSON.parse(templateMatch[1]);

fs.writeFileSync(path, s, 'utf8');
console.log('Patched current three-book fallback and JSON-validated index.html:', s.length);
