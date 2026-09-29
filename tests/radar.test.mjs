import { test } from 'node:test';
import assert from 'node:assert/strict';

import { blocklist, columns, feeds, noise, sponsored, trendStoplist, watchlist } from '../config/radar.config.mjs';
import { computeTrends, extractProperNouns } from '../scripts/lib/trends.mjs';
import { cleanUrl, matchesAny } from '../scripts/lib/utils.mjs';

test('bloqueia tudo que é do Google: marca, produtos, anúncios e Meu Negócio', () => {
  const blocked = [
    'Google Ads lança novo recurso de lances',
    'Como otimizar campanhas no GOOGLE ADS em 2026',
    'Google Ad Manager muda regras',
    'O fim do AdWords',
    'Performance Max ganha relatórios por canal',
    'PMax: o que mudou',
    'Google Meu Negócio: guia completo',
    'google meu negocio para restaurantes',
    'Google My Business is now Google Business Profile',
    'Novidades no Perfil da Empresa no Google',
    'Local Services Ads chegam ao Brasil',
    'Dicas de GMB para dentistas',
    'Google lança satélite com IA',
    'Gemini ganha modo de voz em português',
    'DeepMind apresenta novo modelo de previsão do tempo',
    'Android 17 chega aos celulares Galaxy',
    'Chrome passa a bloquear cookies de terceiros',
    'Gmail troca cor de estrelas e marcadores na versão web',
    'Alphabet supera expectativas no trimestre',
    'Sundar Pichai fala sobre o futuro da busca',
    'AI Overviews reduzem cliques em sites de notícia',
    'September 2026 core update is rolling out',
    'Como usar o GA4 para medir campanhas',
    'Search Console ganha relatório de consultas',
    'AdSense muda pagamento para criadores',
    'Waymo expande robotáxis para mais cidades',
    'Pixel 11 Pro vaza com câmera nova',
    'Googlebot passa a renderizar mais JavaScript',
    'Rising CPC? You’re Funding The Competition. Strong affiliate numbers can hide brand bidding.',
    'PPC trends for Q4',
  ];
  for (const text of blocked) assert.ok(matchesAny(blocklist, text), `deveria bloquear: ${text}`);

  const allowed = [
    'Meta Ads: novos formatos no Reels',
    'Adweek: as melhores campanhas do ano',
    'Amazon Ads amplia retail media',
    'YouTube lança edição de vídeo com IA',
    'OpenAI lança agentes para empresas',
    'Pixel art volta com força no branding',
    'Meta Pixel ganha novos eventos de conversão',
    'Apple atualiza o iPhone com novos recursos de acessibilidade',
  ];
  for (const text of allowed) assert.equal(matchesAny(blocklist, text), null, `não deveria bloquear: ${text}`);
});

test('configuração consistente: toda fonte aponta para uma editoria existente', () => {
  const ids = new Set(columns.map((c) => c.id));
  assert.equal(ids.size, columns.length, 'ids de editoria repetidos');
  for (const feed of feeds) {
    assert.ok(ids.has(feed.column), `${feed.name}: editoria ${feed.column}`);
    assert.match(feed.url, /^https:\/\//, `${feed.name}: url`);
    assert.ok(['pt', 'en'].includes(feed.lang), `${feed.name}: idioma`);
    for (const route of feed.routes || []) assert.ok(ids.has(route.column), `${feed.name}: rota ${route.column}`);
  }
  const keys = feeds.map((f) => f.url);
  assert.equal(new Set(keys).size, keys.length, 'feed repetido');
  for (const w of watchlist) assert.equal(matchesAny(blocklist, w.label), null, `termo monitorado bloqueado: ${w.label}`);
});

test('manda manchetes para Marca e branding e Pautas em alta', () => {
  const feed = (name, column) => feeds.find((f) => f.name === name && (!column || f.column === column));
  const route = (f, title) => f.routes?.find((r) => r.match.test(title))?.column || f.column;
  const cases = [
    ['Meio & Mensagem', 'Natura apresenta nova identidade visual e reposicionamento', 'marca'],
    ['Meio & Mensagem', 'Trend do morango do amor viraliza e marcas entram na brincadeira', 'pautas'],
    ['Meio & Mensagem', 'Nova campanha da Heineken estreia na TV', 'publicidade'],
    ['Meio & Mensagem', 'Varejo cresce logo após a Black Friday', 'marketing'],
    ['Tecnoblog', 'WhatsApp ganha nova função para organizar conversas', 'pautas'],
    ['Tecnoblog', 'ChatGPT ganha novo recurso de memória', 'ia'],
    ['Tecnoblog', 'Meta é multada por falha em anúncios no Instagram', 'social'],
    ['Creative Review', 'Nomad designs identities for new Ultimate Sevens rugby league', 'marca'],
    ['Creative Review', 'New photo book celebrates 35 years of clubbing', 'design'],
    ['Creative Bloq', 'The new Jaguar logo is divisive', 'marca'],
    ['Social Media Today', 'Instagram shares Reels creation tips in new guide', 'pautas'],
  ];
  for (const [name, title, want] of cases) assert.equal(route(feed(name), title), want, `${name}: ${title}`);
  const hootsuite = feed('Hootsuite');
  assert.match('Best social media tools for marketing teams in 2026', hootsuite.exclude);
  assert.doesNotMatch('Millennials and social media: Trends, habits, and tips for 2026', hootsuite.exclude);
});

test('limpa parâmetros de rastreamento da URL', () => {
  assert.equal(cleanUrl('https://Site.com/materia/?utm_source=rss&utm_medium=feed&id=3#comentarios'), 'https://site.com/materia/?id=3');
  assert.equal(cleanUrl('https://site.com/materia/'), 'https://site.com/materia');
});

test('detecta nomes próprios sem pegar a primeira palavra da frase', () => {
  assert.deepEqual(extractProperNouns('Novo recurso do Instagram imita o TikTok'), ['Instagram', 'TikTok']);
  assert.deepEqual(extractProperNouns('Sam Altman diz que a OpenAI vai abrir escritório no Brasil'), ['Altman', 'OpenAI', 'Brasil']);
  assert.deepEqual(extractProperNouns('Why Every Designer Should Learn Figma Variables'), [], 'título em Title Case não vira termo');
  assert.deepEqual(extractProperNouns('iPhone 18 Pro Leaks Show New Camera'), ['iPhone']);
  assert.deepEqual(extractProperNouns('Startup capta R$ 40 milhões e US$ 8 milhões com a Kaszek'), ['Kaszek']);
});

test('em alta: soma fontes e evita termos redundantes', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  const item = (id, title, source, column = 'ia', hoursAgo = 2) => ({ id, title, source, column, date: now - hoursAgo * 3600000 });
  const items = [
    item('1', 'OpenAI anuncia novo modelo', 'a'),
    item('2', 'ChatGPT ganha agentes da OpenAI', 'b'),
    item('3', 'OpenAI e Microsoft renovam acordo', 'c', 'tecnologia'),
    item('4', 'Instagram testa feed só de amigos', 'a', 'social'),
    item('5', 'Novo teste do Instagram divide criadores', 'd', 'social'),
    item('6', 'Nubank lança conta para empresas no México', 'e', 'startups'),
    item('7', 'Clientes do Nubank ganham Pix automático', 'f', 'startups'),
    item('8', 'Expansão do Nubank chega à Colômbia', 'g', 'startups'),
    item('9', 'Figma apresenta nova ferramenta', 'h', 'design'),
  ];
  const trends = computeTrends(items, { watchlist, stoplist: trendStoplist, columns, now, limit: 5 });
  const terms = trends.map((t) => t.term);
  assert.equal(terms[0], 'OpenAI');
  assert.ok(terms.includes('Instagram'));
  assert.ok(terms.includes('Nubank'), 'termo fora da lista, citado em 3 fontes');
  assert.ok(!terms.includes('Figma'), 'uma fonte só não é tendência');
  assert.equal(trends.find((t) => t.term === 'Instagram').column, 'social');
  assert.deepEqual(trends[0].ids, ['1', '2', '3']);
});

