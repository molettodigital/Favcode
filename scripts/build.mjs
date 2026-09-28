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

import * as config from '../config/radar.config.mjs';
import { parseFeed, truncate } from './lib/feed-parser.mjs';
import { computeTrends } from './lib/trends.mjs';
import { cleanUrl, hashId, mapPool, matchesAny, normalizeTitle, slugify } from './lib/utils.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(ROOT, 'src', 'index.template.html');
const OUTPUT = path.resolve(ROOT, process.env.RADAR_OUTPUT || 'index.html');
const FIXTURES = process.env.RADAR_FIXTURES ? path.resolve(process.env.RADAR_FIXTURES) : '';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');
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
  const haystack = [entry.title, entry.summary, entry.categories.join(' '), safePath(entry.url).replace(/[-_/]+/g, ' ')].join(' \n ');
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
      if (matchesAny(config.noise, entry.title)) {
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
  const items = [];
  for (const column of config.columns) {
    const perSource = new Map();
    let count = 0;
    for (const item of pool) {
      if (item.column !== column.id) continue;
      const n = perSource.get(item.source) || 0;
      if (n >= config.limits.perSourcePerColumn) continue;
      perSource.set(item.source, n + 1);
      items.push(item);
      if (++count >= config.limits.perColumn) break;
    }
  }
  items.sort((a, b) => b.date - a.date);

  printReport(report, items, stats, performance.now() - started);

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

async function writeSite(data) {
  const template = await readFile(TEMPLATE, 'utf8');
  const mark = await readFile(path.join(ROOT, 'assets', 'favcode-mark-96.png'));
  const json = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const html = template
    .replace('<!-- BUILD_NOTICE -->', () => '<!-- Gerado por scripts/build.mjs. Para mudar o layout, edite src/index.template.html. -->')
    .replaceAll('__SITE_URL__', () => SITE_URL)
    .replaceAll('__LOGO_MARK__', () => `data:image/png;base64,${mark.toString('base64')}`)
    .replace('__RADAR_DATA__', () => json);
  await writeFile(OUTPUT, html);
}

async function renderTemplateOnly() {
  const current = await readFile(OUTPUT, 'utf8');
  const m = /<script type="application\/json" id="radar-data">([\s\S]*?)<\/script>/.exec(current);
  if (!m) throw new Error(`Não encontrei as manchetes em ${path.relative(ROOT, OUTPUT)}. Rode o build completo.`);
  await writeSite(JSON.parse(m[1]));
  console.log(`✔ ${path.relative(ROOT, OUTPUT)} atualizado com o template atual.`);
}

(process.argv.includes('--template-only') ? renderTemplateOnly() : build()).catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
