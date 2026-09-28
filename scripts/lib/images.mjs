// Imagem de capa para as manchetes que chegam sem foto no feed: busca a og:image da matéria.
// O resultado (inclusive "não tem") fica em data/images.json para não repetir a busca.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { decodeEntities, parseAttrs } from './feed-parser.mjs';

const CONCURRENCY = 8;
const MAX_BYTES = 400_000; // as meta tags ficam no <head>; não precisa baixar a página toda
const USER_AGENT = 'Mozilla/5.0 (compatible; FavCodeRadar/1.0; +https://github.com/molettodigital/Favcode)';

// Imagens genéricas (logo do site, avatar) não servem de capa.
const GENERIC_IMAGE = /(logo|favicon|avatar|placeholder|default[-_]?(og|share|image)|sprite|blank)\b/i;
// Nada é carregado do Google, nem imagem hospedada lá.
const GOOGLE_HOST = /(^|\.)(google|googleusercontent|gstatic|ggpht|googleapis|blogger)\.[a-z.]+$/i;

/** Aceita só imagem https, fora dos domínios do Google e que não pareça logo. */
export function usableImage(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'http:') u.protocol = 'https:';
    if (u.protocol !== 'https:') return '';
    if (GOOGLE_HOST.test(u.hostname)) return '';
    if (GENERIC_IMAGE.test(u.pathname)) return '';
    return u.href;
  } catch {
    return '';
  }
}

/** og:image (ou twitter:image) do HTML de uma matéria, já absoluta. */
export function extractShareImage(html, pageUrl) {
  const head = html.slice(0, MAX_BYTES).split(/<\/head>/i)[0];
  const wanted = ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'];
  const found = {};
  for (const m of head.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = parseAttrs(m[1]);
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (wanted.includes(key) && attrs.content && !found[key]) found[key] = decodeEntities(attrs.content.trim());
  }
  for (const key of wanted) {
    if (!found[key]) continue;
    try {
      const url = usableImage(new URL(found[key], pageUrl).href);
      if (url) return url;
    } catch {
      /* URL inválida: tenta a próxima */
    }
  }
  return '';
}

async function fetchHead(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok || !(res.headers.get('content-type') || '').includes('html')) return '';
  // Lê só o começo da página.
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (Buffer.concat(chunks).toString('latin1').match(/<\/head>/i)) break;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Completa `image` das manchetes sem foto. Muda os itens no lugar.
 * @returns {Promise<{ cached: number, found: number, missing: number }>}
 */
export async function enrichImages(items, { cacheFile, fetchPage = fetchHead, log = () => {} }) {
  let cache = {};
  try {
    cache = JSON.parse(await readFile(cacheFile, 'utf8')).entries || {};
  } catch {
    /* primeira vez */
  }
  const used = {};
  const stats = { cached: 0, found: 0, missing: 0 };
  const pending = [];

  for (const item of items) {
    item.image = usableImage(item.image);
    if (item.image) continue;
    if (Object.hasOwn(cache, item.url)) {
      used[item.url] = cache[item.url];
      item.image = cache[item.url];
      stats.cached++;
    } else {
      pending.push(item);
    }
  }

  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const item = pending[next++];
      let image = '';
      try {
        image = extractShareImage(await fetchPage(item.url), item.url);
      } catch {
        /* site fora do ar ou bloqueando: fica sem imagem */
      }
      used[item.url] = image;
      item.image = image;
      if (image) stats.found++;
      else stats.missing++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));

  const sorted = Object.fromEntries(Object.entries(used).sort(([a], [b]) => a.localeCompare(b)));
  await mkdir(path.dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, `${JSON.stringify({ version: 1, entries: sorted }, null, 1)}\n`);
  if (pending.length) log(`Imagens: ${stats.found} encontradas nas matérias, ${stats.missing} sem imagem (capa na cor da editoria).`);
  return stats;
}