test('descarta ofertas, guias de compra e tutoriais, mas mantém notícia', () => {
  const junk = [
    'Galaxy S25 FE usa câmeras do S26 FE e tem 41% de desconto no Magalu',
    'Galaxy Tab S11 (256 GB) para jogos tem 34% OFF com cupom',
    'Huawei Watch GT 6 sai quase pela metade do preço com cupom',
    'Aproveite: Galaxy Watch 8 LTE fica 61% mais barato por até 10x sem juros',
    'Melhor notebook Asus: 9 modelos para comprar em 2026',
    'Como recuperar a senha do aplicativo e-Título',
    'The best Apple deals this week',
    '8 polêmicas mais estranhas da história da Nintendo',
    'Kindle x Galaxy Z Fold 8: qual é melhor para ler quadrinhos?',
    'Quanto custaria um Volkswagen Pointer GTI hoje, com a inflação?',
    'Edição de 28 de setembro de 2026',
    'Best Party Speakers (2026): JBL, Sony, Marshall, and More',
    '12 Best White Elephant Gifts, Plus a Prank Box to Put Them In (2026)',
    'What’s the Best Pet DNA Test? We Tested the Most Popular Ones',
    'Last 24 hours to save up to $200 on TechCrunch Disrupt 2026. Reason 5 of 5 to attend: Momentum',
    'KaBuM! chuta a porta e oferece Intel Core Ultra 5 por menos de R$ 600!',
    'Jogos de hoje (28/09/26): onde assistir futebol ao vivo e horários das partidas',
  ];
  for (const t of junk) assert.ok(matchesAny(noise, t), `deveria descartar: ${t}`);
  const news = [
    'Mercado Livre promete entregar produtos em até 60 minutos',
    'Como a IA está mudando as agências de publicidade',
    'OpenAI fecha acordo de US$ 10 bi com a Oracle',
    'Microsoft strikes deal with OpenAI over AGI clause',
    'Mais uma alta de preço no Disney+',
  ];
  for (const t of news) assert.equal(matchesAny(noise, t), null, `deveria manter: ${t}`);
});

test('acentos decompostos (NFD) são normalizados antes dos filtros', async () => {
  const { cleanTitle } = await import('../scripts/lib/feed-parser.mjs');
  const nfd = 'Google Meu Negócio ganha novidades'.normalize('NFD');
  assert.notEqual(nfd, 'Google Meu Negócio ganha novidades');
  assert.ok(matchesAny(blocklist, cleanTitle(nfd)));
  assert.ok(matchesAny(noise, cleanTitle('Edição de 28 de setembro de 2026'.normalize('NFD'))));
  assert.ok(matchesAny(noise, 'Hora de jogar: uma seleção de ótimas ofertas em jogos para Xbox'));
});

test('descarta conteúdo patrocinado', () => {
  assert.ok(matchesAny(sponsored, 'Are AI Ads Ready for Prime Time? This post was created in partnership with Higgsfield AI'));
  assert.ok(matchesAny(sponsored, 'Conteúdo patrocinado: a nova linha de notebooks'));
  assert.equal(matchesAny(sponsored, 'Brands sponsor more creators in 2026'), null);
});
