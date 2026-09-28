// "Em alta": termos que aparecem em mais manchetes e mais fontes nas últimas horas.
// Combina a lista monitorada (config) com nomes próprios detectados nos títulos.

const STOPWORDS = new Set(
  `a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela pelos pelas para pra com sem sobre como que qual quais
  quem onde quando porque e ou mas se seu sua seus suas este esta estes estas esse essa esses essas isso isto aquele aquela aqui agora
  hoje ontem amanhã novo nova novos novas mais menos muito muita muitos todos todas tudo já ainda pode podem vai vão ser ter é são foi
  foram após até entre contra diz dizem afirma anuncia anunciam lança lançam chega chegam ganha ganham quer querem veja confira saiba
  entenda descubra conheça saiu sai tem têm há dia dias semana mês ano anos vez vezes além também só sim não nem cada outro outra
  the a an and or but of in on at to for with without from by as is are was were be been how why what when where who which this that
  these those it its your you we our they their he she his her new now here today just more most best top can will should would could
  after before over into up out not no yes all every first last week day year month vs via per inside behind about amid says said
  announces launches unveils gets adds brings makes takes wants report reports exclusive update updates watch read listen live
  janeiro fevereiro março abril maio junho julho agosto setembro outubro novembro dezembro segunda terça quarta quinta sexta sábado domingo
  january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday`
    .split(/\s+/)
    .filter(Boolean),
);

const HOUR = 3_600_000;

const isCapitalized = (tok) => /^[\p{Lu}]/u.test(tok);
// iPhone, eBay, OpenAI, ChatGPT, TikTok, LGPD, NBA
const isDistinctive = (tok) => /^[\p{Ll}]+[\p{Lu}]/u.test(tok) || /^[\p{Lu}][\p{L}\d]*[\p{Lu}][\p{L}\d]*$/u.test(tok);

function tokenize(title) {
  const tokens = [];
  for (const raw of title.split(/\s+/)) {
    const breakAfter = /[:;,.!?)\]”"’'…—–|]$/.test(raw);
    const tok = raw.replace(/^[\s"“”'‘’([{«¿¡#@]+|[\s"“”'‘’)\]}»:;,.!?…—–|]+$/g, '').replace(/['’]s$/i, '');
    tokens.push({ text: tok, breakAfter: breakAfter || tok === '' });
  }
  return tokens;
}

function capitalRatio(titles) {
  let words = 0;
  let caps = 0;
  for (const title of titles) {
    tokenize(title)
      .slice(1)
      .forEach((t) => {
        if (t.text.length > 3 && /^\p{L}/u.test(t.text) && !STOPWORDS.has(t.text.toLowerCase())) {
          words++;
          if (isCapitalized(t.text)) caps++;
        }
      });
  }
  return { words, ratio: words ? caps / words : 0 };
}

/** Title Case ("Why Every Designer Should Learn") não permite achar nomes próprios pela maiúscula. */
export function looksTitleCase(titles, minWords = 12) {
  const { words, ratio } = capitalRatio(titles);
  return words >= minWords && ratio > 0.6;
}

/**
 * Nomes próprios de um título (sequências de 1 a 3 palavras capitalizadas).
 * @param {object} [opts]
 * @param {boolean} [opts.titleCase] a fonte escreve títulos em Title Case (só marcas tipo "iPhone" contam)
 * @param {Set<string>} [opts.known] nomes já vistos no meio de outros títulos (valem também na 1ª palavra)
 */
