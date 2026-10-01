const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('apps-script/Code.gs', 'utf8');

function iterator(items) {
  let i = 0;
  return { hasNext: () => i < items.length, next: () => items[i++] };
}

function loadContext(overrides = {}) {
  const context = {
    console,
    Logger: { log() {} },
    Utilities: {
      getUuid: () => 'uuid-test',
      base64Encode: () => '',
      base64Decode: () => [],
      newBlob: () => ({})
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => '',
        setProperty: () => {},
        getProperties: () => ({}),
        deleteProperty: () => {}
      })
    },
    DriveApp: {
      getFolderById() { throw new Error('folder not mocked'); },
      getFileById() { throw new Error('file not mocked'); },
      Access: { PRIVATE: 'PRIVATE' },
      Permission: { VIEW: 'VIEW' }
    },
    Drive: {
      Permissions: { list() { return { permissions: [] }; }, remove() {} },
      Files: { copy() { return { id: 'tmp' }; } }
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: () => null,
        insertSheet: () => ({})
      })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: () => ({ setMimeType() { return this; } })
    },
    MimeType: {
      PDF: 'application/pdf',
      GOOGLE_DOCS: 'application/vnd.google-apps.document',
      GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet',
      GOOGLE_SLIDES: 'application/vnd.google-apps.presentation'
    },
    DocumentApp: {},
    LockService: {},
    MailApp: {},
    Session: {},
    UrlFetchApp: {},
    ...overrides
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'Code.gs' });
  return context;
}

function call(ctx, expression) {
  return vm.runInContext(expression, ctx);
}

// A. Legacy private-file bypass must stay gone.
assert.strictEqual((source.match(/getEpubData/g) || []).length, 0, 'legacy getEpubData route/reference returned');

