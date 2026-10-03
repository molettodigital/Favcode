// Cloudflare Worker que publica o Radar FavCode.
// © FavCode. Todos os direitos reservados.
//
// A cada 15 minutos busca o index.html mais recente no GitHub e guarda no KV;
// os visitantes recebem sempre a cópia guardada, mesmo que o GitHub esteja fora do ar.
//
// Também dispara a coleta no GitHub Actions uma vez por hora, porque o agendamento do
// próprio GitHub atrasa ou pula horários. Só funciona com o segredo GITHUB_TOKEN cadastrado.
//
// Tradução: POST /api/translate traduz lotes de manchetes com a IA da Cloudflare (Workers AI).
// Só atende o GitHub Actions deste repositório, que se identifica com um token OIDC assinado
// pelo GitHub; não há senha guardada em lugar nenhum.
//
// Newsletter: cadastro (POST /api/subscribe) guardado no D1 e enviado ao Resend, política de
// privacidade (/privacidade), registro das notícias da semana, rascunho semanal com sugestões da
// IA (sexta, 6h45), envio automático para a lista (sexta, 9h) e o editor da newsletter (/editor). Código em cloudflare/newsletter/.
//
// Proteção contra cópia: bloqueia programas de clonagem, raspadores e robôs de IA,
// proíbe abrir o site dentro de outro (iframe), impede que outros sites usem as fontes e
// o logo e, com o binding LIMITER, limita o número de acessos por IP.
//
// Bindings: RADAR (KV namespace), SOURCE (raiz "raw" do repositório), GITHUB_REPO (dono/repo),
// AI (Workers AI, para a tradução) e, opcionais, GITHUB_TOKEN (segredo; Contents: Read e
// Actions: Read and write — com ele o repositório pode ser privado), LIMITER (rate limit) e
// CANONICAL_ORIGIN (endereço oficial, ex.: https://radar.favcode.com.br; o endereço
// .workers.dev passa a redirecionar para ele).
// Newsletter: DB (D1), FORM_LIMITER (rate limit do formulário), TURNSTILE_SECRET, SESSION_SECRET,
// RESEND_API_KEY (segredos), EDITOR_EMAILS, NEWSLETTER_FROM e NEWSLETTER_REPLY_TO (texto).

import { AI_MODEL, runJson } from './lib/ai.mjs';
import { json } from './lib/util.mjs';
import { weeklyNewsletter } from './newsletter/draft.mjs';
import { handleEditor } from './newsletter/editor.mjs';
import { cleanupNews, extractPageData, recordNews } from './newsletter/news.mjs';
import { handleSubscribe, syncSubscribers } from './newsletter/subscribe.mjs';

const PAGE_KEY = 'page';
const PAGE_VERSION_KEY = 'page:generatedAt';
const PAGE_CRON = '*/15 * * * *'; // busca a página nova
const ASSET_CRON = '7 3 * * *'; // uma vez por dia, renova fontes e imagens

const ASSETS = {
  '/assets/fonts/figtree.woff2': 'font/woff2',
  '/assets/fonts/sora.woff2': 'font/woff2',
  '/assets/fonts/jetbrains-mono.woff2': 'font/woff2',
  '/assets/favcode-mark-96.png': 'image/png',
  '/assets/favcode-mark-180.png': 'image/png',
  '/assets/og-image.jpg': 'image/jpeg',
};
// A imagem de compartilhamento precisa abrir no WhatsApp e nas redes e o logo grande aparece nos
// e-mails da newsletter; o resto é só do site.
const PUBLIC_ASSETS = new Set(['/assets/og-image.jpg', '/assets/favcode-mark-180.png']);

// Outras páginas geradas pelo build, guardadas no KV junto com a principal.
const EXTRA_PAGES = { '/privacidade': 'privacidade.html', '/editor': 'editor.html' };

