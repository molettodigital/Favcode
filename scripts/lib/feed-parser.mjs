// Leitor de RSS 2.0, RSS 1.0 (RDF) e Atom sem dependências.
// Tolerante a feeds malformados: extrai o que der e ignora o resto.

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', laquo: '«', raquo: '»',
  copy: '©', reg: '®', trade: '™', middot: '·', bull: '•', deg: '°', euro: '€', pound: '£', cent: '¢',
  ordf: 'ª', ordm: 'º', iexcl: '¡', iquest: '¿', times: '×', divide: '÷', prime: '′', szlig: 'ß',
  aelig: 'æ', AElig: 'Æ', oslash: 'ø', Oslash: 'Ø', aring: 'å', Aring: 'Å', eth: 'ð', thorn: 'þ',
  zwj: '', zwnj: '', shy: '', thinsp: ' ', ensp: ' ', emsp: ' ',
};

const COMBINING = { acute: '́', grave: '̀', circ: '̂', tilde: '̃', uml: '̈', cedil: '̧' };

function namedEntity(name) {
  if (Object.hasOwn(NAMED_ENTITIES, name)) return NAMED_ENTITIES[name];
  const m = /^([a-zA-Z])(acute|grave|circ|tilde|uml|cedil)$/.exec(name);
  if (m) return (m[1] + COMBINING[m[2]]).normalize('NFC');
  return null;
}

function decodeOnce(str) {
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      try {
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    }
    const value = namedEntity(body);
    return value === null ? whole : value;
  });
}

/** Decodifica entidades HTML/XML, inclusive as duplamente codificadas (&amp;#8217;). */
export function decodeEntities(str) {
  let out = decodeOnce(str);
  if (/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/i.test(out)) out = decodeOnce(out);
  return out;
}

const unwrapCdata = (str) => str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

const BLOCK_TAG = /<\/?(p|div|li|ul|ol|h[1-6]|br|hr|blockquote|section|article|header|footer|table|tr|td|th)\b[^>]*>/gi;

