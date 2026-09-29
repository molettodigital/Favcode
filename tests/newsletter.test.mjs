import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../cloudflare/worker.mjs';
import { signToken, verifyToken } from '../cloudflare/lib/util.mjs';
import { createWeeklyDraft, editionId, weekLabel } from '../cloudflare/newsletter/draft.mjs';
import { renderNewsletter } from '../cloudflare/newsletter/email.mjs';
import { recordNews, weekNews } from '../cloudflare/newsletter/news.mjs';
import { CONSENT_VERSION } from '../cloudflare/newsletter/settings.mjs';
import { normalizePhone, syncSubscribers, validateSubscriber } from '../cloudflare/newsletter/subscribe.mjs';
import { newsletter as siteNewsletter } from '../config/radar.config.mjs';
import { fakeD1, fakeKV } from './helpers/fake-d1.mjs';

const ORIGIN = 'https://radar.favcode.com.br';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const DAY = 86_400_000;

// ---------- Resend e Turnstile de mentira ----------
let resend;
let turnstileOk;
function resetFakes() {
  resend = { calls: [], contacts: new Map(), segments: [], emails: [], broadcasts: [], failContacts: false };
  turnstileOk = true;
}
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith('https://challenges.cloudflare.com/')) return Response.json({ success: turnstileOk });
  if (!url.startsWith('https://api.resend.com/')) return new Response('inesperado', { status: 500 });
  const path = url.slice('https://api.resend.com'.length);
  const body = init.body ? JSON.parse(init.body) : undefined;
  const method = init.method || 'GET';
  resend.calls.push({ method, path, body });
  if (path === '/segments' && method === 'GET') return Response.json({ data: resend.segments });
  if (path === '/segments' && method === 'POST') {
    const seg = { id: `seg-${resend.segments.length + 1}`, name: body.name };
    resend.segments.push(seg);
    return Response.json(seg);
  }
  if (path === '/contacts' && method === 'POST') {
    if (resend.failContacts) return Response.json({ message: 'Servidor fora do ar' }, { status: 500 });
    if (resend.contacts.has(body.email)) return Response.json({ message: 'Contact already exists' }, { status: 409 });
    resend.contacts.set(body.email, body);
    return Response.json({ id: `ct-${resend.contacts.size}` });
  }
  if (path.startsWith('/contacts/') && method === 'PATCH') return Response.json({ ok: true });
  if (/^\/contacts\/[^/]+\/segments\//.test(path)) return Response.json({ ok: true });
  if (path === '/emails') {
    resend.emails.push(body);
    return Response.json({ id: `em-${resend.emails.length}` });
  }
  if (path === '/broadcasts') {
    resend.broadcasts.push(body);
    return Response.json({ id: `bc-${resend.broadcasts.length}` });
  }
  return new Response('rota desconhecida', { status: 404 });
};

let env;
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const settle = async () => {
  while (waits.length) await waits.shift();
};
beforeEach(() => {
  resetFakes();
  env = {
    DB: fakeD1(),
    RADAR: fakeKV(),
    RESEND_API_KEY: 're_test',
    TURNSTILE_SECRET: 'segredo',
    SESSION_SECRET: 'segredo-de-sessao-bem-longo',
    EDITOR_EMAILS: 'clara@example.com',
    CANONICAL_ORIGIN: ORIGIN,
    GITHUB_REPO: 'molettodigital/Favcode',
  };
});