// Programas que baixam sites inteiros, bibliotecas de raspagem, navegadores automatizados e
// robôs que coletam conteúdo para IA. As prévias de link (WhatsApp, Facebook, LinkedIn,
// X, Telegram, Slack, Discord) e os buscadores continuam liberados.
const BLOCKED_AGENTS = new RegExp(
  [
    'httrack', 'wget', 'curl', 'libcurl', 'webcopy', 'sitesucker', 'teleport', 'offline ?explorer', 'webzip',
    'webreaper', 'website ?(downloader|ripper|extractor)', 'site ?snagger', 'webstripper', 'getright', 'grabber',
    'python', 'aiohttp', 'httpx', 'scrapy', 'go-http-client', 'node-fetch', 'undici', 'axios', 'got \\(',
    'okhttp', 'java/', 'apache-httpclient', 'libwww', 'lwp::', 'mechanize', 'ruby', 'php/', 'guzzle',
    'postmanruntime', 'insomnia', 'headlesschrome', 'phantomjs', 'puppeteer', 'playwright', 'selenium',
    'gptbot', 'chatgpt', 'oai-searchbot', 'claudebot', 'claude-web', 'claude-user', 'claude-searchbot',
    'anthropic', 'ccbot', 'perplexity', 'bytespider', 'amazonbot', 'applebot-extended', 'cohere',
    'diffbot', 'imagesift', 'omgili', 'meta-externalagent', 'meta-externalfetcher', 'facebookbot',
    'timpibot', 'youbot', 'petalbot', 'ai2bot', 'duckassistbot', 'mistralai', 'firecrawl', 'scrapingbee',
    'zyte', 'apify', 'crawl4ai', 'jina', 'img2dataset', 'magpie-crawler', 'velenpublicwebcrawler',
    'webzio',
  ].join('|'),
  'i',
);

const COPYRIGHT = 'O conteúdo do Radar FavCode é protegido por direitos autorais (Lei nº 9.610/1998).';

// robots.txt: recusa os coletores de IA e os programas de cópia; o resto pode indexar.
const ROBOTS = `# Radar FavCode
# © FavCode. Todos os direitos reservados.
# Não é permitido copiar, clonar ou usar este conteúdo para treinar inteligência artificial.

${[
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-Web', 'Claude-User', 'Claude-SearchBot',
  'anthropic-ai', 'CCBot', 'PerplexityBot', 'Perplexity-User', 'Bytespider', 'Amazonbot', 'Applebot-Extended',
  'Google-Extended', 'cohere-ai', 'cohere-training-data-crawler', 'Diffbot', 'ImagesiftBot', 'Omgilibot',
  'Meta-ExternalAgent', 'Meta-ExternalFetcher', 'FacebookBot', 'Timpibot', 'YouBot', 'PetalBot', 'AI2Bot',
  'DuckAssistBot', 'MistralAI-User', 'FirecrawlAgent', 'img2dataset', 'HTTrack', 'WebCopier', 'WebZIP',
  'Offline Explorer', 'Teleport', 'SiteSnagger', 'WebStripper', 'Wget',
]
  .map((bot) => `User-agent: ${bot}`)
  .join('\n')}
Disallow: /

User-agent: *
Allow: /
`;

const generatedAt = (html) => (/"generatedAt":"([^"]+)"/.exec(html) || [])[1] || '';

const githubHeaders = (env) => ({
  authorization: `Bearer ${env.GITHUB_TOKEN}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'radar-favcode-worker',
  'x-github-api-version': '2022-11-28',
});

/**
 * Lê um arquivo do repositório (branch padrão). Com GITHUB_TOKEN usa a API, que funciona
 * mesmo com o repositório privado; sem ele (ou se a API falhar), o endereço "raw" público.
 */
async function fetchSource(env, path) {
  if (env.GITHUB_TOKEN && env.GITHUB_REPO) {
    const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents${path}`, {
      headers: { ...githubHeaders(env), accept: 'application/vnd.github.raw' },
    });
    if (res.ok) return res;
  }
  return fetch(env.SOURCE + path, { headers: { 'user-agent': 'radar-favcode-worker' } });
}

async function fetchPage(env) {
  const res = await fetchSource(env, '/index.html');
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
  const html = await res.text();
  if (!html.includes('id="radar-data"')) throw new Error('index.html sem manchetes');
  return html;
}

