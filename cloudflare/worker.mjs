// Cloudflare Worker que publica o Radar FavCode.
// © FavCode. Todos os direitos reservados.
//
// A cada 15 minutos busca o index.html mais recente no GitHub e guarda no KV;
// os visitantes recebem sempre a cópia guardada, mesmo que o GitHub esteja fora do ar.
//
// Também dispara a coleta no GitHub Actions uma vez por hora, porque o agendamento do
// próprio GitHub atrasa ou pula horários. Só funciona com o segredo GITHUB_TOKEN cadastrado.
//
// Proteção contra cópia: bloqueia programas de clonagem, raspadores e robôs de IA,
// proíbe abrir o site dentro de outro (iframe), impede que outros sites usem as fontes e
// o logo e, com o binding LIMITER, limita o número de acessos por IP.
//
// Bindings: RADAR (KV namespace), SOURCE (raiz "raw" do repositório), GITHUB_REPO (dono/repo),
// opcionais GITHUB_TOKEN (segredo; Contents: Read e Actions: Read and write — com ele o
// repositório pode ser privado), LIMITER (rate limit) e CANONICAL_ORIGIN (endereço oficial,
// ex.: https://radar.favcode.com.br; o endereço .workers.dev passa a redirecionar para ele).

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
// A imagem de compartilhamento precisa abrir no WhatsApp e nas redes; o resto é só do site.
const PUBLIC_ASSETS = new Set(['/assets/og-image.jpg']);

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

/** Grava a página nova no KV só quando a coleta mudou (economiza escritas). */
async function refreshPage(env) {
  const html = await fetchPage(env);
  const version = generatedAt(html);
  if (version && version === (await env.RADAR.get(PAGE_VERSION_KEY))) return false;
  await env.RADAR.put(PAGE_KEY, html);
  await env.RADAR.put(PAGE_VERSION_KEY, version);
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // O endereço provisório (.workers.dev) leva ao domínio oficial, com o mesmo caminho.
    if (env.CANONICAL_ORIGIN && url.hostname.endsWith('.workers.dev')) {
      return Response.redirect(`${env.CANONICAL_ORIGIN}${url.pathname}${url.search}`, 301);
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
    if (controller.cron === ASSET_CRON) tasks.push(refreshAssets(env));
    if (controller.cron === PAGE_CRON) {
      tasks.push(refreshPage(env));
      // Uma vez por hora (na execução do minuto 0).
      const minute = new Date(controller.scheduledTime).getUTCMinutes();
      if (env.GITHUB_TOKEN && minute < 15) tasks.push(dispatchCollection(env));
    }
    ctx.waitUntil(
      Promise.allSettled(tasks).then((results) => {
        for (const r of results) if (r.status === 'rejected') console.error(r.reason?.message || r.reason);
      }),
    );
  },
};
