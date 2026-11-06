// These short-lived bearer tickets are scoped to one verified Drive edition/part.
// The signing key is server-only, 32 random bytes encoded as 64 hex digits.
const hash = /^[a-f0-9]{64}$/;
export function guestEnabled(entry, origin, key) {
  if (!entry || !hash.test(key || '')) return false;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:' || u.origin !== origin || u.hostname.endsWith('.ts.net')) return false;
  } catch { return false; }
  const parts = entry.parts ?? [entry.info];
  return Array.isArray(parts) && parts.length > 0 && parts.length <= 500 &&
    parts.every(p => hash.test(p.sha256));
}

export function guestAllowed(access, book) {
  return book.is_active === true && book.status === 'ready' && Boolean(access?.listenerId) &&
    (access.fullAudioAccess === true || access.audioAccess?.[book.title] === true);
}

export async function guestTicket(access, book, entry, number, origin, key) {
  if (!guestAllowed(access, book) || !guestEnabled(entry, origin, key)) throw Error('FORBIDDEN');
  const parts = entry.parts ?? [entry.info];
  if (!Number.isInteger(number) || number < 1 || number > parts.length) throw Error('FORBIDDEN');
  const expires = Math.floor(Date.now()/1000) + 300;
  const claims = ['guest-m4b-v1', entry.slug, number, parts[number-1].sha256, expires, crypto.randomUUID()];
  const encoded = btoa(JSON.stringify(claims)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  const secret = Uint8Array.from(key.match(/../g), pair => parseInt(pair,16));
  const signing = await crypto.subtle.importKey('raw',secret,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC',signing,new TextEncoder().encode(encoded)));
  const hex = Array.from(signature, x=>x.toString(16).padStart(2,'0')).join('');
  return {url:origin+'/guest-m4b/'+encoded+'.'+hex, expires};
}