async function fetchExtraPage(env, file) {
  const res = await fetchSource(env, `/${file}`);
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status} para ${file}`);
  const html = await res.text();
  if (!html.includes('<html')) throw new Error(`${file} inválido`);
  return html;
}

async function refreshExtraPages(env) {
  for (const [path, file] of Object.entries(EXTRA_PAGES)) {
    try {
      await env.RADAR.put(`page:${path}`, await fetchExtraPage(env, file));
    } catch {
      /* mantém a cópia anterior */
    }
  }
}

/**
 * Grava a página nova no KV só quando a coleta mudou (economiza escritas). Junto, atualiza as
 * páginas extras e registra as manchetes no D1 para o rascunho semanal da newsletter.
 */
async function refreshPage(env) {
  const html = await fetchPage(env);
  const version = generatedAt(html);
  if (version && version === (await env.RADAR.get(PAGE_VERSION_KEY))) return false;
  await env.RADAR.put(PAGE_KEY, html);
  await env.RADAR.put(PAGE_VERSION_KEY, version);
  await refreshExtraPages(env);
  if (env.DB) await recordNews(env, extractPageData(html));
  return true;
}

async function refreshAssets(env) {
  for (const path of Object.keys(ASSETS)) {
    const res = await fetchSource(env, path);
    if (res.ok) await env.RADAR.put(`asset:${path}`, await res.arrayBuffer());
  }
}

async function getAsset(env, ctx, path) {
  let buf = await env.RADAR.get(`asset:${path}`, { type: 'arrayBuffer', cacheTtl: 3600 });
  if (!buf) {
    const res = await fetchSource(env, path);
    if (!res.ok) return null;
    buf = await res.arrayBuffer();
    ctx.waitUntil(env.RADAR.put(`asset:${path}`, buf));
  }
  return buf;
}

/** Pede ao GitHub Actions uma coleta nova (workflow "Atualizar radar", branch padrão). */
async function dispatchCollection(env) {
  const headers = githubHeaders(env);
  const repo = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}`, { headers });
  if (!repo.ok) throw new Error(`GitHub respondeu ${repo.status} ao ler o repositório`);
  const { default_branch: ref } = await repo.json();
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/radar.yml/dispatches`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ref }),
  });
  if (res.status !== 204) throw new Error(`GitHub respondeu ${res.status} ao disparar a coleta`);
}

/** Com SITE_URL vazio no build, as tags de compartilhamento saem relativas; aqui viram absolutas. */
function absolutize(html, origin) {
  return html
    .split('content="/assets/og-image.jpg"').join(`content="${origin}/assets/og-image.jpg"`)
    .split('<link rel="canonical" href="/">').join(`<link rel="canonical" href="${origin}/">`)
    .split('<meta property="og:url" content="/">').join(`<meta property="og:url" content="${origin}/">`);
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000',
  'x-robots-tag': 'noai, noimageai',
};

const HTML_HEADERS = {
  ...SECURITY_HEADERS,
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, max-age=60',
  // Nenhum outro site pode exibir o radar dentro de uma moldura (iframe).
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
};

const denied = (status, message, extra = {}) =>
  new Response(`${message}\n${COPYRIGHT}\n`, {
    status,
    headers: { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

/** Referer de outro domínio pedindo fonte ou logo = site copiado usando os arquivos daqui. */
function foreignReferer(request, url) {
  const referer = request.headers.get('referer');
  if (!referer) return false;
  try {
    return new URL(referer).host !== url.host;
  } catch {
    return true;
  }
}

// ---------- Tradução (Workers AI) ----------

const TRANSLATION_MODEL = AI_MODEL;
const OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const TRANSLATE_AUDIENCE = 'radar-favcode-translate';
const MAX_TRANSLATE_ITEMS = 25;
const MAX_SYSTEM_CHARS = 6000;

const TRANSLATION_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' } },
        required: ['id', 'title', 'summary'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const base64urlBytes = (part) => {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};
const base64urlJson = (part) => JSON.parse(new TextDecoder().decode(base64urlBytes(part)));

// Chaves públicas do GitHub, guardadas por uma hora na memória do Worker.
let jwksCache = { keys: [], at: 0 };
async function githubKeys(fetchImpl, force = false) {
  if (!force && jwksCache.keys.length && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const res = await fetchImpl(`${OIDC_ISSUER}/.well-known/jwks`, { headers: { 'user-agent': 'radar-favcode-worker' } });
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status} ao buscar as chaves`);
  jwksCache = { keys: (await res.json()).keys || [], at: Date.now() };
  return jwksCache.keys;
}

