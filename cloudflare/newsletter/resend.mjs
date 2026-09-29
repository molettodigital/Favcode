// Cliente mínimo da API do Resend: contatos, segmento da newsletter, e-mails avulsos e broadcasts.
// Só funciona com o segredo RESEND_API_KEY cadastrado no Worker.

const API = 'https://api.resend.com';
export const SEGMENT_NAME = 'Newsletter Radar FavCode';
const SEGMENT_KV_KEY = 'resend:segment';

export class ResendError extends Error {
  constructor(status, message) {
    super(`Resend ${status}: ${message}`);
    this.status = status;
  }
}

export function resendClient(env, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY) return null;

  async function call(method, path, body) {
    const res = await fetchImpl(API + path, {
      method,
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
        'user-agent': 'radar-favcode-worker',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text.slice(0, 200) };
    }
    if (!res.ok) throw new ResendError(res.status, data.message || data.name || res.statusText);
    return data;
  }

  return {
    call,

    /** Id do segmento da newsletter: RESEND_SEGMENT_ID, o guardado no KV ou um criado agora. */
    async segmentId() {
      if (env.RESEND_SEGMENT_ID) return env.RESEND_SEGMENT_ID;
      const cached = env.RADAR ? await env.RADAR.get(SEGMENT_KV_KEY) : null;
      if (cached) return cached;
      const list = await call('GET', '/segments');
      let segment = (list.data || []).find((s) => s.name === SEGMENT_NAME);
      if (!segment) segment = await call('POST', '/segments', { name: SEGMENT_NAME });
      if (env.RADAR) await env.RADAR.put(SEGMENT_KV_KEY, segment.id);
      return segment.id;
    },

    /** Cria o contato no segmento; se já existir, reativa, atualiza o nome e garante o segmento. */
    async upsertContact({ email, name, segmentId }) {
      const [first, ...rest] = String(name || '').trim().split(/\s+/);
      const fields = { first_name: first || '', last_name: rest.join(' '), unsubscribed: false };
      try {
        await call('POST', '/contacts', { email, ...fields, segments: [{ id: segmentId }] });
      } catch (err) {
        if (!(err instanceof ResendError) || err.status >= 500 || !/exist/i.test(err.message)) throw err;
        const id = encodeURIComponent(email);
        await call('PATCH', `/contacts/${id}`, fields);
        await call('POST', `/contacts/${id}/segments/${segmentId}`).catch((e) => {
          if (!/exist|already/i.test(e.message)) throw e;
        });
      }
    },

    sendEmail({ from, to, subject, html, text, replyTo }) {
      return call('POST', '/emails', { from, to: [].concat(to), subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) });
    },

    /** Cria o broadcast para o segmento e já envia (ou agenda, com scheduledAt em ISO). */
    createBroadcast({ segmentId, from, replyTo, subject, html, text, name, scheduledAt }) {
      return call('POST', '/broadcasts', {
        segment_id: segmentId,
        from,
        subject,
        html,
        text,
        name,
        ...(replyTo ? { reply_to: replyTo } : {}),
        send: true,
        ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
      });
    },
  };
}