// B. Public catalogue sanitization must strip Drive locations for private assets.
{
  const ctx = loadContext();
  ctx.__book = [{
    id: 'book-1',
    title: 'Book One',
    epubUrl: 'https://drive.google.com/file/d/AAAAAAAAAAAAAAAAAAAAAAAAA/view',
    manuscriptDocUrl: 'https://docs.google.com/document/d/BBBBBBBBBBBBBBBBBBBBBBBBB/edit',
    bgUrl: 'drive-private://folder/CCCCCCCCCCCCCCCCCCCCCCCCC',
    videoUrl: 'https://drive.google.com/file/d/DDDDDDDDDDDDDDDDDDDDDDDDD/view',
    altUrl: 'https://drive.google.com/drive/folders/EEEEEEEEEEEEEEEEEEEEEEEEE',
    altCovers: ['drive-private://file/FFFFFFFFFFFFFFFFFFFFFFFFF'],
    langs: {
      EN: {
        epubUrl: 'https://drive.google.com/file/d/GGGGGGGGGGGGGGGGGGGGGGGGG/view',
        manuscriptDocUrl: 'https://docs.google.com/document/d/HHHHHHHHHHHHHHHHHHHHHHHHH/edit'
      }
    }
  }];
  const sanitized = call(ctx, 'sanitizeBooksForPublic_(__book)');
  const text = JSON.stringify(sanitized);
  assert(!/drive\.google\.com|docs\.google\.com|drive-private:\/\//i.test(text), 'public catalogue leaked a Drive location');
  assert.strictEqual(sanitized[0].altCovers.length, 0, 'public catalogue exposed alt-cover refs');
}

// C. Permission deletion must work with Drive API v3 response shape.
{
  const removed = [];
  const permissions = [
    { id: 'p-anyone', type: 'anyone', role: 'reader' },
    { id: 'p-user', type: 'user', role: 'owner' },
    { id: 'p-domain', type: 'domain', role: 'reader' }
  ];
  const ctx = loadContext({
    Drive: {
      Permissions: {
        list() { return { permissions: permissions.filter(p => !removed.includes(p.id)) }; },
        remove(fileId, permissionId) { removed.push(permissionId); }
      },
      Files: { copy() { return { id: 'tmp' }; } }
    }
  });
  const count = call(ctx, "removeGeneralDrivePermissions_('FILE_V3_1234567890123456789012345')");
  assert.strictEqual(count, 2);
  assert.deepStrictEqual(removed.sort(), ['p-anyone','p-domain']);
  call(ctx, "assertNoGeneralDrivePermissions_('FILE_V3_1234567890123456789012345')");
}

// D. Permission deletion must also work with Drive API v2 response shape.
{
  const removed = [];
  const permissions = [
    { id: 'p-anyone', type: 'anyone', role: 'reader' },
    { id: 'p-user', type: 'user', role: 'owner' }
  ];
  const ctx = loadContext({
    Drive: {
      Permissions: {
        list() { return { items: permissions.filter(p => !removed.includes(p.id)) }; },
        remove(fileId, permissionId) { removed.push(permissionId); }
      },
      Files: { copy() { return { id: 'tmp' }; } }
    }
  });
  const count = call(ctx, "removeGeneralDrivePermissions_('FILE_V2_1234567890123456789012345')");
  assert.strictEqual(count, 1);
  assert.deepStrictEqual(removed, ['p-anyone']);
  call(ctx, "assertNoGeneralDrivePermissions_('FILE_V2_1234567890123456789012345')");
}

// E. Exact BooksData private refs are hardened directly; public main cover is excluded.
{
  const ids = {
    epub: 'EPUB_1234567890123456789012345',
    manuscript: 'MANU_1234567890123456789012345',
    background: 'BACK_1234567890123456789012345',
    video: 'VIDEO_123456789012345678901234',
    altFolder: 'ALTF_1234567890123456789012345',
    altFile: 'ALTI_1234567890123456789012345',
    langEpub: 'LEPUB_123456789012345678901234',
    cover: 'COVER_12345678901234567890123'
  };

  const permissionsById = {};
  Object.values(ids).forEach(id => {
    permissionsById[id] = [
      { id: 'anyone-' + id, type: 'anyone', role: 'reader' },
      { id: 'owner-' + id, type: 'user', role: 'owner' }
    ];
  });

  const removed = [];
  const makeFile = id => ({ getId: () => id });
  const makeFolder = id => ({
    getId: () => id,
    getFiles: () => iterator([]),
    getFolders: () => iterator([])
  });

  const folderIds = new Set([ids.background, ids.altFolder]);
  const ctx = loadContext({
    DriveApp: {
      getFolderById(id) {
        if (!folderIds.has(id)) throw new Error('not folder');
        return makeFolder(id);
      },
      getFileById(id) {
        if (!permissionsById[id]) throw new Error('unknown file ' + id);
        return makeFile(id);
      },
      Access: { PRIVATE: 'PRIVATE' },
      Permission: { VIEW: 'VIEW' }
    },
    Drive: {
      Permissions: {
        list(fileId) {
          return { permissions: permissionsById[fileId].filter(p => !removed.includes(p.id)) };
        },
        remove(fileId, permissionId) { removed.push(permissionId); }
      },
      Files: { copy() { return { id: 'tmp' }; } }
    }
  });

  ctx.__books = [{
    title: 'Book',
    coverUrl: 'https://drive.google.com/file/d/' + ids.cover + '/view',
    epubUrl: 'drive-private://file/' + ids.epub,
    manuscriptDocUrl: 'drive-private://file/' + ids.manuscript,
    bgUrl: 'drive-private://folder/' + ids.background,
    videoUrl: 'drive-private://file/' + ids.video,
    altUrl: 'drive-private://folder/' + ids.altFolder,
    altCovers: ['drive-private://file/' + ids.altFile],
    langs: { EN: { epubUrl: 'drive-private://file/' + ids.langEpub } }
  }];

  const result = call(ctx, 'hardenReferencedPrivateAssets_(__books)');
  assert.strictEqual(result.checked, 7);
  assert.strictEqual(result.removed, 7);
  assert(!removed.includes('anyone-' + ids.cover), 'main cover must remain outside private hardening');
}

console.log('SECURITY_LAB_TESTS=PASS');
