import { test } from 'node:test';
import assert from 'node:assert/strict';

import { blocklist, columns, feeds, noise, trendStoplist, watchlist } from '../config/radar.config.mjs';
import { computeTrends, extractProperNouns } from '../scripts/lib/trends.mjs';
import { cleanUrl, matchesAny } from '../scripts/lib/utils.mjs';

test('bloqueia Google Ads e Google Meu Negócio em todas as grafias', () => {
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
  ];
  for (const text of blocked) assert.ok(matchesAny(blocklist, text), `deveria bloquear: ${text}`);

  const allowed = [
    'Google lança Gemini 3 com agentes',
    'Google AdSense muda pagamento para criadores',
    'Meta Ads: novos formatos no Reels',
    'Adweek: as melhores campanhas do ano',
    'Google Business Messages é descontinuado',
    'Amazon Ads amplia retail media',
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

test('limpa parâmetros de rastreamento da URL', () => {
  assert.equal(cleanUrl('https://Site.com/materia/?utm_source=rss&utm_medium=feed&id=3#comentarios'), 'https://site.com/materia/?id=3');
  assert.equal(cleanUrl('https://site.com/materia/'), 'https://site.com/materia');
});

test('detecta nomes próprios sem pegar a primeira palavra da frase', () => {
  assert.deepEqual(extractProperNouns('Novo recurso do Instagram imita o TikTok'), ['Instagram', 'TikTok']);
  assert.deepEqual(extractProperNouns('Sam Altman diz que a OpenAI vai abrir escritório no Brasil'), ['Altman', 'OpenAI', 'Brasil']);
  assert.deepEqual(extractProperNouns('Why Every Designer Should Learn Figma Variables'), [], 'título em Title Case não vira termo');
  assert.deepEqual(extractProperNouns('iPhone 18 Pro Leaks Show New Camera'), ['iPhone']);
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
