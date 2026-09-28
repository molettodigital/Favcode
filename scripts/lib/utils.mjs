import { createHash } from 'node:crypto';

const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|_hsenc|_hsmi|ref|ref_src|source|cmpid|ncid|sr_share|rss|feed)$/i;

/** URL sem parâmetros de rastreamento, sem âncora e sem barra final. */
export function cleanUrl(url) {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    let href = u.href;
    if (u.pathname.length > 1 && href.endsWith('/') && !u.search) href = href.slice(0, -1);
    return href;
  } catch {
    return url;
  }
}

/** Chave de comparação para títulos repetidos entre fontes. */
export function normalizeTitle(title) {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function hashId(input) {
  return createHash('sha1').update(input).digest('hex').slice(0, 10);
}

export function slugify(text) {
  return normalizeTitle(text).replace(/\s+/g, '-');
}

/** Primeiro padrão da lista que casa com o texto, ou null. */
export function matchesAny(patterns, text) {
  for (const re of patterns) {
    re.lastIndex = 0;
    if (re.test(text)) return re;
  }
  return null;
}

/** Executa `worker` em `list` com no máximo `limit` tarefas simultâneas, preservando a ordem. */
export async function mapPool(list, limit, worker) {
  const results = new Array(list.length);
  let next = 0;
  async function run() {
    while (next < list.length) {
      const index = next++;
      results[index] = await worker(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, run));
  return results;
}
