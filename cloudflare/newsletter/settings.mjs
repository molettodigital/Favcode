// Dados fixos da newsletter. O texto do consentimento e a política de privacidade têm versão:
// ao mudar um deles, atualize CONSENT_VERSION aqui e em config/radar.config.mjs (newsletter).

export const NEWSLETTER = {
  name: 'Newsletter do Radar FavCode',
  // Todo e-mail chega como "Radar FavCode". Dentro, o resumo da semana é assinado pela
  // colunista e as boas-vindas, pela equipe. O site não cita o nome de ninguém.
  sender: 'Radar FavCode',
  author: 'Clara Poletto',
  role: 'Colunista FavCode',
  team: 'Equipe FavCode',
  day: 'sexta-feira',
  closing: 'Até a próxima sexta,\nClara Poletto - Colunista FavCode',
};

export const CONSENT_VERSION = '2026-09-30';

const DEFAULT_ORIGIN = 'https://radar.favcode.com.br';

/**
 * Caixa da newsletter: remetente, resposta dos leitores e login do editor.
 * noticias@favcode.com.br é uma caixa do Zoho Mail (mail.zoho.com).
 */
export const NEWSLETTER_EMAIL = 'noticias@favcode.com.br';
const DEFAULT_FROM = `${NEWSLETTER.sender} <${NEWSLETTER_EMAIL}>`;

export const siteOrigin = (env) => env.CANONICAL_ORIGIN || DEFAULT_ORIGIN;
/** Remetente do resumo semanal (e do teste dele). */
export const fromAddress = (env) => env.NEWSLETTER_FROM || DEFAULT_FROM;
/** Remetente das boas-vindas e dos avisos ao editor. */
export const teamFromAddress = (env) => env.TEAM_FROM || `${NEWSLETTER.sender} <${NEWSLETTER_EMAIL}>`;
export const replyTo = (env) => env.NEWSLETTER_REPLY_TO || NEWSLETTER_EMAIL;
export const editorEmails = (env) =>
  String(env.EDITOR_EMAILS || NEWSLETTER_EMAIL)
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
