// Audiobook Factory 2.0 — dependency-free WebCrypto ticket primitives.
// No login codes, secrets or audio contents are stored here.
const enc = new TextEncoder();
function b64u(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(s) {
  if (!/^[\w-]+$/.test(s)) throw new Error("invalid_token");
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(norm + "=".repeat((4 - norm.length % 4) % 4));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function secureEquals(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
async function key(secret) {
  if (typeof secret !== "string" || secret.length < 32)
    throw new Error("server_ticket_secret_missing_or_weak");
  return crypto.subtle.importKey("raw", enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
export async function signTicket(payload, secret, now = Math.floor(Date.now() / 1000)) {
  const expires = Number(payload.exp);
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + 3600) {
    throw new Error("invalid_ticket_lifetime");
  }
  const body = b64u(enc.encode(JSON.stringify({v:1,ch:payload.ch,book:payload.book,
    listener:payload.listener,exp:expires})));
  const signature = b64u(new Uint8Array(await crypto.subtle.sign("HMAC",
      await key(secret), enc.encode(body))));
  return body + "." + signature;
}
export async function verifyTicket(ticket, secret, now = Math.floor(Date.now() / 1000)) {
  try {
    if (typeof ticket !== "string" || ticket.length > 1500) return null;
    const pieces = ticket.split(".");
    if (pieces.length !== 2) return null;
    const [body, signature] = pieces;
    const expected = new Uint8Array(await crypto.subtle.sign("HMAC",
        await key(secret), enc.encode(body)));
    if (!secureEquals(expected, unb64u(signature))) return null;
    const parsed = JSON.parse(new TextDecoder().decode(unb64u(body)));
    if (parsed.v !== 1 || typeof parsed.ch !== "string" ||
        typeof parsed.book !== "string" || typeof parsed.listener !== "string" ||
        !Number.isSafeInteger(parsed.exp) || parsed.exp <= now ||
        parsed.exp > now + 3600) return null;
    return parsed;
  } catch { return null; }
}
export function safeName(value) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{1,90}$/.test(value);
}
export function isUuid(value) {
  return typeof value === "string" &&
   /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
