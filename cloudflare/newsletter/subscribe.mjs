// Cadastro na newsletter: POST /api/subscribe, validação, Turnstile (anti-robô), gravação no D1
// com o registro do consentimento e sincronização com o Resend.

import { json } from '../lib/util.mjs';
import { renderWelcome } from './email.mjs';
import { resendClient } from './resend.mjs';
import { CONSENT_VERSION, fromAddress, replyTo, siteOrigin } from './settings.mjs';

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

/** Telefone em E.164. Brasil: DDD + número (10 ou 11 dígitos), com ou sem +55; outros países com "+". */
export function normalizePhone(raw) {
  const text = String(raw || '').trim();
  if (!text) return { phone: null, ok: true };
  let digits = text.replace(/\D/g, '');
  const international = text.startsWith('+') || text.startsWith('00');
  if (text.startsWith('00')) digits = digits.slice(2);
  if (international && !digits.startsWith('55')) {
    return digits.length >= 8 && digits.length <= 15 ? { phone: `+${digits}`, ok: true } : { phone: null, ok: false };
  }
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1); // 0 da operadora/DDD antigo
  const validDdd = /^[1-9][1-9]/.test(digits);
  const mobile = digits.length === 11 && digits[2] === '9';
  const landline = digits.length === 10 && /[2-5]/.test(digits[2]);
  return validDdd && (mobile || landline) ? { phone: `+55${digits}`, ok: true } : { phone: null, ok: false };
}

/** Normaliza e valida os campos do formulário. */
export function validateSubscriber(body) {
  const name = String(body?.name ?? '').replace(/\s+/g, ' ').trim();
  const email = String(body?.email ?? '').trim().toLowerCase();
  const errors = {};
  if (name.length < 2 || name.length > 80 || /https?:|www\.|[<>@]/i.test(name)) errors.name = 'Informe seu nome.';
  if (email.length > 254 || !EMAIL.test(email)) errors.email = 'Informe um e-mail válido.';
  const { phone, ok } = normalizePhone(body?.phone);
  if (!ok) errors.phone = 'Confira o telefone, com DDD.';
  if (body?.consent !== true) errors.consent = 'Para continuar, aceite receber a newsletter.';
  return { value: { name, email, phone }, errors };
}

export async function verifyTurnstile(secret, token, ip, fetchImpl = fetch) {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

export async function handleSubscribe(request, env, ctx) {
  if (request.method !== 'POST') return json(405, { error: 'Use POST.' });
  if (!env.DB) return json(503, { error: 'O cadastro está indisponível no momento. Tente de novo mais tarde.' });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json(403, { error: 'Origem não permitida.' });

  if (env.FORM_LIMITER) {
    const ip = request.headers.get('cf-connecting-ip') || 'sem-ip';
    const { success } = await env.FORM_LIMITER.limit({ key: `subscribe:${ip}` });
    if (!success) return json(429, { error: 'Muitas tentativas. Espere um minuto e tente de novo.' });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json(400, { error: 'Pedido inválido.' });
  const { value, errors } = validateSubscriber(body);
  if (Object.keys(errors).length) return json(422, { error: Object.values(errors)[0], fields: errors });

  if (env.TURNSTILE_SECRET) {
    const human = await verifyTurnstile(env.TURNSTILE_SECRET, body.token, request.headers.get('cf-connecting-ip'));
    if (!human) return json(403, { error: 'Não conseguimos confirmar que você não é um robô. Tente de novo.' });
  }

  const now = new Date().toISOString();
  const source = typeof body.source === 'string' && /^[a-z-]{2,20}$/.test(body.source) ? body.source : 'site';
  await env.DB.prepare(
    `INSERT INTO subscribers (email, name, phone, source, consent_at, consent_version, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5, ?5)
     ON CONFLICT(email) DO UPDATE SET
       name = excluded.name,
       phone = COALESCE(excluded.phone, subscribers.phone),
       consent_at = excluded.consent_at,
       consent_version = excluded.consent_version,
       updated_at = excluded.updated_at,
       synced_at = NULL,
       sync_error = NULL`,
  )
    .bind(value.email, value.name, value.phone, source, now, CONSENT_VERSION)
    .run();

  if (env.RESEND_API_KEY && ctx?.waitUntil) ctx.waitUntil(syncSubscribers(env, { emails: [value.email] }).catch(() => {}));
  return json(200, { ok: true });
}

/**
 * Envia ao Resend os inscritos ainda não sincronizados (e a boas-vindas, na primeira vez).
 * Sem `emails`, pega os pendentes há mais de 2 minutos (o cadastro já tenta na hora).
 */
export async function syncSubscribers(env, { emails, limit = 20, now = Date.now(), fetchImpl = fetch } = {}) {
  const resend = resendClient(env, fetchImpl);
  if (!resend || !env.DB) return { synced: 0, failed: 0 };
  const query = emails?.length
    ? env.DB.prepare(`SELECT * FROM subscribers WHERE synced_at IS NULL AND email IN (${emails.map(() => '?').join(',')})`).bind(...emails)
    : env.DB.prepare('SELECT * FROM subscribers WHERE synced_at IS NULL AND updated_at < ? ORDER BY updated_at LIMIT ?').bind(
        new Date(now - 120_000).toISOString(),
        limit,
      );
  const rows = (await query.all()).results || [];
  if (!rows.length) return { synced: 0, failed: 0 };

  const origin = siteOrigin(env);
  const segmentId = await resend.segmentId();
  let synced = 0;
  let failed = 0;
  for (const row of rows) {
    const stamp = new Date().toISOString();
    try {
      await resend.upsertContact({ email: row.email, name: row.name, segmentId });
      let welcomed = row.welcomed_at;
      if (!welcomed) {
        try {
          const mail = renderWelcome({ name: row.name, origin });
          await resend.sendEmail({ from: fromAddress(env), to: row.email, replyTo: replyTo(env), ...mail });
          welcomed = stamp;
        } catch {
          /* sem boas-vindas não impede a inscrição */
        }
      }
      await env.DB.prepare('UPDATE subscribers SET synced_at = ?, sync_error = NULL, welcomed_at = ? WHERE email = ?')
        .bind(stamp, welcomed, row.email)
        .run();
      synced++;
    } catch (err) {
      failed++;
      await env.DB.prepare('UPDATE subscribers SET sync_error = ? WHERE email = ?')
        .bind(String(err?.message || err).slice(0, 300), row.email)
        .run();
    }
  }
  return { synced, failed };
}
