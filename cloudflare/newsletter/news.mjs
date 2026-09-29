// Notícias que passaram pelo radar, guardadas no D1 por 30 dias: são a base do rascunho semanal.

import { DAY } from '../lib/util.mjs';

const DATA_RE = /<script type="application\/json" id="radar-data">([\s\S]*?)<\/script>/;

/** Os dados embutidos no index.html (manchetes, editorias, fontes e termos em alta). */
export function extractPageData(html) {
  const m = DATA_RE.exec(html || '');
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

export const columnNames = (data) => Object.fromEntries((data?.columns || []).map((c) => [c.id, c.name]));

/**
 * Grava as manchetes da página. `heat` soma os pontos dos termos "Em alta" ligados à notícia;
 * guarda o maior valor já visto, para o rascunho semanal priorizar o que mais repercutiu.
 */
export async function recordNews(env, data, now = Date.now()) {
  if (!env.DB || !Array.isArray(data?.items) || !data.items.length) return 0;
  const heat = new Map();
  for (const trend of data.trends || []) {
    for (const id of trend.ids || []) heat.set(id, (heat.get(id) || 0) + (Number(trend.score) || 0));
  }
  // O build grava as fontes como objeto { id: { name } }; aceita também a lista de pares.
  const sources = new Map(Array.isArray(data.sources) ? data.sources : Object.entries(data.sources || {}));
  const stmt = env.DB.prepare(
    `INSERT INTO news (id, title, summary, url, source, column_id, image, published_at, first_seen, heat)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       summary = excluded.summary,
       image = CASE WHEN excluded.image <> '' THEN excluded.image ELSE news.image END,
       heat = MAX(news.heat, excluded.heat)`,
  );
  const rows = data.items
    .filter((it) => it && it.id && it.title && it.url)
    .map((it) =>
      stmt.bind(
        String(it.id),
        String(it.title).slice(0, 400),
        String(it.summary || '').slice(0, 500),
        String(it.url),
        sources.get(it.source)?.name || String(it.source || ''),
        String(it.column || ''),
        String(it.image || ''),
        Number(it.date) || 0,
        now,
        Math.round((heat.get(it.id) || 0) * 10) / 10,
      ),
    );
  for (let i = 0; i < rows.length; i += 50) await env.DB.batch(rows.slice(i, i + 50));
  return rows.length;
}

export async function cleanupNews(env, now = Date.now()) {
  if (!env.DB) return;
  await env.DB.prepare('DELETE FROM news WHERE first_seen < ?').bind(now - 30 * DAY).run();
}

/**
 * Candidatas da semana: as mais repercutidas de cada editoria (até `perColumn` por editoria),
 * em ordem de calor e depois de data.
 */
export async function weekNews(env, { now = Date.now(), days = 7, perColumn = 4, limit = 400 } = {}) {
  const { results = [] } = await env.DB.prepare(
    'SELECT * FROM news WHERE first_seen >= ? ORDER BY heat DESC, published_at DESC LIMIT ?',
  )
    .bind(now - days * DAY, limit)
    .all();
  const byColumn = new Map();
  for (const row of results) {
    const list = byColumn.get(row.column_id) || [];
    if (list.length < perColumn) list.push(row);
    byColumn.set(row.column_id, list);
  }
  const candidates = [...byColumn.values()].flat().sort((a, b) => b.heat - a.heat || b.published_at - a.published_at);
  return { all: results, candidates };
}