const call = (path, { method = 'GET', body, headers = {} } = {}) =>
  worker.fetch(
    new Request(ORIGIN + path, {
      method,
      headers: { 'user-agent': CHROME, 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    ctx,
  );
const signup = (extra = {}) => ({ name: 'Ana Souza', email: 'Ana@Exemplo.com.br', phone: '', consent: true, token: 'tok', source: 'leitura', ...extra });

// ---------- Validação ----------
test('telefone: aceita celular e fixo do Brasil com ou sem +55 e número internacional com +', () => {
  assert.deepEqual(normalizePhone('(11) 98765-4321'), { phone: '+5511987654321', ok: true });
  assert.deepEqual(normalizePhone('+55 21 3456-7890'), { phone: '+552134567890', ok: true });
  assert.deepEqual(normalizePhone('5555999998888'), { phone: '+5555999998888', ok: true });
  assert.deepEqual(normalizePhone('+351 912 345 678'), { phone: '+351912345678', ok: true });
  assert.deepEqual(normalizePhone(''), { phone: null, ok: true });
  assert.equal(normalizePhone('98765-4321').ok, false); // sem DDD
  assert.equal(normalizePhone('abc').ok, false);
});

test('formulário: nome, e-mail e consentimento obrigatórios', () => {
  assert.deepEqual(validateSubscriber(signup()).errors, {});
  assert.equal(validateSubscriber(signup()).value.email, 'ana@exemplo.com.br');
  const bad = validateSubscriber({ name: 'A', email: 'ana@', consent: false, phone: '123' }).errors;
  assert.deepEqual(Object.keys(bad).sort(), ['consent', 'email', 'name', 'phone']);
  assert.ok(validateSubscriber(signup({ name: 'www.spam.com' })).errors.name);
});

test('a versão do consentimento do site é a mesma do Worker', () => {
  assert.equal(siteNewsletter.consentVersion, CONSENT_VERSION);
});

// ---------- Cadastro ----------
test('cadastro grava o consentimento, envia ao Resend no segmento e manda boas-vindas uma vez', async () => {
  const res = await call('/api/subscribe', { method: 'POST', body: signup({ phone: '(11) 98765-4321' }), headers: { origin: ORIGIN } });
  assert.equal(res.status, 200);
  await settle();
  const row = await env.DB.prepare('SELECT * FROM subscribers').first();
  assert.equal(row.email, 'ana@exemplo.com.br');
  assert.equal(row.phone, '+5511987654321');
  assert.equal(row.consent_version, CONSENT_VERSION);
  assert.equal(row.source, 'leitura');
  assert.ok(row.synced_at && row.welcomed_at);
  const contact = resend.contacts.get('ana@exemplo.com.br');
  assert.deepEqual(contact.segments, [{ id: 'seg-1' }]);
  assert.equal(contact.first_name, 'Ana');
  assert.equal(contact.phone, undefined, 'o telefone não vai para o Resend');
  assert.equal(resend.emails.length, 1);
  assert.match(resend.emails[0].subject, /Boas-vindas/);
  assert.equal(await env.RADAR.get('resend:segment'), 'seg-1');

  // Segundo cadastro com o mesmo e-mail: atualiza, mantém o telefone e não repete as boas-vindas.
  const again = await call('/api/subscribe', { method: 'POST', body: signup({ name: 'Ana S. Lima' }), headers: { origin: ORIGIN } });
  assert.equal(again.status, 200);
  await settle();
  const updated = await env.DB.prepare('SELECT * FROM subscribers').first();
  assert.equal(updated.name, 'Ana S. Lima');
  assert.equal(updated.phone, '+5511987654321');
  assert.equal(resend.emails.length, 1);
  assert.ok(resend.calls.some((c) => c.method === 'PATCH' && c.path === '/contacts/ana%40exemplo.com.br'));
});

test('cadastro recusa dados inválidos, robô, outra origem e programa de cópia', async () => {
  let res = await call('/api/subscribe', { method: 'POST', body: signup({ consent: false }) });
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /aceite/);
  turnstileOk = false;
  res = await call('/api/subscribe', { method: 'POST', body: signup() });
  assert.equal(res.status, 403);
  turnstileOk = true;
  res = await call('/api/subscribe', { method: 'POST', body: signup(), headers: { origin: 'https://clone.example.com' } });
  assert.equal(res.status, 403);
  res = await call('/api/subscribe', { method: 'POST', body: signup(), headers: { 'user-agent': 'python-requests/2.32' } });
  assert.equal(res.status, 403);
  res = await call('/api/subscribe', { method: 'GET' });
  assert.equal(res.status, 405);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM subscribers').first()).n, 0);
});

test('sem a chave do Resend o cadastro fica guardado e é enviado depois', async () => {
  delete env.RESEND_API_KEY;
  assert.equal((await call('/api/subscribe', { method: 'POST', body: signup() })).status, 200);
  await settle();
  assert.equal(resend.calls.length, 0);
  env.RESEND_API_KEY = 're_test';
  const later = Date.now() + 5 * 60_000;
  assert.deepEqual(await syncSubscribers(env, { now: later }), { synced: 1, failed: 0 });
  assert.ok(resend.contacts.has('ana@exemplo.com.br'));
});

test('falha do Resend fica registrada e tenta de novo na próxima rodada', async () => {
  resend.failContacts = true;
  await call('/api/subscribe', { method: 'POST', body: signup() });
  await settle();
  let row = await env.DB.prepare('SELECT * FROM subscribers').first();
  assert.equal(row.synced_at, null);
  assert.match(row.sync_error, /500/);
  resend.failContacts = false;
  await syncSubscribers(env, { now: Date.now() + 5 * 60_000 });
  row = await env.DB.prepare('SELECT * FROM subscribers').first();
  assert.ok(row.synced_at);
});

// ---------- Notícias da semana e rascunho ----------
const pageData = (now) => ({
  generatedAt: new Date(now).toISOString(),
  columns: [
    { id: 'ia', name: 'Inteligência artificial' },
    { id: 'marketing', name: 'Marketing' },
  ],
  sources: [
    ['tb', { name: 'Tecnoblog' }],
    ['mm', { name: 'Meio & Mensagem' }],
  ],
  items: [
    { id: 'a1', column: 'ia', source: 'tb', title: 'OpenAI lança agentes', url: 'https://tb.example/a1', date: now - 1000, summary: 'Resumo A1', image: 'https://img.example/a1.jpg' },
    { id: 'a2', column: 'ia', source: 'tb', title: 'Nvidia apresenta chip', url: 'https://tb.example/a2', date: now - 2000, summary: '', image: '' },
    { id: 'm1', column: 'marketing', source: 'mm', title: 'Marca X troca de agência', url: 'https://mm.example/m1', date: now - 3000, summary: 'Resumo M1', image: '' },
    { id: 'm2', column: 'marketing', source: 'mm', title: 'Campanha <b>Y</b> & cia', url: 'https://mm.example/m2', date: now - 4000, summary: '', image: '' },
  ],
  trends: [
    { term: 'Agentes de IA', score: 10, ids: ['a1'] },
    { term: 'OpenAI', score: 5, ids: ['a1', 'm1'] },
  ],
});

test('registra as manchetes com o calor dos termos em alta e escolhe as da semana por editoria', async () => {
  const now = Date.now();
  await recordNews(env, pageData(now), now);
  const heat = Object.fromEntries((await env.DB.prepare('SELECT id, heat FROM news').all()).results.map((r) => [r.id, r.heat]));
  assert.deepEqual(heat, { a1: 15, a2: 0, m1: 5, m2: 0 });
  // Nova coleta com menos calor não apaga o maior valor já visto.
  const cooler = pageData(now);
  cooler.trends = [];
  await recordNews(env, cooler, now + 1000);
  assert.equal((await env.DB.prepare("SELECT heat FROM news WHERE id = 'a1'").first()).heat, 15);
  const { candidates } = await weekNews(env, { now: now + 2000, perColumn: 1 });
  assert.deepEqual(candidates.map((c) => c.id), ['a1', 'm1']);
  const old = await weekNews(env, { now: now + 8 * DAY });
  assert.equal(old.candidates.length, 0);
});

test('rascunho semanal: IA escolhe e sugere, e o aviso leva um link de acesso válido', async () => {
  const now = Date.now();
  await recordNews(env, pageData(now), now);
  await env.RADAR.put('page', `<script type="application/json" id="radar-data">${JSON.stringify(pageData(now))}</script>`);
  const prompts = [];
  env.AI = {
    async run(model, input) {
      prompts.push(input);
      const out = {
        subject: 'Agentes de IA dominam a semana',
        preheader: 'E o que isso muda para marcas',
        intro: 'Semana movimentada.',
        items: [
          { id: 'm1', comment: 'Troca de agência diz muito.' },
          { id: 'a1', comment: 'Agentes vão mudar o atendimento.' },
          { id: 'inventado', comment: 'x' },
          { id: 'a2', comment: 'Chip novo.' },
        ],
      };
      return { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(out) }] }] };
    },
  };
  const { edition, created } = await createWeeklyDraft(env, { now });
  assert.equal(created, true);
  assert.equal(edition.status, 'draft');
  assert.equal(edition.id, editionId(now));
  assert.deepEqual(edition.data.items.map((i) => i.id), ['m1', 'a1', 'a2']);
  assert.equal(edition.data.items[0].columnName, 'Marketing');
  assert.equal(edition.data.items[0].source, 'Meio & Mensagem');
  assert.equal(edition.data.items[1].suggestion, 'Agentes vão mudar o atendimento.');
  assert.equal(edition.data.subject, 'Agentes de IA dominam a semana');
  assert.equal(prompts[0].reasoning.effort, 'medium');
  // Aviso por e-mail com link que vale como login.
  const notice = resend.emails.at(-1);
  assert.deepEqual(notice.to, ['clara@example.com']);
  const token = /entrar\?t=([^"&\s<]+)/.exec(notice.html)[1];
  assert.equal((await verifyToken(env.SESSION_SECRET, token, 'login')).e, 'clara@example.com');
  // Sem force, não refaz o rascunho existente.
  const again = await createWeeklyDraft(env, { now });
  assert.equal(again.created, false);
});

