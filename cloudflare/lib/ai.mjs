// Chamada à IA da Cloudflare (Workers AI) com resposta em JSON validado por schema.

export const AI_MODEL = '@cf/openai/gpt-oss-120b';

/** Texto da resposta do modelo, qualquer que seja o formato (Responses ou chat). */
export function modelText(result) {
  if (typeof result === 'string') return result;
  if (typeof result?.response === 'string') return result.response;
  if (Array.isArray(result?.output)) {
    return result.output
      .filter((o) => o.type === 'message')
      .flatMap((o) => o.content || [])
      .map((c) => c.text || '')
      .join('');
  }
  return result?.choices?.[0]?.message?.content || '';
}

/** Roda o modelo e devolve o objeto JSON da resposta. */
export async function runJson(env, { system, user, schema, name = 'resposta', effort = 'low' }) {
  const result = await env.AI.run(AI_MODEL, {
    input: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    reasoning: { effort },
    text: { format: { type: 'json_schema', name, schema, strict: true } },
  });
  const text = modelText(result);
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}