/**
 * Confere o token OIDC do GitHub Actions: assinatura RS256 do GitHub, emissor, público,
 * validade e repositório. Devolve as declarações do token ou null.
 */
async function verifyGithubToken(token, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  let header;
  let claims;
  try {
    header = base64urlJson(parts[0]);
    claims = base64urlJson(parts[1]);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;
  let jwk = (await githubKeys(fetchImpl)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await githubKeys(fetchImpl, true)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64urlBytes(parts[2]), signed))) return null;

  const seconds = now / 1000;
  const audiences = [].concat(claims.aud || []);
  if (claims.iss !== OIDC_ISSUER || !audiences.includes(TRANSLATE_AUDIENCE)) return null;
  if (!(claims.exp > seconds) || (claims.nbf && claims.nbf > seconds + 60)) return null;
  if (!env.GITHUB_REPO || String(claims.repository).toLowerCase() !== String(env.GITHUB_REPO).toLowerCase()) return null;
  return claims;
}

async function translateWithAI(env, system, items) {
  const parsed = await runJson(env, {
    system,
    user: `Traduza estes itens:\n${JSON.stringify(items)}`,
    schema: TRANSLATION_SCHEMA,
    name: 'traducao',
  });
  const wanted = new Set(items.map((it) => it.id));
  return (parsed.items || [])
    .filter((it) => wanted.has(it.id) && String(it.title || '').trim())
    .map((it) => ({ id: it.id, title: String(it.title).trim(), summary: String(it.summary || '').trim() }));
}

