#!/usr/bin/env node
// Monta o Radar FavCode: busca os feeds, filtra, organiza por editoria, calcula o "Em alta"
// e grava tudo dentro de index.html (um único arquivo, pronto para publicar).
//
// Uso:
//   node scripts/build.mjs                    busca os feeds na internet
//   RADAR_FIXTURES=pasta node scripts/build.mjs  lê <pasta>/<slug-da-fonte>-<editoria>.xml (testes offline)
//   node scripts/build.mjs --template-only    reaplica o template às manchetes do index.html atual (sem internet)
//   SITE_URL=https://radar.favcode.com.br     endereço público, usado nas tags de compartilhamento

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Anthropic from '@anthropic-ai/sdk';
import { transform } from 'esbuild';

import * as config from '../config/radar.config.mjs';
import { parseFeed, truncate } from './lib/feed-parser.mjs';
import { DEFAULT_MODEL, translateItems, workerTranslator } from './lib/translate.mjs';
import { enrichImages } from './lib/images.mjs';
import { computeTrends } from './lib/trends.mjs';
import { cleanUrl, hashId, mapPool, matchesAny, normalizeTitle, slugify } from './lib/utils.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(ROOT, 'src', 'index.template.html');
const OUTPUT = path.resolve(ROOT, process.env.RADAR_OUTPUT || 'index.html');
const FIXTURES = process.env.RADAR_FIXTURES ? path.resolve(process.env.RADAR_FIXTURES) : '';
const SITE_URL = (process.env.SITE_URL || config.site.url || '').replace(/\/+$/, '');
const TRANSLATIONS = path.join(ROOT, 'data', 'translations.json');
const IMAGES = path.join(ROOT, 'data', 'images.json');
const USER_AGENT = 'Mozilla/5.0 (compatible; FavCodeRadar/1.0; +https://github.com/molettodigital/Favcode)';
const DAY = 86_400_000;

const feedKey = (feed) => `${slugify(feed.name)}-${feed.column}`;