function stripTags(html) {
  return html
    .replace(/<(script|style|figure|figcaption|iframe|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(BLOCK_TAG, ' ')
    .replace(/<[^>]+>/g, '');
}

const collapse = (str) => str.replace(/[\s ]+/g, ' ').trim();

/** Texto limpo de um título: sem tags cruas, entidades decodificadas. */
export function cleanTitle(raw) {
  if (!raw) return '';
  return collapse(decodeEntities(stripTags(unwrapCdata(raw))));
}

/** Texto limpo de um resumo, que pode vir como HTML cru ou HTML escapado. */
export function cleanSummary(raw) {
  if (!raw) return '';
  let text = decodeEntities(stripTags(unwrapCdata(raw)));
  if (/<[a-z/][^>]*>/i.test(text)) text = decodeEntities(stripTags(text));
  text = collapse(text)
    .replace(/\s*(The post|O post)\s.+?\s(appeared first on|apareceu primeiro em)\s.+$/i, '')
    .replace(/\s*(Continue reading|Continuar lendo|Leia mais|Read more|Saiba mais)\b.*$/i, '')
    .replace(/\s*\[(…|\.\.\.|&hellip;)\]\s*$/, '…')
    .trim();
  return text;
}

export function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut.slice(0, max)).replace(/[\s,.;:–—-]+$/, '')}…`;
}

function escapeRe(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Conteúdo bruto da primeira tag encontrada entre `names` (ex.: 'pubDate', 'dc:date'). */
function getTag(xml, names) {
  for (const name of names) {
    const re = new RegExp(`<${escapeRe(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRe(name)}>`, 'i');
    const m = re.exec(xml);
    if (m && m[1].trim()) return m[1];
  }
  return '';
}

function getAllTags(xml, name) {
  const re = new RegExp(`<${escapeRe(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRe(name)}>`, 'gi');
  return [...xml.matchAll(re)].map((m) => m[1]);
}

/** Todas as tags de abertura/autofechadas `name` com seus atributos. */
function getTagAttrs(xml, name) {
  const re = new RegExp(`<${escapeRe(name)}\\b([^>]*?)/?>`, 'gi');
  return [...xml.matchAll(re)].map((m) => parseAttrs(m[1]));
}

function parseAttrs(str) {
  const attrs = {};
  for (const m of str.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? '');
  }
  return attrs;
}

const PT_MONTHS = { jan: 'Jan', fev: 'Feb', mar: 'Mar', abr: 'Apr', mai: 'May', jun: 'Jun', jul: 'Jul', ago: 'Aug', set: 'Sep', out: 'Oct', nov: 'Nov', dez: 'Dec' };

/** Converte datas de feed (RFC 822, ISO 8601 e variações em português) para epoch ms. */
export function parseDate(raw) {
  if (!raw) return null;
  let str = collapse(decodeEntities(unwrapCdata(raw)));
  if (!str) return null;
  let ms = Date.parse(str);
  if (Number.isNaN(ms)) {
    str = str
      .replace(/^(seg|ter|qua|qui|sex|s[aá]b|dom)[a-zç-]*,?\s*/i, '')
      .replace(/\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\.?\b/i, (m, mon) => PT_MONTHS[mon.toLowerCase()]);
    // "2026-09-28 10:00:00" sem "T"
    str = str.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/, '$1T$2');
    ms = Date.parse(str);
  }
  return Number.isNaN(ms) ? null : ms;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;
const TRACKING_IMAGE = /(feedburner|feeds\.feedblitz|pixel|gravatar\.com|\/emoji\/|wp-includes\/images|stats\.wordpress|doubleclick|\bspacer\b|1x1)/i;

function absoluteUrl(url, base) {
  if (!url) return '';
  try {
    const u = new URL(url.trim(), base || undefined);
    if (u.protocol === 'http:') u.protocol = 'https:';
    if (u.protocol !== 'https:') return '';
    return u.href;
  } catch {
    return '';
  }
}

function pickImage(itemXml, link) {
  const candidates = [];

  for (const attrs of getTagAttrs(itemXml, 'media:content')) {
    const isImage = attrs.medium === 'image' || (attrs.type || '').startsWith('image/') || (!attrs.medium && !attrs.type && IMAGE_EXT.test(attrs.url || ''));
    if (attrs.url && isImage) candidates.push({ url: attrs.url, width: Number(attrs.width) || 0 });
  }
  for (const attrs of getTagAttrs(itemXml, 'media:thumbnail')) {
    if (attrs.url) candidates.push({ url: attrs.url, width: Number(attrs.width) || 0 });
  }
  for (const attrs of getTagAttrs(itemXml, 'enclosure')) {
    if (attrs.url && ((attrs.type || '').startsWith('image/') || IMAGE_EXT.test(attrs.url))) candidates.push({ url: attrs.url, width: 0 });
  }
  const imageTag = getTag(itemXml, ['image']);
  if (imageTag) {
    const inner = collapse(unwrapCdata(getTag(imageTag, ['url']) || imageTag));
    if (/^https?:\/\//i.test(inner)) candidates.push({ url: decodeEntities(inner), width: 0 });
  }

  const usable = candidates.filter((c) => c.url && !TRACKING_IMAGE.test(c.url));
  if (usable.length) {
    usable.sort((a, b) => b.width - a.width);
    const best = absoluteUrl(usable[0].url, link);
    if (best) return best;
  }

  // Primeira <img> do conteúdo (cru, em CDATA ou escapado).
  for (const raw of [getTag(itemXml, ['content:encoded']), getTag(itemXml, ['description', 'summary', 'content'])]) {
    if (!raw) continue;
    let html = unwrapCdata(raw);
    if (!/<img\b/i.test(html)) html = decodeEntities(html);
    for (const m of html.matchAll(/<img\b([^>]*)>/gi)) {
      const attrs = parseAttrs(m[1]);
      const src = attrs.src || attrs['data-src'] || attrs['data-lazy-src'] || '';
      if (!src || TRACKING_IMAGE.test(src)) continue;
      if (attrs.width === '1' || attrs.height === '1') continue;
      const url = absoluteUrl(src, link);
      if (url) return url;
    }
  }
  return '';
}

function pickLink(itemXml, isAtom) {
  const orig = getTag(itemXml, ['feedburner:origLink']);
  if (orig) return collapse(decodeEntities(unwrapCdata(orig)));

  if (isAtom) {
    const links = getTagAttrs(itemXml, 'link').filter((a) => a.href);
    const alt = links.find((a) => (!a.rel || a.rel === 'alternate') && (!a.type || a.type.includes('html'))) || links.find((a) => !a.rel || a.rel === 'alternate') || links[0];
    if (alt) return alt.href;
  }

  const text = collapse(decodeEntities(unwrapCdata(getTag(itemXml, ['link']))));
  if (/^https?:\/\//i.test(text)) return text;

  // Alguns feeds RSS usam <link href="..."/> no estilo Atom.
  const hrefLink = getTagAttrs(itemXml, 'link').find((a) => a.href);
  if (hrefLink) return hrefLink.href;

  const guid = collapse(decodeEntities(unwrapCdata(getTag(itemXml, ['guid', 'id']))));
  if (/^https?:\/\//i.test(guid)) return guid;
  return '';
}

/**
 * Lê um feed e devolve as entradas normalizadas.
 * @returns {{ title: string, items: Array<{ title, url, date, summary, image, categories }> }}
 */
export function parseFeed(xml, { baseUrl = '' } = {}) {
  const src = String(xml || '').replace(/^﻿/, '');
  const isAtom = /<feed\b[^>]*>/i.test(src) && /<entry\b/i.test(src);
  const channelTitle = cleanTitle(getTag(src.replace(/<(item|entry)\b[\s\S]*$/i, ''), ['title']));

  const blocks = isAtom
    ? [...src.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((m) => m[1])
    : [...src.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);

  const items = [];
  for (const block of blocks) {
    const title = cleanTitle(getTag(block, ['title']));
    const url = absoluteUrl(pickLink(block, isAtom), baseUrl);
    if (!title || !url) continue;

    const date = parseDate(getTag(block, ['pubDate', 'dc:date', 'published', 'updated', 'a10:updated', 'date', 'dc:created']));
    const summary = cleanSummary(getTag(block, ['description', 'summary', 'media:description', 'content:encoded', 'content']));
    const categories = [
      ...getAllTags(block, 'category').map(cleanTitle),
      ...getTagAttrs(block, 'category').map((a) => a.term || a.label || ''),
    ].filter(Boolean);

    items.push({ title, url, date, summary, image: pickImage(block, url), categories });
  }

  return { title: channelTitle, items };
}
