// Tradução das manchetes em inglês para o português do Brasil, feita com o Claude.
// Cada título + resumo é traduzido uma vez só: o resultado fica em data/translations.json
// e é reaproveitado nas coletas seguintes.

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_MODEL = 'claude-opus-5';
const BATCH_SIZE = 20;
const CONCURRENCY = 2;

export const SYSTEM_PROMPT = `Você traduz manchetes e resumos de notícias do inglês para o português do Brasil. Eles aparecem no Radar FavCode, um radar de notícias de IA, tecnologia, marketing, design, publicidade, redes sociais, e-commerce e startups lido por profissionais brasileiros dessas áreas.

Como traduzir:
- Escreva como a manchete de um bom veículo brasileiro: natural, direta e em caixa de frase (maiúscula só na primeira palavra e em nomes próprios), nunca em Title Case.
- Mantenha como no original os nomes de empresas, produtos, pessoas, campanhas, obras, eventos e marcas.
- Termos que o mercado brasileiro usa em inglês continuam em inglês (branding, creator, retail media, UX, prompt, startup, streaming, podcast).
- Valores em dólar viram "US$" com a escala por extenso e vírgula decimal: "$100M" vira "US$ 100 milhões" e "$1.5B" vira "US$ 1,5 bilhão".
- Não acrescente nem tire informação, não comente e não explique. Resumo vazio continua vazio; resumo que termina em "…" continua terminando em "…".
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
  const parsed = JSON.parse(text);
  const wanted = new Map(batch.map((it) => [it.id, it]));
  const out = new Map();
  for (const item of parsed.items || []) {
    const original = wanted.get(item.id);
    const title = String(item.title || '').trim();
    if (!original || !title) continue;
    out.set(item.id, { title, summary: original.summary ? String(item.summary || '').trim() : '' });
  }
  return out;
}

/**
 * Deixa todas as manchetes em português. As que estão em inglês usam a tradução guardada
 * ou são traduzidas agora; as que não puderem ser traduzidas saem do radar.
 * @returns {Promise<{ items: object[], stats: { cached: number, translated: number, dropped: number, failures: string[] } }>}
 */
export async function translateItems(items, { client, cacheFile, model = DEFAULT_MODEL, log = () => {} }) {
  const cache = await loadCache(cacheFile);
  const used = {};
  const stats = { cached: 0, translated: 0, dropped: 0, failures: [] };
  const pending = [];

  for (const item of items) {
    if (item.lang !== 'en') continue;
    const key = translationKey(item.title, item.summary);
    item.translationKey = key;
    if (cache[key]) {
      used[key] = cache[key];
      stats.cached++;
    } else {
      pending.push(item);
    }
  }

  if (pending.length && client) {
    const batches = [];
    for (let i = 0; i < pending.length; i += BATCH_SIZE) batches.push(pending.slice(i, i + BATCH_SIZE));
    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        try {
          const result = await translateBatch(client, batch, { model });
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
  } else if (pending.length) {
    log(`Sem ANTHROPIC_API_KEY: ${pending.length} manchetes em inglês sem tradução guardada ficaram de fora.`);
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