test('rascunho sem a IA sai com as notícias mais repercutidas e comentários em branco', async () => {
  const now = Date.now();
  await recordNews(env, pageData(now), now);
  env.AI = {
    async run() {
      throw new Error('limite diário');
    },
  };
  const { edition } = await createWeeklyDraft(env, { now, notify: false });
  assert.equal(edition.data.items[0].id, 'a1');
  assert.ok(edition.data.items.every((i) => i.comment === ''));
  assert.match(edition.data.aiError, /limite/);
});

test('semana ISO e rótulo em português', () => {
  assert.equal(editionId(Date.parse('2026-09-29T12:00:00Z')), '2026-W40');
  assert.equal(editionId(Date.parse('2027-01-01T12:00:00Z')), '2026-W53');
  assert.equal(weekLabel(Date.parse('2026-10-02T12:00:00Z')), 'Semana de 26 de setembro a 2 de outubro de 2026');
  assert.equal(weekLabel(Date.parse('2026-09-25T12:00:00Z')), 'Semana de 19 a 25 de setembro de 2026');
});

// ---------- E-mail ----------
test('e-mail da newsletter escapa o texto e traz o link de descadastro do Resend', () => {
  const { html, text } = renderNewsletter(
    {
      week: 'Semana de 19 a 25 de setembro de 2026',
      subject: 'Assunto',
      intro: 'Oi <script>alert(1)</script>\n\nSegundo parágrafo',
      closing: 'Até,\nClara',
      items: [{ title: 'Campanha <b>Y</b> & cia', url: 'https://mm.example/m2?a=1&b=2', source: 'Meio & Mensagem', columnName: 'Marketing', comment: 'Bom "exemplo"' }],
    },
    { origin: ORIGIN },
  );
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('Campanha &lt;b&gt;Y&lt;/b&gt; &amp; cia'));
  assert.ok(html.includes('https://mm.example/m2?a=1&amp;b=2'));
  assert.ok(html.includes('{{{RESEND_UNSUBSCRIBE_URL}}}'));
  assert.ok(html.includes('Comentário da Clara'));
  assert.ok(html.includes(`${ORIGIN}/assets/favcode-mark-180.png`));
  assert.match(text, /Ler a matéria: https:\/\/mm\.example\/m2/);
});