export function extractProperNouns(title, { titleCase, known } = {}) {
  const tokens = tokenize(title);
  const isTitleCase = titleCase ?? looksTitleCase([title], 3);
  const found = new Set();
  let run = [];

  const flush = () => {
    if (run.length) {
      const words = run.slice(0, 3);
      if (!isTitleCase || words.every(isDistinctive)) found.add(words.join(' '));
      if (words.length > 1) for (const w of words) if (isDistinctive(w) || (known && known.has(w))) found.add(w);
    }
    run = [];
  };

  tokens.forEach((t, i) => {
    const tok = t.text;
    const usable =
      tok.length >= 2 &&
      // Só letras e números (evita "R$", "US$", "#1"), com pelo menos duas letras.
      /^[\p{L}\d][\p{L}\d.+&'’-]*$/u.test(tok) &&
      (tok.match(/\p{L}/gu) || []).length >= 2 &&
      (isCapitalized(tok) || isDistinctive(tok)) &&
      !STOPWORDS.has(tok.toLowerCase()) &&
      !/^\d/.test(tok) &&
      // A primeira palavra é maiúscula por gramática: só conta se for "marca" ou nome já conhecido.
      (i > 0 || isDistinctive(tok) || Boolean(known && known.has(tok)));
    if (usable) run.push(tok);
    else flush();
    if (t.breakAfter) flush();
  });
  flush();
  return [...found];
}

/** Palavras capitalizadas no meio de títulos em caixa normal: nomes próprios quase certos. */
function knownProperNouns(items, titleCaseSources) {
  const known = new Set();
  for (const it of items) {
    if (titleCaseSources.has(it.source)) continue;
    tokenize(it.title)
      .slice(1)
      .forEach((t) => {
        if (t.text.length >= 2 && (isCapitalized(t.text) || isDistinctive(t.text)) && !STOPWORDS.has(t.text.toLowerCase())) known.add(t.text);
      });
  }
  return known;
}

function recencyWeight(date, now) {
  const age = now - date;
  if (age < 12 * HOUR) return 1.6;
  if (age < 24 * HOUR) return 1.3;
  return 1;
}

/**
 * @param {Array<{id, title, source, column, date}>} items
 * @returns {Array<{term, count, sources, column, score, ids}>}
 */
export function computeTrends(items, { watchlist = [], stoplist = [], blocklist = [], columns = [], now = Date.now(), limit = 12 } = {}) {
  let pool = items.filter((it) => now - it.date <= 48 * HOUR);
  if (pool.length < 60) pool = items.filter((it) => now - it.date <= 96 * HOUR);
  if (pool.length < 60) pool = items;

  const stop = new Set(stoplist.map((s) => s.toLowerCase()));
  const titlesBySource = new Map();
  for (const it of items) {
    if (!titlesBySource.has(it.source)) titlesBySource.set(it.source, []);
    titlesBySource.get(it.source).push(it.title);
  }
  const titleCaseSources = new Set([...titlesBySource].filter(([, titles]) => looksTitleCase(titles)).map(([id]) => id));
  const known = knownProperNouns(pool, titleCaseSources);
  const candidates = new Map();
  const add = (term, item, fromWatchlist) => {
    let entry = candidates.get(term);
    if (!entry) {
      entry = { term, items: new Map(), sources: new Set(), fromWatchlist };
      candidates.set(term, entry);
    }
    entry.items.set(item.id, item);
    entry.sources.add(item.source);
  };

  for (const item of pool) {
    for (const w of watchlist) {
      w.match.lastIndex = 0;
      if (w.match.test(item.title)) add(w.label, item, true);
    }
    for (const noun of extractProperNouns(item.title, { titleCase: titleCaseSources.has(item.source), known })) {
      if (stop.has(noun.toLowerCase())) continue;
      if (blocklist.some((re) => re.test(noun))) continue;
      // Já coberto por um termo monitorado (ex.: "OpenAI" → OpenAI).
      if (watchlist.some((w) => w.match.test(noun))) continue;
      add(noun, item, false);
    }
  }

  const columnOrder = new Map(columns.map((c, i) => [c.id, i]));
  const scored = [];
  for (const entry of candidates.values()) {
    const count = entry.items.size;
    const sources = entry.sources.size;
    const minCount = entry.fromWatchlist ? 2 : 3;
    if (count < minCount || sources < 2) continue;
    let score = sources * 1.2;
    const perColumn = new Map();
    for (const it of entry.items.values()) {
      score += recencyWeight(it.date, now);
      perColumn.set(it.column, (perColumn.get(it.column) || 0) + 1);
    }
    const column = [...perColumn.entries()].sort((a, b) => b[1] - a[1] || (columnOrder.get(a[0]) ?? 99) - (columnOrder.get(b[0]) ?? 99))[0][0];
    scored.push({ ...entry, count, sourcesCount: sources, column, score });
  }
  scored.sort((a, b) => b.score - a.score || b.sourcesCount - a.sourcesCount);

  // Evita dois termos que falam das mesmas manchetes (ex.: "Apple" e "iPhone 18").
  const selected = [];
  for (const cand of scored) {
    const ids = new Set(cand.items.keys());
    const redundant = selected.some((s) => {
      let shared = 0;
      for (const id of ids) if (s.idSet.has(id)) shared++;
      return shared / Math.min(ids.size, s.idSet.size) >= 0.8;
    });
    if (redundant) continue;
    selected.push({ ...cand, idSet: ids });
    if (selected.length >= limit) break;
  }

  return selected.map((s) => ({
    term: s.term,
    count: s.count,
    sources: s.sourcesCount,
    column: s.column,
    score: Math.round(s.score * 10) / 10,
    ids: [...s.items.values()].sort((a, b) => b.date - a.date).map((it) => it.id),
  }));
}