async function fetchFeed(feed) {
  if (FIXTURES) {
    const file = path.join(FIXTURES, `${feedKey(feed)}.xml`);
    if (!existsSync(file)) throw new Error('sem arquivo local');
    return readFile(file, 'utf8');
  }
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(feed.url, {
        headers: {
          'user-agent': USER_AGENT,
          accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
          'accept-language': feed.lang === 'pt' ? 'pt-BR,pt;q=0.9' : 'en-US,en;q=0.9',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return decodeBody(Buffer.from(await res.arrayBuffer()), res.headers.get('content-type') || '');
    } catch (err) {
      lastError = err;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastError;
}

/** Respeita o charset do cabeçalho ou da declaração XML (há feeds em ISO-8859-1). */
function decodeBody(buf, contentType) {
  const head = buf.subarray(0, 200).toString('latin1');
  const charset = (/charset=["']?([\w-]+)/i.exec(contentType) || /encoding=["']([\w-]+)["']/i.exec(head) || [])[1] || 'utf-8';
  try {
    return new TextDecoder(charset.toLowerCase()).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

function isBlocked(entry) {
  const haystack = [entry.title, entry.summary, entry.categories.join(' '), safePath(entry.url).replace(/[-_/]+/g, ' ')].join(' \n ').normalize('NFC');
  return matchesAny(config.blocklist, haystack) !== null;
}

function safePath(url) {
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return '';
  }
}

/** Tira assinaturas de rede social e sufixos de fonte do fim do título. */
function tidyTitle(title) {
  return title
    .replace(/\s+via\s+@\w+(?:\s*,\s*@\w+)*\s*$/i, '')
    .replace(/\s+[|–—-]\s+(?:Olhar Digital|Canaltech|Tecnoblog|g1|TechCrunch|The Verge|Adweek|Propmark|ADNEWS|B9)\s*$/i, '')
    .trim();
}

function routeColumn(feed, title) {
  for (const route of feed.routes || []) {
    route.match.lastIndex = 0;
    if (route.match.test(title)) return route.column;
  }
  return feed.column;
}

async function build() {
  const now = Date.now();
  const started = performance.now();
  const columnIds = new Set(config.columns.map((c) => c.id));
  for (const feed of config.feeds) {
    if (!columnIds.has(feed.column)) throw new Error(`Editoria desconhecida em ${feed.name}: ${feed.column}`);
  }

  const results = await mapPool(config.feeds, 8, async (feed) => {
    try {
      const xml = await fetchFeed(feed);
      const parsed = parseFeed(xml, { baseUrl: feed.site });
      if (!parsed.items.length) throw new Error('feed sem itens reconhecíveis');
      return { feed, entries: parsed.items };
    } catch (err) {
      return { feed, entries: [], error: err?.cause?.code || err?.message || String(err) };
    }
  });

  const seenUrls = new Set();
  const seenTitles = new Set();
  const sources = new Map();
  const report = [];
  const stats = { blocked: 0, noise: 0, old: 0, undated: 0, duplicated: 0 };
  let pool = [];

  for (const { feed, entries, error } of results) {
    let used = 0;
    let blocked = 0;
    for (const entry of entries) {
      if (!entry.date) {
        stats.undated++;
        continue;
      }
      const date = Math.min(entry.date, now); // datas no futuro = fuso errado na fonte
      if (now - date > config.limits.maxAgeDays * DAY) {
        stats.old++;
        continue;
      }
      if (isBlocked(entry)) {
        stats.blocked++;
        blocked++;
        continue;
      }
      if (matchesAny(config.noise, entry.title) || matchesAny(config.sponsored, `${entry.title} ${entry.summary}`)) {
        stats.noise++;
        continue;
      }
      if (feed.excludeUrl && feed.excludeUrl.test(entry.url)) {
        stats.noise++;
        continue;
      }
      if (feed.include && !feed.include.test(entry.title)) continue;
      if (feed.exclude && feed.exclude.test(entry.title)) continue;

      const url = cleanUrl(entry.url);
      const titleKey = normalizeTitle(entry.title);
      if (seenUrls.has(url) || seenTitles.has(titleKey)) {
        stats.duplicated++;
        continue;
      }
      seenUrls.add(url);
      seenTitles.add(titleKey);

      const sourceId = slugify(feed.name);
      if (!sources.has(sourceId)) sources.set(sourceId, { name: feed.name, site: feed.site, lang: feed.lang });

      pool.push({
        id: hashId(url),
        column: routeColumn(feed, entry.title),
        source: sourceId,
        lang: feed.lang,
        title: truncate(tidyTitle(entry.title), 200),
        url,
        date,
        summary: entry.summary ? truncate(entry.summary, 220) : '',
        image: entry.image || '',
      });
      used++;
    }
    report.push({ feed, found: entries.length, used, blocked, error });
  }

  // Por editoria: mais recentes primeiro, com limite por fonte para manter a variedade.
  pool.sort((a, b) => b.date - a.date);
  const selected = [];
  for (const column of config.columns) {
    const perSource = new Map();
    let count = 0;
    for (const item of pool) {
      if (item.column !== column.id) continue;
      const n = perSource.get(item.source) || 0;
      if (n >= config.limits.perSourcePerColumn) continue;
      perSource.set(item.source, n + 1);
      selected.push(item);
      if (++count >= config.limits.perColumn) break;
    }
  }
  selected.sort((a, b) => b.date - a.date);

  printReport(report, selected, stats, performance.now() - started);

  // Tudo em português: manchetes em inglês são traduzidas (ou saem, se não der para traduzir).
  // Com a chave da Anthropic, traduz com o Claude; no GitHub Actions sem a chave, com a IA da
  // Cloudflare pelo Worker do site.
  const hasCredentials = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const model = process.env.RADAR_TRANSLATION_MODEL || DEFAULT_MODEL;
  let translator = null;
  if (hasCredentials) {
    console.log(`Tradução com o Claude (${model}).`);
  } else if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL && config.site.url) {
    translator = workerTranslator(`${config.site.url}/api/translate`);
    console.log(`Tradução com a IA da Cloudflare (${config.site.url}/api/translate).`);
  }
  const { items: translated, stats: tr } = await translateItems(selected, {
    client: hasCredentials ? new Anthropic() : null,
    translator,
    cacheFile: TRANSLATIONS,
    model,
    log: (msg) => console.log(msg),
  });
  console.log(`Tradução: ${tr.cached} do cache, ${tr.translated} traduzidas agora, ${tr.dropped} sem tradução ficaram de fora.`);
  for (const failure of tr.failures) console.log(`  ✗ lote não traduzido: ${failure}`);

  // A tradução passa de novo pelos filtros de oferta, patrocínio e assunto bloqueado: o que foi
  // escrito em inglês de um jeito que os filtros não pegaram costuma aparecer com as palavras de
  // sempre em português. (Os de tutorial ficam de fora: "How we save…" vira "Como salvar…".)
  const refiltered = (it) =>
    it.lang === 'en' &&
    (matchesAny(config.blocklist, `${it.title} \n ${it.summary}`.normalize('NFC')) !== null ||
      matchesAny(config.offers, it.title) !== null ||
      matchesAny(config.sponsored, `${it.title} ${it.summary}`) !== null);
  const items = translated.filter((it) => !refiltered(it));
  for (const it of translated.filter(refiltered)) console.log(`  ✗ descartada depois da tradução: ${it.title}`);

  // Toda manchete com imagem: quando o feed não traz, usa a imagem de capa da matéria.
  if (!FIXTURES) await enrichImages(items, { cacheFile: IMAGES, log: (msg) => console.log(msg) });

  if (items.length < config.limits.minItems) {
    throw new Error(`Só ${items.length} manchetes (mínimo ${config.limits.minItems}). O site anterior foi mantido.`);
  }

  const usedSources = new Set(items.map((it) => it.source));
  const trends = computeTrends(items, {
    watchlist: config.watchlist,
    stoplist: config.trendStoplist,
    blocklist: config.blocklist,
    columns: config.columns,
    now,
    limit: config.limits.trends,
  });

  const data = {
    copyright: copyrightLine(),
    generatedAt: new Date(now).toISOString(),
    columns: config.columns,
    sources: Object.fromEntries([...sources].filter(([id]) => usedSources.has(id))),
    items,
    trends,
  };

  await writeSite(data);
  console.log(`\n✔ ${path.relative(ROOT, OUTPUT)} gerado com ${items.length} manchetes de ${usedSources.size} fontes e ${trends.length} termos em alta.`);
}

function printReport(report, items, stats, ms) {
  const perColumn = Object.fromEntries(config.columns.map((c) => [c.id, items.filter((it) => it.column === c.id).length]));
  console.log('Fontes:');
  for (const r of report) {
    const label = `${r.feed.name} (${r.feed.column})`.padEnd(42);
    if (r.error) console.log(`  ✗ ${label} ${r.error}  ${r.feed.url}`);
    else console.log(`  ✓ ${label} ${String(r.found).padStart(3)} no feed · ${String(r.used).padStart(3)} novas${r.blocked ? ` · ${r.blocked} bloqueadas` : ''}`);
  }
  const failed = report.filter((r) => r.error).length;
  console.log(`\n${report.length - failed}/${report.length} fontes responderam em ${(ms / 1000).toFixed(1)} s.`);
  console.log(`Descartadas: ${stats.blocked} por assunto bloqueado, ${stats.noise} ofertas/tutoriais, ${stats.old} antigas, ${stats.undated} sem data, ${stats.duplicated} repetidas.`);
  console.log('Por editoria:', Object.entries(perColumn).map(([k, v]) => `${k} ${v}`).join(' · '));
}

const YEAR = new Date().getFullYear();
const copyrightLine = () => `© ${YEAR} ${config.site.owner}. Todos os direitos reservados. ${config.site.url}`;

async function replaceAsync(str, re, fn) {
  const parts = [];
  let last = 0;
  for (const m of str.matchAll(re)) {
    parts.push(str.slice(last, m.index), await fn(...m));
    last = m.index + m[0].length;
  }
  parts.push(str.slice(last));
  return parts.join('');
}

/**
 * Entrega o código compactado: scripts e estilos minificados, sem comentários nem recuo.
 * Dificulta a cópia do código e deixa a página mais leve. O JSON de dados fica como está.
 */
async function minifyHtml(html) {
  html = await replaceAsync(html, /<script>([\s\S]*?)<\/script>/g, async (_, code) => {
    const out = await transform(code, { loader: 'js', minify: true, target: 'es2020', legalComments: 'none' });
    return `<script>${out.code.trim()}</script>`;
  });
  html = await replaceAsync(html, /<style>([\s\S]*?)<\/style>/g, async (_, css) => {
    const out = await transform(css, { loader: 'css', minify: true, legalComments: 'none' });
    return `<style>${out.code.trim()}</style>`;
  });
  // Fora dos <script>: tira comentários (menos o de direitos autorais) e o recuo entre tags.
  return html
    .split(/(<script\b[\s\S]*?<\/script>)/)
    .map((part, i) => (i % 2 ? part : part.replace(/<!--(?!\s*©)[\s\S]*?-->/g, '').replace(/>\s*\n\s*</g, '> <')))
    .join('');
}

async function writeSite(data) {
  const template = await readFile(TEMPLATE, 'utf8');
  const mark = await readFile(path.join(ROOT, 'assets', 'favcode-mark-96.png'));
  const escapeJson = (value) =>
    JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const origin = (config.site.url || SITE_URL).replace(/\/+$/, '');
  const guard = { origin, hosts: config.site.allowedHosts || [] };
  const html = template
    .replace('<!-- BUILD_NOTICE -->', () => `<!-- ${copyrightLine()} Cópia, reprodução ou clonagem proibidas (Lei nº 9.610/1998). -->`)
    .replaceAll('__SITE_URL__', () => SITE_URL)
    .replaceAll('__SITE_OWNER__', () => config.site.owner)
    .replace('<!-- PRIVACY_LINK -->', () => (newsletterOn() ? ' <a href="/privacidade">Política de privacidade</a>.' : ''))
    .replaceAll('__YEAR__', () => String(YEAR))
    .replaceAll('__LOGO_MARK__', () => `data:image/png;base64,${mark.toString('base64')}`)
    .replaceAll('__GUARD__', () => escapeJson(guard))
    .replaceAll('__NEWSLETTER__', () => escapeJson(newsletterClient()))
    .replace('__RADAR_DATA__', () => escapeJson({ ...data, copyright: copyrightLine() }));
  await writeFile(OUTPUT, process.env.RADAR_NO_MINIFY ? html : await minifyHtml(html));
  await writeExtraPages(origin);
}

/** A newsletter só liga com o contato de privacidade preenchido (exigência da LGPD). */
const newsletterOn = () => Boolean(config.newsletter?.enabled && config.newsletter?.privacyEmail);

function newsletterClient() {
  const nl = config.newsletter || {};
  return {
    enabled: newsletterOn(),
    freeReads: nl.freeReads ?? 1,
    author: nl.author,
    role: nl.role,
    day: nl.day,
    siteKey: nl.turnstileSiteKey || '',
  };
}

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Política de privacidade e editor da newsletter, gerados ao lado do index.html. */
async function writeExtraPages(origin) {
  const nl = config.newsletter || {};
  const [y, m, d] = String(nl.consentVersion || '').split('-').map(Number);
  const updated = y ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d)) : '';
  const vars = {
    __SITE_URL__: origin,
    __SITE_HOST__: origin.replace(/^https?:\/\//, ''),
    __SITE_OWNER__: config.site.owner,
    __YEAR__: String(YEAR),
    __CONTROLLER__: nl.controller || config.site.owner,
    __PRIVACY_EMAIL__: nl.privacyEmail || 'contato a definir',
    __AUTHOR__: nl.author || '',
    __DAY__: nl.day || '',
    __UPDATED__: updated,
  };
  const notice = `<!-- ${copyrightLine()} -->`;
  for (const [template, output] of [
    ['privacidade.template.html', 'privacidade.html'],
    ['editor.template.html', 'editor.html'],
  ]) {
    let html = (await readFile(path.join(ROOT, 'src', template), 'utf8')).replace('<!-- BUILD_NOTICE -->', () => notice);
    for (const [key, value] of Object.entries(vars)) html = html.replaceAll(key, () => escapeHtml(value));
    await writeFile(path.join(path.dirname(OUTPUT), output), process.env.RADAR_NO_MINIFY ? html : await minifyHtml(html));
  }
}

async function renderTemplateOnly() {
  const current = await readFile(OUTPUT, 'utf8');
  const m = /<script type="application\/json" id="radar-data">([\s\S]*?)<\/script>/.exec(current);
  if (!m) throw new Error(`Não encontrei as manchetes em ${path.relative(ROOT, OUTPUT)}. Rode o build completo.`);
  const data = JSON.parse(m[1]);
  // Editorias (nomes, cores) vêm sempre da configuração atual.
  data.columns = config.columns;
  await writeSite(data);
  console.log(`✔ ${path.relative(ROOT, OUTPUT)} atualizado com o template atual.`);
}

(process.argv.includes('--template-only') ? renderTemplateOnly() : build()).catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
