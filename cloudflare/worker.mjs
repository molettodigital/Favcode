// Cloudflare Worker que publica o Radar FavCode.
// A cada 15 minutos busca o index.html mais recente no GitHub e guarda no KV;
// os visitantes recebem sempre a cópia guardada, mesmo que o GitHub esteja fora do ar.
//
// Também dispara a coleta no GitHub Actions uma vez por hora, porque o agendamento do
// próprio GitHub atrasa ou pula horários. Só funciona com o segredo GITHUB_TOKEN cadastrado.
//
// Bindings: RADAR (KV namespace), SOURCE (raiz "raw" do repositório), GITHUB_REPO (dono/repo)
// e, opcional, GITHUB_TOKEN (segredo com permissão Actions: write no repositório).

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

const generatedAt = (html) => (/"generatedAt":"([^"]+)"/.exec(html) || [])[1] || '';

async function fetchPage(env) {
  const res = await fetch(`${env.SOURCE}/index.html`, { headers: { 'user-agent': 'radar-favcode-worker' } });
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
    const res = await fetch(env.SOURCE + path);
    if (res.ok) await env.RADAR.put(`asset:${path}`, await res.arrayBuffer());
  }
}

async function getAsset(env, ctx, path) {
  let buf = await env.RADAR.get(`asset:${path}`, { type: 'arrayBuffer', cacheTtl: 3600 });
  if (!buf) {
    const res = await fetch(env.SOURCE + path);
    if (!res.ok) return null;
    buf = await res.arrayBuffer();
    ctx.waitUntil(env.RADAR.put(`asset:${path}`, buf));
  }
  return buf;
}

/** Pede ao GitHub Actions uma coleta nova (workflow "Atualizar radar", branch padrão). */
async function dispatchCollection(env) {
  const headers = {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'radar-favcode-worker',
    'x-github-api-version': '2022-11-28',
  };
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

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, max-age=60',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const head = request.method === 'HEAD';
    if (request.method !== 'GET' && !head) {
      return new Response('Método não permitido', { status: 405, headers: { allow: 'GET, HEAD' } });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
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
      const buf = await getAsset(env, ctx, url.pathname);
      if (buf) return new Response(head ? null : buf, { headers: { 'content-type': type, 'cache-control': 'public, max-age=86400' } });
      return new Response('Arquivo indisponível', { status: 404 });
    }

    if (url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nAllow: /\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
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