// ---------- Editor ----------
async function loginCookie() {
  const token = await signToken(env.SESSION_SECRET, { p: 'login', e: 'clara@example.com', x: Date.now() + 60_000 });
  const res = await call(`/editor/entrar?t=${token}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/editor');
  return /radar_editor=[^;]+/.exec(res.headers.get('set-cookie'))[0];
}
const editorHeaders = (cookie) => ({ cookie, 'x-radar-editor': '1' });

test('login do editor: link só para e-mail autorizado, sem revelar quem tem acesso', async () => {
  let res = await call('/api/editor/login', { method: 'POST', body: { email: 'intruso@example.com' }, headers: { 'x-radar-editor': '1' } });
  assert.equal(res.status, 200);
  assert.equal(resend.emails.length, 0);
  res = await call('/api/editor/login', { method: 'POST', body: { email: 'Clara@Example.com' }, headers: { 'x-radar-editor': '1' } });
  assert.equal(res.status, 200);
  assert.equal(resend.emails.length, 1);
  assert.match(resend.emails[0].html, /\/editor\/entrar\?t=/);
  // Sem o cabeçalho do editor (pedido vindo de outro site): recusado.
  res = await call('/api/editor/login', { method: 'POST', body: { email: 'clara@example.com' } });
  assert.equal(res.status, 403);
  // Link falso ou vencido volta para a tela de login.
  res = await call('/editor/entrar?t=abc.def');
  assert.equal(res.headers.get('location'), '/editor?link=expirado');
  const expired = await signToken(env.SESSION_SECRET, { p: 'login', e: 'clara@example.com', x: Date.now() - 1 });
  res = await call(`/editor/entrar?t=${expired}`);
  assert.equal(res.headers.get('location'), '/editor?link=expirado');
  // Sessão não serve como link de login e vice-versa.
  const session = await signToken(env.SESSION_SECRET, { p: 'session', e: 'clara@example.com', x: Date.now() + 60_000 });
  res = await call(`/editor/entrar?t=${session}`);
  assert.equal(res.headers.get('location'), '/editor?link=expirado');
  res = await call('/api/editor/state', { headers: { cookie: `radar_editor=${expired}` } });
  assert.equal(res.status, 401);
});

test('editor: salva o rascunho, envia teste, envia para a lista e não envia duas vezes', async () => {
  const now = Date.now();
  await recordNews(env, pageData(now), now);
  await createWeeklyDraft(env, { now, notify: false });
  const cookie = await loginCookie();

  let res = await call('/api/editor/state', { headers: { cookie } });
  const state = await res.json();
  assert.equal(state.editor, 'clara@example.com');
  const edition = state.edition;
  assert.equal(edition.status, 'draft');

  const data = { ...edition.data, subject: 'Minha semana', intro: 'Abertura da Clara', items: edition.data.items.map((it, i) => ({ ...it, comment: `Comentário ${i}` })) };
  data.items.push({ id: 'x', title: 'Link perigoso', url: 'javascript:alert(1)' });
  res = await call('/api/editor/edition', { method: 'PUT', body: { id: edition.id, data }, headers: editorHeaders(cookie) });
  assert.equal(res.status, 200);
  const saved = JSON.parse((await env.DB.prepare('SELECT data FROM editions').first()).data);
  assert.equal(saved.subject, 'Minha semana');
  assert.ok(!saved.items.some((it) => it.id === 'x'), 'item com link inválido é descartado');

  res = await call('/api/editor/preview', { method: 'POST', body: { id: edition.id, data }, headers: editorHeaders(cookie) });
  assert.match((await res.json()).html, /Abertura da Clara/);

  res = await call('/api/editor/test', { method: 'POST', body: { id: edition.id, data }, headers: editorHeaders(cookie) });
  assert.equal(res.status, 200);
  assert.equal(resend.emails.at(-1).subject, '[Teste] Minha semana');
  assert.deepEqual(resend.emails.at(-1).to, ['clara@example.com']);

  res = await call('/api/editor/send', { method: 'POST', body: { id: edition.id, data }, headers: editorHeaders(cookie) });
  assert.equal(res.status, 200);
  assert.equal(resend.broadcasts.length, 1);
  assert.equal(resend.broadcasts[0].subject, 'Minha semana');
  assert.equal(resend.broadcasts[0].send, true);
  assert.ok(resend.broadcasts[0].html.includes('{{{RESEND_UNSUBSCRIBE_URL}}}'));
  assert.equal((await env.DB.prepare('SELECT status FROM editions').first()).status, 'sent');

  res = await call('/api/editor/send', { method: 'POST', body: { id: edition.id, data }, headers: editorHeaders(cookie) });
  assert.equal(res.status, 409);
  res = await call('/api/editor/edition', { method: 'PUT', body: { id: edition.id, data }, headers: editorHeaders(cookie) });
  assert.equal(res.status, 409);
  assert.equal(resend.broadcasts.length, 1);
});

test('editor: agendamento no futuro e lista de inscritos em CSV sem fórmulas', async () => {
  const now = Date.now();
  await recordNews(env, pageData(now), now);
  await createWeeklyDraft(env, { now, notify: false });
  await call('/api/subscribe', { method: 'POST', body: signup({ name: 'Bia =SOMA(1)', phone: '+55 11 98765-4321' }) });
  await settle();
  const cookie = await loginCookie();
  const { edition } = await (await call('/api/editor/state', { headers: { cookie } })).json();

  let res = await call('/api/editor/send', { method: 'POST', body: { id: edition.id, scheduledAt: new Date(now - 1000).toISOString() }, headers: editorHeaders(cookie) });
  assert.equal(res.status, 422);
  const when = new Date(now + 2 * 3600_000).toISOString();
  res = await call('/api/editor/send', { method: 'POST', body: { id: edition.id, scheduledAt: when }, headers: editorHeaders(cookie) });
  assert.equal((await res.json()).status, 'scheduled');
  assert.equal(resend.broadcasts[0].scheduled_at, when);

  res = await call('/api/editor/inscritos.csv', { headers: { cookie } });
  assert.equal(res.status, 200);
  const csv = await res.text();
  assert.match(csv, /ana@exemplo\.com\.br;Bia =SOMA\(1\);'\+5511987654321/);
  res = await call('/api/editor/inscritos.csv');
  assert.equal(res.status, 401);
});
