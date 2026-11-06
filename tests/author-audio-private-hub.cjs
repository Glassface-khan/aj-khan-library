'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const s=fs.readFileSync('audio-library.js','utf8');
const a=s.indexOf('/* A. J. Khan · Admin-panel Audiobook Factory launcher */');
assert.ok(a>0,'existing owner-panel launcher missing');
const section=s.slice(a);
for(const name of ['ajk_author_admin','ajk_admin_token','Manage site'])assert.ok(section.includes(name));
for(const marker of ['data-ajk-audiobook-factory-launch','data-ajk-private-drive-player','data-ajk-private-factory2'])
 assert.ok(section.includes(marker));
assert.ok(section.includes('./audiobook-factory.html?v=20261006f'));
assert.ok(section.includes('https://ajk-audiobook-private.tail3f4289.ts.net:10001/drive-library'));
assert.ok(section.includes('https://ajk-audiobook-private.tail3f4289.ts.net/'));
assert.ok(section.includes("link.referrerPolicy = 'no-referrer'"));
assert.ok(section.includes("link.rel = 'noopener noreferrer'"));
const routes=section.match(/https:\/\/ajk-audiobook-private\.tail3f4289\.ts\.net[^'\s]*/g)||[];
assert.equal(routes.length,2,'only authorized private endpoints');
assert.ok(!routes.some(x=>/token|session|secret|email|userid/i.test(x)));
console.log('AUTHOR_AUDIO_HUB_PRIVATE_ADMIN_ONLY_LINKS=PASS');
