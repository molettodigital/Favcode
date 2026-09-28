import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { githubOidcToken, requestOptions, SYSTEM_PROMPT, translateItems, translationKey, WORKER_AUDIENCE, workerTranslator } from '../scripts/lib/translate.mjs';

const tmpCache = async () => path.join(await mkdtemp(path.join(os.tmpdir(), 'radar-')), 'translations.json');

const en = (id, title, summary = '') => ({ id, title, summary, lang: 'en', column: 'ia', source: 'x', date: 1 });
const pt = (id, title) => ({ id, title, summary: '', lang: 'pt', column: 'ia', source: 'y', date: 1 });

/** Cliente falso com a mesma forma do SDK: responde traduzindo com um dicionário. */
function fakeClient(dictionary, { stopReason = 'end_turn', fail = false } = {}) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        async create(params) {
          calls.push(params);
          if (fail) throw new Error('529 overloaded');
          const input = JSON.parse(params.messages[0].content.split('\n').slice(1).join('\n'));
          const items = input.map((it) => ({ id: it.id, title: dictionary[it.title] ?? '', summary: dictionary[it.summary] ?? '' }));
          return { stop_reason: stopReason, content: [{ type: 'text', text: JSON.stringify({ items }) }] };
        },
      },
    },
  };
}

test('usa a tradução guardada sem chamar a API', async () => {
  const cacheFile = await tmpCache();
  const key = translationKey('OpenAI ships agents', 'It is here.');
  await writeFile(cacheFile, JSON.stringify({ version: 1, entries: { [key]: { t: 'OpenAI lança agentes', s: 'Chegou.' } } }));
  const client = fakeClient({});
  const { items, stats } = await translateItems([en('1', 'OpenAI ships agents', 'It is here.'), pt('2', 'Notícia em português')], { client, cacheFile });
  assert.equal(client.calls.length, 0);
  assert.deepEqual(items.map((it) => it.title), ['OpenAI lança agentes', 'Notícia em português']);
  assert.equal(items[0].summary, 'Chegou.');
  assert.equal(stats.cached, 1);
});

test('traduz o que falta com claude-opus-5, JSON estruturado e fallback, e guarda no cache', async () => {
  const cacheFile = await tmpCache();
  const client = fakeClient({ 'TikTok raises $100M': 'TikTok capta US$ 100 milhões', 'Big round.': 'Rodada grande.' });
  const { items, stats } = await translateItems([en('1', 'TikTok raises $100M', 'Big round.')], { client, cacheFile });
  assert.equal(items[0].title, 'TikTok capta US$ 100 milhões');
  assert.equal(items[0].summary, 'Rodada grande.');
  assert.equal(items[0].lang, 'en', 'continua marcado como original em inglês');
  assert.equal(stats.translated, 1);

  const [params] = client.calls;
  assert.equal(params.model, 'claude-opus-5');
  assert.equal(params.fallbacks, 'default');
  assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(params.output_config.effort, 'low');
  assert.equal(params.output_config.format.type, 'json_schema');

  const saved = JSON.parse(await readFile(cacheFile, 'utf8'));
  assert.deepEqual(Object.values(saved.entries), [{ t: 'TikTok capta US$ 100 milhões', s: 'Rodada grande.' }]);
});

test('sem chave, sem tradução ou com falha da API: a manchete em inglês sai do radar', async () => {
  const base = [en('1', 'Untranslated headline'), pt('2', 'Fica')];

  const noKey = await translateItems(base.map((it) => ({ ...it })), { client: null, cacheFile: await tmpCache() });
  assert.deepEqual(noKey.items.map((it) => it.id), ['2']);
  assert.equal(noKey.stats.dropped, 1);

  const failing = await translateItems(base.map((it) => ({ ...it })), { client: fakeClient({}, { fail: true }), cacheFile: await tmpCache() });
  assert.deepEqual(failing.items.map((it) => it.id), ['2']);
  assert.equal(failing.stats.failures.length, 1);

  const refused = await translateItems(base.map((it) => ({ ...it })), { client: fakeClient({ 'Untranslated headline': 'x' }, { stopReason: 'refusal' }), cacheFile: await tmpCache() });
  assert.deepEqual(refused.items.map((it) => it.id), ['2']);
});

