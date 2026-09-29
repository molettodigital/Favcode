// Utilidades do Worker: respostas JSON, escape de HTML e tokens assinados (HMAC-SHA256).

export const DAY = 24 * 60 * 60 * 1000;

export const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/** Texto com quebras de linha vira parágrafos HTML (já escapados). */
export function paragraphs(text) {
  return String(text ?? '')
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((p) => escapeHtml(p.trim()).replace(/\n/g, '<br>'));
}

export function base64urlEncode(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const encoder = new TextEncoder();
const hmacKey = (secret) =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

/** Token "payload.assinatura": o payload é JSON em base64url, assinado com HMAC-SHA256. */
export async function signToken(secret, payload) {
  const body = base64urlEncode(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${base64urlEncode(new Uint8Array(sig))}`;
}

/** Confere assinatura (comparação em tempo constante), finalidade e validade. Devolve o payload ou null. */
export async function verifyToken(secret, token, purpose, now = Date.now()) {
  if (!secret || typeof token !== 'string' || token.length > 2048) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), base64urlDecode(sig), encoder.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(body)));
    if (payload.p !== purpose || !(payload.x > now)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Lê um cookie do pedido. */
export function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
