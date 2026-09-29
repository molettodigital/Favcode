// API do editor da newsletter (/editor). Acesso por link enviado ao e-mail de quem edita
// (EDITOR_EMAILS), com sessão em cookie assinado; nada de senha.

import { DAY, json, readCookie, signToken, verifyToken } from '../lib/util.mjs';
import { createWeeklyDraft, getEdition, latestEdition, saveDraft } from './draft.mjs';
import { renderEditorLink, renderNewsletter } from './email.mjs';
import { weekNews } from './news.mjs';
import { resendClient } from './resend.mjs';
import { editorEmails, fromAddress, replyTo, siteOrigin } from './settings.mjs';

const COOKIE = 'radar_editor';
const SESSION_DAYS = 30;
const LOGIN_MINUTES = 30;

async function currentEditor(request, env) {
  const token = readCookie(request, COOKIE);
  const payload = await verifyToken(env.SESSION_SECRET, token, 'session');
  if (!payload || !editorEmails(env).includes(payload.e)) return null;
  return payload.e;
}

const clip = (value, max) => String(value ?? '').slice(0, max);
const httpUrl = (value) => (/^https?:\/\/[^\s<>"']+$/i.test(String(value || '')) ? String(value) : '');

/** Aceita só os campos conhecidos, com limites de tamanho. O id da edição não muda. */
export function sanitizeEdition(input, id) {
  const items = Array.isArray(input?.items) ? input.items.slice(0, 20) : [];
  return {
    id,
    week: clip(input?.week, 120),
    generatedAt: clip(input?.generatedAt, 40),
    model: clip(input?.model, 80),
    ...(input?.aiError ? { aiError: clip(input.aiError, 200) } : {}),
    subject: clip(input?.subject, 150).trim(),
    preheader: clip(input?.preheader, 200),
    intro: clip(input?.intro, 6000),
    introSuggestion: clip(input?.introSuggestion, 6000),
    closing: clip(input?.closing, 2000),
    author: clip(input?.author, 80),
    role: clip(input?.role, 120),
    items: items
      .map((it) => ({
        id: clip(it?.id, 40),
        title: clip(it?.title, 400).trim(),
        url: httpUrl(it?.url),
        source: clip(it?.source, 100),
        column: clip(it?.column, 40),
        columnName: clip(it?.columnName, 60),
        image: /^https:\/\//i.test(String(it?.image || '')) ? clip(it.image, 2000) : '',
        summary: clip(it?.summary, 600),
        comment: clip(it?.comment, 4000),
        suggestion: clip(it?.suggestion, 4000),
      }))
      .filter((it) => it.title && it.url),
  };
}

const csvCell = (value) => {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; // evita fórmula ao abrir no Excel
  return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

async function stats(env) {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS total, SUM(CASE WHEN synced_at IS NULL THEN 1 ELSE 0 END) AS pending FROM subscribers',
  ).first();
  return { total: row?.total || 0, pending: row?.pending || 0 };
}

export async function handleEditor(request, env, ctx, url) {
  const path = url.pathname;
  if (!env.DB || !env.SESSION_SECRET) return json(503, { error: 'O editor ainda não foi configurado.' });
  const origin = siteOrigin(env);

  // Link recebido por e-mail: troca o token de login por uma sessão.
  if (path === '/editor/entrar') {
    const payload = await verifyToken(env.SESSION_SECRET, url.searchParams.get('t') || '', 'login');
    if (!payload || !editorEmails(env).includes(payload.e)) {
      return new Response(null, { status: 302, headers: { location: '/editor?link=expirado' } });
    }
    const session = await signToken(env.SESSION_SECRET, { p: 'session', e: payload.e, x: Date.now() + SESSION_DAYS * DAY });
    return new Response(null, {
      status: 302,
      headers: {
        location: '/editor',
        'set-cookie': `${COOKIE}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
        'cache-control': 'no-store',
      },
    });
  }

  // Pedidos que mudam algo precisam do cabeçalho do editor (bloqueia envio a partir de outros sites).
  const mutating = request.method !== 'GET' && request.method !== 'HEAD';
  if (mutating && request.headers.get('x-radar-editor') !== '1') return json(403, { error: 'Pedido recusado.' });

  if (path === '/api/editor/login' && request.method === 'POST') {
    if (env.FORM_LIMITER) {
      const { success } = await env.FORM_LIMITER.limit({ key: `login:${request.headers.get('cf-connecting-ip') || ''}` });
      if (!success) return json(429, { error: 'Muitas tentativas. Espere um minuto.' });
    }
    const resend = resendClient(env);
    if (!resend) return json(503, { error: 'O envio de e-mails ainda não foi configurado.' });
    const body = await request.json().catch(() => ({}));
    const email = String(body?.email || '').trim().toLowerCase();
    if (editorEmails(env).includes(email)) {
      const token = await signToken(env.SESSION_SECRET, { p: 'login', e: email, x: Date.now() + LOGIN_MINUTES * 60_000 });
      const mail = renderEditorLink({ link: `${origin}/editor/entrar?t=${token}`, origin });
      await resend.sendEmail({ from: fromAddress(env), to: email, ...mail });
    }
    // Mesma resposta para qualquer e-mail: não revela quem tem acesso.
    return json(200, { ok: true });
  }

  const editor = await currentEditor(request, env);
  if (!editor) return json(401, { error: 'Entre com o link enviado ao seu e-mail.' });

  if (path === '/api/editor/logout' && request.method === 'POST') {
    return json(200, { ok: true }, { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
  }

  if (path === '/api/editor/state' && request.method === 'GET') {
    return json(200, { editor, subscribers: await stats(env), resend: Boolean(env.RESEND_API_KEY), edition: await latestEdition(env) });
  }

  if (path === '/api/editor/generate' && request.method === 'POST') {
    try {
      const { edition } = await createWeeklyDraft(env, { force: true, notify: false });
      return json(200, { edition });
    } catch (err) {
      return json(422, { error: err?.message || 'Não foi possível montar o rascunho.' });
    }
  }

  if (path === '/api/editor/candidates' && request.method === 'GET') {
    const { all } = await weekNews(env, { limit: 150 });
    return json(200, {
      items: all.map((r) => ({ id: r.id, title: r.title, url: r.url, source: r.source, column: r.column_id, image: r.image, summary: r.summary, heat: r.heat })),
    });
  }

  if (path === '/api/editor/inscritos.csv' && request.method === 'GET') {
    const { results = [] } = await env.DB.prepare(
      'SELECT email, name, phone, source, created_at, consent_at, consent_version, synced_at FROM subscribers ORDER BY created_at DESC',
    ).all();
    const header = ['email', 'nome', 'telefone', 'origem', 'cadastro', 'consentimento', 'versao_consentimento', 'enviado_ao_resend'];
    const lines = [header, ...results.map((r) => [r.email, r.name, r.phone, r.source, r.created_at, r.consent_at, r.consent_version, r.synced_at])];
    const csv = `﻿${lines.map((line) => line.map(csvCell).join(';')).join('\r\n')}\r\n`;
    const day = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="inscritos-radar-favcode-${day}.csv"`,
        'cache-control': 'no-store',
      },
    });
  }

  // As rotas abaixo trabalham sobre uma edição em rascunho.
  const body = await request.json().catch(() => ({}));
  const current = body?.id ? await getEdition(env, String(body.id)) : null;
  if (!current) return json(404, { error: 'Edição não encontrada.' });
  const data = sanitizeEdition(body.data || current.data, current.id);

  if (path === '/api/editor/edition' && request.method === 'PUT') {
    if (current.status !== 'draft') return json(409, { error: 'Esta edição já foi enviada e não pode mais ser alterada.' });
    await saveDraft(env, data);
    return json(200, { ok: true, savedAt: new Date().toISOString() });
  }

  if (path === '/api/editor/preview' && request.method === 'POST') {
    return json(200, { html: renderNewsletter(data, { origin, unsubscribeUrl: `${origin}/privacidade` }).html });
  }

  const resend = resendClient(env);
  if (!resend) return json(503, { error: 'O envio de e-mails ainda não foi configurado (falta a chave do Resend).' });

  if (path === '/api/editor/test' && request.method === 'POST') {
    const { html, text } = renderNewsletter(data, { origin, unsubscribeUrl: `${origin}/privacidade` });
    await resend.sendEmail({ from: fromAddress(env), to: editor, replyTo: replyTo(env), subject: `[Teste] ${data.subject}`, html, text });
    return json(200, { ok: true, to: editor });
  }

  if (path === '/api/editor/send' && request.method === 'POST') {
    if (current.status !== 'draft') return json(409, { error: 'Esta edição já foi enviada.' });
    if (!data.subject || !data.items.length) return json(422, { error: 'Preencha o assunto e deixe ao menos uma notícia.' });
    let scheduledAt = null;
    if (body.scheduledAt) {
      const when = Date.parse(body.scheduledAt);
      if (!(when > Date.now() + 60_000) || when > Date.now() + 30 * DAY) {
        return json(422, { error: 'Escolha um horário entre daqui a alguns minutos e os próximos 30 dias.' });
      }
      scheduledAt = new Date(when).toISOString();
    }
    await saveDraft(env, data);
    // Trava a edição antes de enviar, para um clique duplo não mandar duas vezes.
    const lock = await env.DB.prepare("UPDATE editions SET status = 'sending' WHERE id = ? AND status = 'draft'").bind(current.id).run();
    if ((lock.meta?.changes ?? 1) === 0) return json(409, { error: 'Esta edição já está sendo enviada.' });
    try {
      const { html, text } = renderNewsletter(data, { origin });
      const broadcast = await resend.createBroadcast({
        segmentId: await resend.segmentId(),
        from: fromAddress(env),
        replyTo: replyTo(env),
        subject: data.subject,
        html,
        text,
        name: `Newsletter ${current.id}`,
        scheduledAt,
      });
      const status = scheduledAt ? 'scheduled' : 'sent';
      await env.DB.prepare('UPDATE editions SET status = ?, broadcast_id = ?, sent_at = ? WHERE id = ?')
        .bind(status, broadcast?.id || '', scheduledAt || new Date().toISOString(), current.id)
        .run();
      return json(200, { ok: true, status, scheduledAt, subscribers: (await stats(env)).total });
    } catch (err) {
      await env.DB.prepare("UPDATE editions SET status = 'draft' WHERE id = ?").bind(current.id).run();
      return json(502, { error: `O Resend recusou o envio: ${err?.message || err}` });
    }
  }

  return json(404, { error: 'Rota não encontrada.' });
}
