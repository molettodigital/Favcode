// Tradução das manchetes em inglês para o português do Brasil.
// Com ANTHROPIC_API_KEY, traduz com o Claude; sem ela, no GitHub Actions, usa a IA da
// Cloudflare pelo Worker do site (POST /api/translate, autenticado com o token OIDC do Actions).
// Cada título + resumo é traduzido uma vez só: o resultado fica em data/translations.json
// e é reaproveitado nas coletas seguintes.

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_MODEL = 'claude-opus-5';
// Precisa ser igual ao TRANSLATE_AUDIENCE de cloudflare/worker.mjs.
export const WORKER_AUDIENCE = 'radar-favcode-translate';
const BATCH_SIZE = 20;
const CONCURRENCY = 2;

export const SYSTEM_PROMPT = `Você traduz manchetes e resumos de notícias do inglês para o português do Brasil. Eles aparecem no Radar FavCode, um radar de notícias de IA, tecnologia, marketing, design, publicidade, redes sociais, e-commerce e startups lido por profissionais brasileiros dessas áreas.

Como traduzir:
- Escreva como a manchete de um bom veículo brasileiro: natural, direta e em caixa de frase (maiúscula só na primeira palavra e em nomes próprios), nunca em Title Case.
- Mantenha como no original os nomes de empresas, produtos, pessoas, campanhas, obras, eventos e marcas.
- Termos que o mercado brasileiro usa em inglês continuam em inglês (branding, creator, retail media, UX, prompt, startup, streaming, podcast).
- Valores em dólar viram "US$" com a escala por extenso e vírgula decimal: "$100M" vira "US$ 100 milhões" e "$1.5B" vira "US$ 1,5 bilhão".
- Não acrescente nem tire informação, não comente e não explique. Resumo vazio continua vazio; resumo que termina em "…" continua terminando em "…".
- Traduza sempre o título e o resumo inteiros: nunca devolva o título em inglês. Só nomes próprios e os termos acima ficam como no original.
- A manchete começa com letra maiúscula, a não ser que comece por um nome que se escreve com minúscula (iPhone, eBay).
- Devolva todos os itens recebidos, cada um com o mesmo id.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['id', 'title', 'summary'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

/** Chave do cache: muda quando o título ou o resumo original mudam. */
export function translationKey(title, summary) {
  return createHash('sha1').update(`${title}\u0000${summary}`).digest('hex').slice(0, 16);
}

export async function loadCache(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return data && typeof data.entries === 'object' ? data.entries : {};
  } catch {
    return {};
  }
}

/** Grava só as traduções em uso, para o arquivo não crescer sem limite. */
export async function saveCache(file, entries) {
  const sorted = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ version: 1, entries: sorted }, null, 1)}\n`);
}

/** Parâmetros que dependem do modelo escolhido em RADAR_TRANSLATION_MODEL. */
export function requestOptions(model) {
  const format = { type: 'json_schema', schema: OUTPUT_SCHEMA };
  // Haiku não aceita "effort"; tradução é tarefa simples, então os demais usam esforço baixo.
  const options = { output_config: model.includes('haiku') ? { format } : { effort: 'low', format } };
  if (/^claude-(opus-5|fable-5)/.test(model)) {
    // Se o modelo recusar o pedido, a API refaz com o modelo reserva recomendado.
    options.betas = ['server-side-fallback-2026-07-01'];
    options.fallbacks = 'default';
  }
  return options;
}

/**
 * Traduz um lote. Devolve Map(id -> { title, summary }) só com o que voltou completo.
 * `client` é um cliente do SDK da Anthropic (ou um substituto com a mesma forma, nos testes).
 */
