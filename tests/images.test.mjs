import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { enrichImages, extractShareImage, usableImage } from '../scripts/lib/images.mjs';

test('pega a og:image da matéria, em qualquer ordem de atributos, e deixa absoluta', () => {
  const page = '<html><head><meta content="/fotos/capa.jpg?w=1200&amp;h=630" property="og:image"><title>x</title></head><body></body></html>';
  assert.equal(extractShareImage(page, 'https://site.com.br/noticia/1'), 'https://site.com.br/fotos/capa.jpg?w=1200&h=630');
  const tw = '<head><meta name="twitter:image" content="https://cdn.site.com/a.png"></head>';
  assert.equal(extractShareImage(tw, 'https://site.com'), 'https://cdn.site.com/a.png');
});

test('descarta logo genérico e imagem hospedada no Google', () => {
  assert.equal(usableImage('https://site.com/wp-content/themes/x/logo.png'), '');
  assert.equal(usableImage('https://lh3.googleusercontent.com/abc=w1200'), '');
  assert.equal(usableImage('https://blogger.googleusercontent.com/img/b/x.jpg'), '');
  assert.equal(usableImage('http://cdn.site.com/foto.jpg'), 'https://cdn.site.com/foto.jpg');
  const page = '<head><meta property="og:image" content="https://site.com/default-og-image.jpg"></head>';
  assert.equal(extractShareImage(page, 'https://site.com/x'), '');
});

test('completa só quem não tem imagem e guarda o resultado, inclusive a falta dele', async () => {
  const cacheFile = path.join(await mkdtemp(path.join(os.tmpdir(), 'radar-img-')), 'images.json');
  const pages = {
    'https://a.com/1': '<head><meta property="og:image" content="https://a.com/1.jpg"></head>',
    'https://b.com/2': '<head><title>sem imagem</title></head>',
  };
  const calls = [];
  const fetchPage = async (url) => {
    calls.push(url);
    return pages[url] || '';
  };
  const items = [
    { url: 'https://a.com/1', image: '' },
    { url: 'https://b.com/2', image: '' },
    { url: 'https://c.com/3', image: 'https://c.com/foto.jpg' },
    { url: 'https://d.com/4', image: 'https://lh3.googleusercontent.com/x' },
  ];
  const stats = await enrichImages(items, { cacheFile, fetchPage });
  assert.deepEqual(items.map((it) => it.image), ['https://a.com/1.jpg', '', 'https://c.com/foto.jpg', '']);
  assert.equal(stats.found, 1);
  assert.equal(calls.length, 3, 'a imagem do Google vira "sem imagem" e busca a da matéria');

  calls.length = 0;
  const again = items.slice(0, 2).map((it) => ({ ...it, image: '' }));
  await enrichImages(again, { cacheFile, fetchPage });
  assert.equal(calls.length, 0, 'segunda coleta usa o cache');
  assert.equal(again[0].image, 'https://a.com/1.jpg');
  const saved = JSON.parse(await readFile(cacheFile, 'utf8'));
  assert.deepEqual(Object.keys(saved.entries), ['https://a.com/1', 'https://b.com/2']);
});
