import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanSummary, decodeEntities, parseDate, parseFeed, truncate } from '../scripts/lib/feed-parser.mjs';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Fonte &amp; Cia</title>
  <link>https://fonte.com.br</link>
  <item>
    <title><![CDATA[OpenAI lança modelo &#8220;mais rápido&#8221; para empresas]]></title>
    <link>https://fonte.com.br/noticia-1/?utm_source=rss&amp;utm_medium=feed</link>
    <pubDate>Mon, 28 Sep 2026 10:30:00 -0300</pubDate>
    <category><![CDATA[Inteligência artificial]]></category>
    <description><![CDATA[<p>O novo modelo chega <strong>hoje</strong>.</p><p>The post OpenAI lança appeared first on Fonte.</p>]]></description>
    <media:content url="https://cdn.fonte.com.br/img-small.jpg" medium="image" width="300" />
    <media:content url="https://cdn.fonte.com.br/img-big.jpg" medium="image" width="1200" />
  </item>
  <item>
    <title>Por que &lt;div&gt; ainda importa em 2026</title>
    <link>http://fonte.com.br/noticia-2</link>
    <dc:date>2026-09-27T08:00:00Z</dc:date>
    <content:encoded><![CDATA[<p><img src="/uploads/capa.png" width="800"> Texto &amp; mais texto</p>]]></content:encoded>
  </item>
  <item>
    <title>Sem link</title>
  </item>
</channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">The Verge</title>
  <entry>
    <title type="html">Meta&amp;#8217;s new glasses are here</title>
    <link rel="replies" href="https://example.com/comments"/>
    <link rel="alternate" type="text/html" href="https://www.theverge.com/2026/9/28/meta-glasses"/>
    <id>https://www.theverge.com/2026/9/28/meta-glasses</id>
    <published>2026-09-28T12:00:00-04:00</published>
    <updated>2026-09-28T13:00:00-04:00</updated>
    <summary type="html">&lt;p&gt;Hands-on with the &lt;em&gt;new&lt;/em&gt; glasses.&lt;/p&gt;&lt;img src="https://cdn.vox.com/glasses.jpg" /&gt;</summary>
  </entry>
</feed>`;

test('lê RSS 2.0 com CDATA, entidades, mídia e datas', () => {
  const feed = parseFeed(RSS, { baseUrl: 'https://fonte.com.br' });
  assert.equal(feed.title, 'Fonte & Cia');
  assert.equal(feed.items.length, 2, 'item sem link é descartado');

  const [first, second] = feed.items;
  assert.equal(first.title, 'OpenAI lança modelo “mais rápido” para empresas');
  assert.equal(first.url, 'https://fonte.com.br/noticia-1/?utm_source=rss&utm_medium=feed');
  assert.equal(first.date, Date.parse('2026-09-28T13:30:00Z'));
  assert.equal(first.image, 'https://cdn.fonte.com.br/img-big.jpg', 'escolhe a maior imagem');
  assert.equal(first.summary, 'O novo modelo chega hoje.', 'tira tags e o rodapé "The post … appeared first"');
  assert.deepEqual(first.categories, ['Inteligência artificial']);

  assert.equal(second.title, 'Por que <div> ainda importa em 2026', 'título com HTML escapado vira texto');
  assert.equal(second.url, 'https://fonte.com.br/noticia-2', 'http vira https');
  assert.equal(second.date, Date.parse('2026-09-27T08:00:00Z'));
  assert.equal(second.image, 'https://fonte.com.br/uploads/capa.png', 'imagem relativa do conteúdo vira absoluta');
});

test('lê Atom usando o link alternate e a data de publicação', () => {
  const feed = parseFeed(ATOM);
  assert.equal(feed.items.length, 1);
  const [entry] = feed.items;
  assert.equal(entry.title, 'Meta’s new glasses are here');
  assert.equal(entry.url, 'https://www.theverge.com/2026/9/28/meta-glasses');
  assert.equal(entry.date, Date.parse('2026-09-28T16:00:00Z'));
  assert.equal(entry.summary, 'Hands-on with the new glasses.');
  assert.equal(entry.image, 'https://cdn.vox.com/glasses.jpg');
});

test('decodifica entidades nomeadas, numéricas e duplas', () => {
  assert.equal(decodeEntities('Ca&ccedil;a &agrave;s not&iacute;cias &ndash; ok'), 'Caça às notícias – ok');
  assert.equal(decodeEntities('It&amp;#8217;s'), 'It’s');
  assert.equal(decodeEntities('&#x1F680; &unknown;'), '🚀 &unknown;');
});

test('entende datas em português e sem "T"', () => {
  assert.equal(parseDate('Seg, 28 Set 2026 10:00:00 -0300'), Date.parse('2026-09-28T13:00:00Z'));
  assert.equal(parseDate('2026-09-28 10:00:00'), Date.parse('2026-09-28T10:00:00'));
  assert.equal(parseDate('ontem'), null);
});

test('resumo e corte respeitam palavras', () => {
  assert.equal(cleanSummary('&lt;p&gt;Oi &lt;b&gt;mundo&lt;/b&gt;&lt;/p&gt; [&#8230;]'), 'Oi mundo…');
  assert.equal(truncate('uma frase bem comprida para cortar', 20), 'uma frase bem…');
});
