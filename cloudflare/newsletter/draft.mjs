// Rascunho semanal da newsletter: escolhe as notícias da semana, pede à IA sugestões de
// assunto, abertura e comentários, grava a edição no D1 e avisa quem edita.

import { AI_MODEL, runJson } from '../lib/ai.mjs';
import { DAY, signToken } from '../lib/util.mjs';
import { renderEditorLink } from './email.mjs';
import { columnNames, extractPageData, weekNews } from './news.mjs';
import { resendClient } from './resend.mjs';
import { NEWSLETTER, editorEmails, siteOrigin, teamFromAddress } from './settings.mjs';

export const EDITION_SIZE = 8;
const TZ = 'America/Sao_Paulo';

/** Semana ISO no fuso de Brasília, ex.: 2026-W40. */
export function editionId(now = Date.now()) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7)); // quinta-feira da mesma semana
  const week = Math.ceil(((date - Date.UTC(date.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** "Semana de 23 a 29 de setembro de 2026" (os 7 dias que terminam em `now`). */
export function weekLabel(now = Date.now()) {
  const fmt = (d, opts) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, ...opts }).format(d);
  const start = now - 6 * DAY;
  const sameMonth = fmt(start, { month: 'numeric' }) === fmt(now, { month: 'numeric' });
  const from = sameMonth ? fmt(start, { day: 'numeric' }) : fmt(start, { day: 'numeric', month: 'long' });
  return `Semana de ${from} a ${fmt(now, { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

const SYSTEM = `Você é assistente editorial de ${NEWSLETTER.author}, colunista do FavCode. Toda ${NEWSLETTER.day} ela envia a newsletter do Radar FavCode para profissionais brasileiros de marketing, publicidade, tecnologia e negócios digitais e para quem empreende, comentando as notícias mais importantes da semana.

Sua tarefa:
1. Escolha as ${EDITION_SIZE} notícias mais relevantes entre as candidatas. Priorize o que tem impacto para quem trabalha com comunicação, marcas, agências, criadores e pequenas empresas. Não escolha duas sobre o mesmo fato e varie as editorias quando possível.
2. Para cada notícia escolhida, escreva uma sugestão de comentário de 2 a 3 frases, na primeira pessoa, no tom de uma colunista experiente em comunicação: uma observação profissional e prática sobre o que aquilo muda para marcas, agências ou criadores.
3. Sugira um assunto de e-mail (até 60 caracteres, sem clickbait e sem emoji), um pré-cabeçalho (até 90 caracteres) e uma abertura de 2 a 3 frases, na primeira pessoa, ligando os principais temas da semana.

Regras: português do Brasil; não assine (a assinatura já vai no fim do e-mail); sem emojis e sem hashtags; não invente fatos, números, nomes ou citações que não estejam no título ou no resumo — quando faltar informação, comente o significado da notícia, não detalhes. Use exatamente os ids recebidos.`;

const SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    preheader: { type: 'string' },
    intro: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, comment: { type: 'string' } },
        required: ['id', 'comment'],
        additionalProperties: false,
      },
    },
  },
  required: ['subject', 'preheader', 'intro', 'items'],
  additionalProperties: false,
};

const toItem = (row, names, comment = '') => ({
  id: row.id,
  title: row.title,
  url: row.url,
  source: row.source,
  column: row.column_id,
  columnName: names[row.column_id] || '',
  image: row.image || '',
  summary: row.summary || '',
  comment,
  suggestion: comment,
});

export async function getEdition(env, id) {
  const row = await env.DB.prepare('SELECT * FROM editions WHERE id = ?').bind(id).first();
  return row ? { ...row, data: JSON.parse(row.data) } : null;
}

export async function latestEdition(env) {
  const row = await env.DB.prepare('SELECT * FROM editions ORDER BY id DESC LIMIT 1').first();
  return row ? { ...row, data: JSON.parse(row.data) } : null;
}

/** Salva o conteúdo de uma edição ainda em rascunho. Devolve false se ela já foi enviada. */
export async function saveDraft(env, data, now = Date.now()) {
  const stamp = new Date(now).toISOString();
  const res = await env.DB.prepare(
    `INSERT INTO editions (id, status, data, created_at, updated_at) VALUES (?1, 'draft', ?2, ?3, ?3)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at WHERE editions.status = 'draft'`,
  )
    .bind(data.id, JSON.stringify(data), stamp)
    .run();
  return (res.meta?.changes ?? 1) > 0;
}

/**
 * Monta o rascunho da semana. Sem `force`, não mexe numa edição que já existe.
 * Se a IA falhar, o rascunho sai com as notícias mais repercutidas e os comentários em branco.
 */
export async function createWeeklyDraft(env, { now = Date.now(), force = false, notify = true } = {}) {
  const id = editionId(now);
  const existing = await getEdition(env, id);
  if (existing && (!force || existing.status !== 'draft')) return { edition: existing, created: false };

  const page = extractPageData(env.RADAR ? await env.RADAR.get('page') : '');
  const names = columnNames(page);
  const { candidates } = await weekNews(env, { now });
  if (candidates.length < 3) throw new Error('Poucas notícias registradas nesta semana para montar o rascunho.');

  let suggestion = null;
  let aiError = '';
  if (env.AI) {
    const list = candidates.map((row) => ({
      id: row.id,
      editoria: names[row.column_id] || row.column_id,
      fonte: row.source,
      titulo: row.title,
      resumo: String(row.summary || '').slice(0, 240),
    }));
    try {
      suggestion = await runJson(env, {
        system: SYSTEM,
        user: `${weekLabel(now)}. Notícias candidatas:\n${JSON.stringify(list)}`,
        schema: SCHEMA,
        name: 'rascunho',
        effort: 'medium',
      });
    } catch (err) {
      aiError = String(err?.message || err).slice(0, 200);
    }
  }

  const byId = new Map(candidates.map((row) => [row.id, row]));
  const seen = new Set();
  let items = (suggestion?.items || [])
    .filter((it) => byId.has(it.id) && !seen.has(it.id) && seen.add(it.id))
    .slice(0, EDITION_SIZE)
    .map((it) => toItem(byId.get(it.id), names, String(it.comment || '').trim()));
  if (items.length < 3) items = candidates.slice(0, EDITION_SIZE).map((row) => toItem(row, names));

  const data = {
    id,
    week: weekLabel(now),
    subject: String(suggestion?.subject || '').trim().slice(0, 120) || `Radar FavCode: o que marcou a semana`,
    preheader: String(suggestion?.preheader || '').trim().slice(0, 150),
    intro: String(suggestion?.intro || '').trim(),
    introSuggestion: String(suggestion?.intro || '').trim(),
    closing: NEWSLETTER.closing,
    items,
    generatedAt: new Date(now).toISOString(),
    model: suggestion ? AI_MODEL : '',
    ...(aiError ? { aiError } : {}),
  };
  await saveDraft(env, data, now);
  const edition = await getEdition(env, id);
  if (notify) await notifyEditors(env, data, now).catch(() => {});
  return { edition, created: true };
}

/** Manda para cada editor(a) o aviso de rascunho pronto, com link de acesso válido por 4 dias. */
export async function notifyEditors(env, draft, now = Date.now(), fetchImpl = fetch) {
  const resend = resendClient(env, fetchImpl);
  const emails = editorEmails(env);
  if (!resend || !emails.length || !env.SESSION_SECRET) return 0;
  const origin = siteOrigin(env);
  for (const email of emails) {
    const token = await signToken(env.SESSION_SECRET, { p: 'login', e: email, x: now + 4 * DAY });
    const mail = renderEditorLink({ link: `${origin}/editor/entrar?t=${token}`, origin, draft });
    await resend.sendEmail({ from: teamFromAddress(env), to: email, ...mail });
  }
  return emails.length;
}
