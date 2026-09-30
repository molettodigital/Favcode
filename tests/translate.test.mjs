import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { collectTranslations, fixInitial, githubOidcToken, requestOptions, saveCache, SYSTEM_PROMPT, translateItems, translationKey, untranslated, WORKER_AUDIENCE, workerTranslator } from '../scripts/lib/translate.mjs';

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
  assert.equal(failing.stats.failures.length, 2, 'falha na primeira tentativa e na nova tentativa');

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
    const known = sent.filter((it) => it.id === '1').map((it) => ({ id: it.id, title: 'OpenAI lança agentes', summary: 'Chegou.' }));
    return Response.json({ items: [...known, { id: 'intruso', title: 'x', summary: '' }] });
  };
  const translator = workerTranslator('https://radar.test/api/translate', { getToken: async () => 'tok-123', fetchImpl });
  const { items, stats } = await translateItems([en('1', 'OpenAI ships agents', 'It is here.'), en('2', 'Untranslated')], { translator, cacheFile });

  // O item que não voltou traduzido ganha uma nova tentativa, sozinho.
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].body.items.map((it) => it.id), ['2']);
  assert.equal(requests[0].url, 'https://radar.test/api/translate');
  assert.equal(requests[0].init.headers.authorization, 'Bearer tok-123');
  assert.equal(requests[0].body.system, SYSTEM_PROMPT);
  assert.deepEqual(requests[0].body.items.map((it) => it.id), ['1', '2']);
  assert.deepEqual(items.map((it) => it.title), ['OpenAI lança agentes']);
  assert.deepEqual(stats, { cached: 0, translated: 1, dropped: 1, failures: [], retried: 1 });
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

test('título que volta em inglês não vale: tenta de novo e, se continuar, a manchete sai', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'radar-tr-'));
  const cacheFile = path.join(dir, 'translations.json');
  const items = [
    { id: 'a', lang: 'en', title: 'OpenAI launches Dots, its Muse competitor', summary: 'OpenAI is answering Meta.' },
    { id: 'b', lang: 'en', title: 'Wayfair ups sports spend', summary: '' },
    { id: 'c', lang: 'en', title: 'America gets a chatbot', summary: 'The federal government has a chatbot.' },
  ];
  const calls = [];
  const translator = async (batch) => {
    calls.push(batch.map((it) => it.id));
    const round = calls.length;
    return collectTranslations(batch, batch.map((it) => ({
      id: it.id,
      // 'a' só sai traduzido na segunda tentativa; 'c' continua em inglês; 'b' vem sem a maiúscula.
      title: it.id === 'a' ? (round === 1 ? it.title : 'OpenAI lança Dots, rival do Muse') : it.id === 'b' ? 'wayfair aumenta gasto com esportes' : it.title,
      summary: it.summary ? 'Resumo traduzido.' : '',
    })));
  };
  const { items: out, stats } = await translateItems(items.map((it) => ({ ...it })), { translator, cacheFile });
  assert.deepEqual(out.map((it) => [it.id, it.title]), [['a', 'OpenAI lança Dots, rival do Muse'], ['b', 'Wayfair aumenta gasto com esportes']]);
  assert.deepEqual(calls, [['a', 'b', 'c'], ['a', 'c']]);
  assert.equal(stats.dropped, 1);
  assert.equal(stats.retried, 2);
});

test('tradução guardada que ficou em inglês é refeita', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'radar-tr-'));
  const cacheFile = path.join(dir, 'translations.json');
  const item = { id: 'a', lang: 'en', title: 'Here’s why OpenAI is absent from Nvidia’s effort', summary: '' };
  await saveCache(cacheFile, { [translationKey(item.title, item.summary)]: { t: item.title, s: '' } });
  let called = 0;
  const translator = async (batch) => {
    called++;
    return collectTranslations(batch, [{ id: 'a', title: 'Por que a OpenAI está fora da iniciativa da Nvidia', summary: '' }]);
  };
  const { items: out, stats } = await translateItems([{ ...item }], { translator, cacheFile });
  assert.equal(called, 1);
  assert.equal(stats.cached, 0);
  assert.equal(out[0].title, 'Por que a OpenAI está fora da iniciativa da Nvidia');
});

test('reconhece título não traduzido sem barrar nomes próprios nem títulos em português', () => {
  assert.equal(untranslated('Patreon and Tabletop Gamers Roll Big With Ginormous D20 Die', 'Patreon and Tabletop Gamers Roll Big With Ginormous D20 Die'), true);
  assert.equal(untranslated('es devlin’s rotating library holds 2,000 books inside london’s design museum', 'es devlin’s rotating library holds 2,000 books inside london’s design museum'), true);
  assert.equal(untranslated('Trust As A Conversion Lever: How To Test Credibility', 'Trust As A Conversion Lever: How To Test Credibility'), true);
  assert.equal(untranslated('Figma Config 2026', 'Figma Config 2026'), false);
  assert.equal(untranslated('Lyle Yetman values the quiet before the storm', 'Lyle Yetman, da McKinney, valoriza ‘the quiet before the storm’ ao se preparar para um pitch'), false);
  assert.equal(untranslated('OpenAI launches Dots', 'OpenAI lança Dots, agentes que trabalham sozinhos'), false);
  assert.equal(fixInitial('Wayfair ups spend', 'wayfair aumenta'), 'Wayfair aumenta');
  assert.equal(fixInitial('iPhone 18 leaks', 'iPhone 18 vaza'), 'iPhone 18 vaza');
  assert.equal(fixInitial('TikTok wants creators to see green', 'Tiktok quer que creators vejam verde'), 'TikTok quer que creators vejam verde');
  assert.equal(fixInitial('Twitch uses AI to find streamers', 'Twitch usa ia para descobrir streamers'), 'Twitch usa IA para descobrir streamers');
  assert.equal(fixInitial('Apple ships iOS 27.2', 'Apple libera ios 27.2'), 'Apple libera iOS 27.2');
  assert.equal(fixInitial('He was going home', 'Ele ia para casa'), 'Ele ia para casa');
  assert.equal(fixInitial('Sam Altman says OpenAI will not go public', 'Sam altman diz que OpenAI não abrirá capital'), 'Sam Altman diz que OpenAI não abrirá capital');
  assert.equal(fixInitial("Internet thinks Elon Musk's xAI trolled OpenAI", 'Internet acredita que xAI de elon musk trollou a OpenAI'), 'Internet acredita que xAI de Elon Musk trollou a OpenAI');
  assert.equal(fixInitial('Meta misses its target', 'Meta não bate a meta'), 'Meta não bate a meta');
});