async function handleTranslate(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'use POST' });
  if (!env.AI) return json(503, { error: 'Workers AI indisponível' });
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const claims = await verifyGithubToken(token, env).catch(() => null);
  if (!claims) return json(401, { error: 'token do GitHub Actions inválido' });

  const body = await request.json().catch(() => null);
  const items = Array.isArray(body?.items) ? body.items : [];
  const system = typeof body?.system === 'string' ? body.system : '';
  const valid =
    items.length > 0 &&
    items.length <= MAX_TRANSLATE_ITEMS &&
    system.length > 0 &&
    system.length <= MAX_SYSTEM_CHARS &&
    items.every((it) => typeof it?.id === 'string' && typeof it.title === 'string' && it.title.length <= 600 && typeof (it.summary ?? '') === 'string' && (it.summary ?? '').length <= 2000);
  if (!valid) return json(400, { error: `envie de 1 a ${MAX_TRANSLATE_ITEMS} itens {id, title, summary} e as instruções` });

  const clean = items.map(({ id, title, summary }) => ({ id, title, summary: summary || '' }));
  try {
    return json(200, { model: TRANSLATION_MODEL, items: await translateWithAI(env, system, clean) });
  } catch (err) {
    return json(502, { error: `falha na tradução: ${err?.message || err}` });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // O endereço provisório (.workers.dev) leva ao domínio oficial, com o mesmo caminho.
    if (env.CANONICAL_ORIGIN && url.hostname.endsWith('.workers.dev')) {
      return Response.redirect(`${env.CANONICAL_ORIGIN}${url.pathname}${url.search}`, 301);
    }
    if (url.pathname === '/api/translate') return handleTranslate(request, env);

    // Newsletter: cadastro e editor aceitam POST; programas de cópia e robôs continuam barrados.
    if (url.pathname === '/api/subscribe' || url.pathname.startsWith('/api/editor/') || url.pathname === '/editor/entrar') {
      const ua = request.headers.get('user-agent') || '';
      if (!ua.trim() || BLOCKED_AGENTS.test(ua)) return denied(403, 'Acesso bloqueado.');
      if (url.pathname === '/api/subscribe') return handleSubscribe(request, env, ctx);
      return handleEditor(request, env, ctx, url);
    }

    const head = request.method === 'HEAD';
    if (request.method !== 'GET' && !head) {
      return new Response('Método não permitido', { status: 405, headers: { allow: 'GET, HEAD' } });
    }

    if (url.pathname === '/robots.txt') {
      return new Response(head ? null : ROBOTS, {
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
      });
    }

    const agent = request.headers.get('user-agent') || '';
    if (!agent.trim() || BLOCKED_AGENTS.test(agent)) return denied(403, 'Acesso bloqueado.');

    if (env.LIMITER) {
      const ip = request.headers.get('cf-connecting-ip') || 'sem-ip';
      const { success } = await env.LIMITER.limit({ key: ip });
      if (!success) return denied(429, 'Muitos acessos em pouco tempo. Tente de novo em um minuto.', { 'retry-after': '60' });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      // O navegador avisa quando a página vai abrir dentro de um iframe de outro site.
      const dest = request.headers.get('sec-fetch-dest');
      if (dest === 'iframe' || dest === 'frame') return denied(403, 'O Radar FavCode não pode ser exibido dentro de outro site.');

      let html = await env.RADAR.get(PAGE_KEY, { cacheTtl: 60 });
      if (!html) {
        try {
          html = await fetchPage(env);
          ctx.waitUntil(env.RADAR.put(PAGE_KEY, html).then(() => env.RADAR.put(PAGE_VERSION_KEY, generatedAt(html))));
        } catch {
          return new Response('O radar está sendo atualizado. Tente de novo em alguns minutos.', {
            status: 503,
            headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '120' },
          });
        }
      }
      return new Response(head ? null : absolutize(html, url.origin), { headers: HTML_HEADERS });
    }

    const extra = EXTRA_PAGES[url.pathname];
    if (extra) {
      let html = await env.RADAR.get(`page:${url.pathname}`, { cacheTtl: 60 });
      if (!html) {
        try {
          html = await fetchExtraPage(env, extra);
          ctx.waitUntil(env.RADAR.put(`page:${url.pathname}`, html));
        } catch {
          return new Response('Página indisponível no momento.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
        }
      }
      const headers = url.pathname === '/editor' ? { ...HTML_HEADERS, 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } : HTML_HEADERS;
      return new Response(head ? null : html, { headers });
    }

    const type = ASSETS[url.pathname];
    if (type) {
      const shared = PUBLIC_ASSETS.has(url.pathname);
      if (!shared && foreignReferer(request, url)) return denied(403, 'Arquivo de uso exclusivo do Radar FavCode.');
      const buf = await getAsset(env, ctx, url.pathname);
      if (!buf) return new Response('Arquivo indisponível', { status: 404 });
      return new Response(head ? null : buf, {
        headers: {
          ...SECURITY_HEADERS,
          'content-type': type,
          'cache-control': 'public, max-age=86400',
          'cross-origin-resource-policy': shared ? 'cross-origin' : 'same-origin',
        },
      });
    }

    return Response.redirect(`${url.origin}/`, 302);
  },

  async scheduled(controller, env, ctx) {
    const tasks = [];
    if (controller.cron === ASSET_CRON) {
      tasks.push(refreshAssets(env));
      if (env.DB) tasks.push(cleanupNews(env));
    }
    if (controller.cron === PAGE_CRON) {
      tasks.push(refreshPage(env));
      const when = new Date(controller.scheduledTime);
      // Uma vez por hora (na execução do minuto 0).
      if (env.GITHUB_TOKEN && when.getUTCMinutes() < 15) tasks.push(dispatchCollection(env));
      // Inscritos que ainda não foram para o Resend.
      if (env.DB && env.RESEND_API_KEY) tasks.push(syncSubscribers(env));
      // Newsletter: rascunho sexta às 6h45 e envio automático às 9h (Brasília).
      if (env.DB) tasks.push(weeklyNewsletter(env, { now: controller.scheduledTime }));
    }
    ctx.waitUntil(
      Promise.allSettled(tasks).then((results) => {
        for (const r of results) if (r.status === 'rejected') console.error(r.reason?.message || r.reason);
      }),
    );
  },
};