export async function translateBatch(client, batch, { model = DEFAULT_MODEL } = {}) {
  const response = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    ...requestOptions(model),
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Traduza estes itens:\n${JSON.stringify(batch.map(({ id, title, summary }) => ({ id, title, summary })))}`,
      },
    ],
  });

  if (response.stop_reason !== 'end_turn') {
    throw new Error(`resposta incompleta (${response.stop_reason})`);
  }
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  return collectTranslations(batch, JSON.parse(text).items);
}

const EN_WORDS = new Set('the and of to in an it with for its is are was how why what when who which from on at by after over into inside behind your you we they this that these those new now not but all out up most gets get launches takes reveals finds says will can could should about more than their our has have had be been just'.split(' '));
const PT_WORDS = new Set('de da do das dos para com que em uma um não na no nas nos ao aos à às pela pelo pelas pelos sobre como mais é são foi seu sua seus suas ou entre após já também até'.split(' '));
const words = (text) => String(text || '').toLowerCase().match(/[\p{L}’']+/gu) || [];
const normalize = (text) => words(text).join(' ');

/**
 * O modelo às vezes devolve o título em inglês (igual ao original ou quase) e traduz só o resumo.
 * Conta como não traduzido: título igual ao original com alguma palavra inglesa comum ou com
 * quatro palavras ou mais (nomes curtos, como "Figma Config 2026", podem ficar iguais), ou título
 * com mais palavras inglesas comuns que portuguesas.
 */
export function untranslated(original, translated) {
  const list = words(translated);
  const en = list.filter((w) => EN_WORDS.has(w)).length;
  const pt = list.filter((w) => PT_WORDS.has(w)).length;
  if (normalize(original) === normalize(translated) && (en >= 1 || list.length >= 4)) return true;
  return en >= 2 && en > pt;
}

/** Devolve a maiúscula inicial que o modelo às vezes tira ("wayfair aumenta…"). */
export function fixInitial(original, translated) {
  const first = translated.charAt(0);
  const originalFirst = String(original || '').trim().charAt(0);
  if (first && first === first.toLocaleLowerCase('pt-BR') && originalFirst && originalFirst !== originalFirst.toLocaleLowerCase('en')) {
    return first.toLocaleUpperCase('pt-BR') + translated.slice(1);
  }
  return translated;
}

/** Map(id -> { title, summary }) com os itens do lote que voltaram com título traduzido. */
export function collectTranslations(batch, returned) {
  const wanted = new Map(batch.map((it) => [it.id, it]));
  const out = new Map();
  for (const item of returned || []) {
    const original = wanted.get(item?.id);
    const title = String(item?.title || '').trim();
    if (!original || !title || untranslated(original.title, title)) continue;
    out.set(item.id, { title: fixInitial(original.title, title), summary: original.summary ? String(item.summary || '').trim() : '' });
  }
  return out;
}

/** Token OIDC do GitHub Actions (exige `permissions: id-token: write` no workflow). */
export async function githubOidcToken(audience, { env = process.env, fetchImpl = fetch } = {}) {
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const token = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !token) throw new Error('token OIDC indisponível (rodando fora do GitHub Actions?)');
  const res = await fetchImpl(`${url}&audience=${encodeURIComponent(audience)}`, {
    headers: { authorization: `bearer ${token}`, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status} ao emitir o token OIDC`);
  return (await res.json()).value;
}

/** Tradutor que usa o Worker do site (Workers AI). Cada lote pede um token OIDC novo. */
export function workerTranslator(endpoint, { getToken = () => githubOidcToken(WORKER_AUDIENCE), fetchImpl = fetch } = {}) {
  return async (batch) => {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await getToken()}`,
        'user-agent': 'radar-favcode-build',
      },
      body: JSON.stringify({ system: SYSTEM_PROMPT, items: batch.map(({ id, title, summary }) => ({ id, title, summary })) }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`tradutor respondeu ${res.status}: ${body.slice(0, 200)}`);
    return collectTranslations(batch, JSON.parse(body).items);
  };
}

/**
 * Deixa todas as manchetes em português. As que estão em inglês usam a tradução guardada
 * ou são traduzidas agora; as que não puderem ser traduzidas saem do radar.
 * @returns {Promise<{ items: object[], stats: { cached: number, translated: number, dropped: number, failures: string[] } }>}
 */
export async function translateItems(items, { client, translator, cacheFile, model = DEFAULT_MODEL, log = () => {} }) {
  const translate = translator || (client ? (batch) => translateBatch(client, batch, { model }) : null);
  const cache = await loadCache(cacheFile);
  const used = {};
  const stats = { cached: 0, translated: 0, dropped: 0, failures: [] };
  const pending = [];

  for (const item of items) {
    if (item.lang !== 'en') continue;
    const key = translationKey(item.title, item.summary);
    item.translationKey = key;
    if (cache[key] && !untranslated(item.title, cache[key].t)) {
      used[key] = { ...cache[key], t: fixInitial(item.title, cache[key].t) };
      stats.cached++;
    } else {
      pending.push(item);
    }
  }

  if (pending.length && translate) {
    await runBatches(pending, translate, used, stats);
    // O que voltou sem tradução (título em inglês, item faltando) tem mais uma chance, em lotes menores.
    const missing = pending.filter((item) => !used[item.translationKey]);
    if (missing.length) await runBatches(missing, translate, used, stats, Math.ceil(BATCH_SIZE / 2));
    stats.retried = missing.length;
  } else if (pending.length) {
    log(`Sem tradutor disponível: ${pending.length} manchetes em inglês sem tradução guardada ficaram de fora.`);
  }

  const out = [];
  for (const item of items) {
    const key = item.translationKey;
    delete item.translationKey;
    if (item.lang !== 'en') {
      out.push(item);
      continue;
    }
    const entry = used[key];
    if (!entry) {
      stats.dropped++;
      continue;
    }
    out.push({ ...item, title: entry.t, summary: item.summary ? entry.s : '' });
  }

  await saveCache(cacheFile, used);
  return { items: out, stats };
}

/** Traduz em lotes, com até CONCURRENCY pedidos ao mesmo tempo; guarda em `used` o que voltou traduzido. */
async function runBatches(pending, translate, used, stats, size = BATCH_SIZE) {
  const batches = [];
  for (let i = 0; i < pending.length; i += size) batches.push(pending.slice(i, i + size));
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      try {
        const result = await translate(batch);
        for (const item of batch) {
          const done = result.get(item.id);
          if (!done) continue;
          used[item.translationKey] = { t: done.title, s: done.summary };
          stats.translated++;
        }
      } catch (err) {
        stats.failures.push(err?.message || String(err));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
}
