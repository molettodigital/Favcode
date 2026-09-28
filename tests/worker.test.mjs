import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../cloudflare/worker.mjs';

// Par de chaves de teste no lugar das chaves do GitHub.
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const KID = 'chave-teste';
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: KID };
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

async function sign(claims, { kid = KID, key = privateKey } = {}) {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const body = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

const now = Math.floor(Date.now() / 1000);
const goodClaims = {
  iss: 'https://token.actions.githubusercontent.com',
  aud: 'radar-favcode-translate',
  repository: 'molettodigital/Favcode',
  iat: now - 5,
  nbf: now - 5,
  exp: now + 300,
};

let aiCalls;
const env = {
  GITHUB_REPO: 'molettodigital/Favcode',
  AI: {
    async run(model, input) {
      aiCalls.push({ model, input });
      const items = JSON.parse(input.input[1].content.split('\n').slice(1).join('\n'));
      const out = { items: [...items.map((it) => ({ id: it.id, title: `PT ${it.title}`, summary: it.summary ? `PT ${it.summary}` : '' })), { id: 'intruso', title: 'x', summary: '' }] };
      return { output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(out) }] }] };
    },
  },
};
globalThis.fetch = async (url) => {
  if (String(url) === 'https://token.actions.githubusercontent.com/.well-known/jwks') return Response.json({ keys: [jwk] });
  return new Response('não esperado', { status: 500 });
};
beforeEach(() => {
  aiCalls = [];
});

const call = (token, body, { method = 'POST' } = {}) =>
  worker.fetch(
    new Request('https://radar.favcode.com.br/api/translate', {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }),
    env,
    { waitUntil() {} },
  );
const payload = { system: 'Traduza.', items: [{ id: 'a', title: 'AI agents', summary: 'Now.' }, { id: 'b', title: 'Rebrand', summary: '' }] };

test('token válido do repositório: traduz com a IA da Cloudflare', async () => {
  const res = await call(await sign(goodClaims), payload);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.model, '@cf/openai/gpt-oss-120b');
  assert.deepEqual(body.items, [
    { id: 'a', title: 'PT AI agents', summary: 'PT Now.' },
    { id: 'b', title: 'PT Rebrand', summary: '' },
  ]);
  assert.equal(aiCalls.length, 1);
  assert.equal(aiCalls[0].input.reasoning.effort, 'low');
  assert.equal(aiCalls[0].input.input[0].content, 'Traduza.');
});

test('recusa token ausente, de outro repositório, público errado, vencido ou com assinatura falsa', async () => {
  const other = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const cases = {
    'sem token': null,
    'lixo': 'abc.def',
    'outro repositório': await sign({ ...goodClaims, repository: 'alguem/clone' }),
    'outro público': await sign({ ...goodClaims, aud: 'outra-coisa' }),
    'outro emissor': await sign({ ...goodClaims, iss: 'https://evil.example' }),
    vencido: await sign({ ...goodClaims, exp: now - 10 }),
    'assinado por outra chave': await sign(goodClaims, { key: other.privateKey }),
    'chave desconhecida': await sign(goodClaims, { kid: 'nao-existe' }),
  };
  for (const [label, token] of Object.entries(cases)) {
    const res = await call(token, payload);
    assert.equal(res.status, 401, label);
  }
  assert.equal(aiCalls.length, 0);
});

test('valida o pedido: método, quantidade e formato dos itens', async () => {
  const token = await sign(goodClaims);
  assert.equal((await call(token, payload, { method: 'GET' })).status, 405);
  assert.equal((await call(token, { ...payload, items: [] })).status, 400);
  assert.equal((await call(token, { ...payload, system: '' })).status, 400);
  const many = Array.from({ length: 26 }, (_, i) => ({ id: String(i), title: 't', summary: '' }));
  assert.equal((await call(token, { ...payload, items: many })).status, 400);
  assert.equal((await call(token, { ...payload, items: [{ id: 1, title: 't' }] })).status, 400);
  assert.equal(aiCalls.length, 0);
});

test('sem o binding AI responde 503', async () => {
  const res = await worker.fetch(
    new Request('https://radar.favcode.com.br/api/translate', { method: 'POST', body: '{}' }),
    { GITHUB_REPO: env.GITHUB_REPO },
    { waitUntil() {} },
  );
  assert.equal(res.status, 503);
});