test('o cache guarda só as traduções em uso', async () => {
  const cacheFile = await tmpCache();
  const keep = translationKey('Kept', '');
  await writeFile(cacheFile, JSON.stringify({ version: 1, entries: { [keep]: { t: 'Mantida', s: '' }, old: { t: 'Velha', s: '' } } }));
  await translateItems([en('1', 'Kept')], { client: null, cacheFile });
  const saved = JSON.parse(await readFile(cacheFile, 'utf8'));
  assert.deepEqual(Object.keys(saved.entries), [keep]);
});

test('parâmetros se ajustam ao modelo escolhido', () => {
  const haiku = requestOptions('claude-haiku-4-5');
  assert.equal(haiku.output_config.effort, undefined);
  assert.equal(haiku.fallbacks, undefined);
  assert.equal(haiku.output_config.format.type, 'json_schema');
  assert.equal(requestOptions('claude-sonnet-5').fallbacks, undefined);
  assert.equal(requestOptions('claude-sonnet-5').output_config.effort, 'low');
  assert.equal(requestOptions('claude-opus-5').fallbacks, 'default');
});

test('sem chave da Anthropic, traduz pelo Worker com o token OIDC do Actions', async () => {
  const cacheFile = await tmpCache();
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    const sent = JSON.parse(init.body).items;
    // O Worker devolve só o que traduziu; um id desconhecido é ignorado.
    return Response.json({ items: [{ id: sent[0].id, title: 'OpenAI lança agentes', summary: 'Chegou.' }, { id: 'intruso', title: 'x', summary: '' }] });
  };
  const translator = workerTranslator('https://radar.test/api/translate', { getToken: async () => 'tok-123', fetchImpl });
  const { items, stats } = await translateItems([en('1', 'OpenAI ships agents', 'It is here.'), en('2', 'Untranslated')], { translator, cacheFile });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://radar.test/api/translate');
  assert.equal(requests[0].init.headers.authorization, 'Bearer tok-123');
  assert.equal(requests[0].body.system, SYSTEM_PROMPT);
  assert.deepEqual(requests[0].body.items.map((it) => it.id), ['1', '2']);
  assert.deepEqual(items.map((it) => it.title), ['OpenAI lança agentes']);
  assert.deepEqual(stats, { cached: 0, translated: 1, dropped: 1, failures: [] });
  const saved = JSON.parse(await readFile(cacheFile, 'utf8')).entries;
  assert.deepEqual(Object.values(saved), [{ t: 'OpenAI lança agentes', s: 'Chegou.' }]);
});

test('erro do Worker: o lote fica de fora e a falha é registrada', async () => {
  const cacheFile = await tmpCache();
  const fetchImpl = async () => new Response('{"error":"token do GitHub Actions inválido"}', { status: 401 });
  const translator = workerTranslator('https://radar.test/api/translate', { getToken: async () => 'x', fetchImpl });
  const { items, stats } = await translateItems([en('1', 'OpenAI ships agents'), pt('2', 'Em português')], { translator, cacheFile });
  assert.deepEqual(items.map((it) => it.id), ['2']);
  assert.equal(stats.dropped, 1);
  assert.match(stats.failures[0], /401/);
});

test('token OIDC pedido ao GitHub com o público do Worker', async () => {
  let asked;
  const fetchImpl = async (url, init) => {
    asked = { url, auth: init.headers.authorization };
    return Response.json({ value: 'jwt' });
  };
  const env = { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://gh.test/token?api-version=2.0', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'req' };
  assert.equal(await githubOidcToken(WORKER_AUDIENCE, { env, fetchImpl }), 'jwt');
  assert.equal(asked.url, 'https://gh.test/token?api-version=2.0&audience=radar-favcode-translate');
  assert.equal(asked.auth, 'bearer req');
  await assert.rejects(githubOidcToken(WORKER_AUDIENCE, { env: {}, fetchImpl }), /fora do GitHub Actions/);
});
