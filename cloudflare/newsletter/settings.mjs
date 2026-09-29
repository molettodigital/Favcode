// Dados fixos da newsletter. O texto do consentimento e a política de privacidade têm versão:
// ao mudar um deles, atualize CONSENT_VERSION aqui e em config/radar.config.mjs (newsletter).

export const NEWSLETTER = {
  name: 'Newsletter do Radar FavCode',
  author: 'Clara Poleto',
  role: 'Redatora Publicitária e Colunista do FavCode',
  day: 'sexta-feira',
  closing: 'Até a próxima sexta,\nClara Poleto',
};

export const CONSENT_VERSION = '2026-09-29';

const DEFAULT_ORIGIN = 'https://radar.favcode.com.br';

/**
 * Caixa da newsletter: remetente, resposta dos leitores e login do editor.
 * noticias@favcode.com.br é uma caixa do Zoho Mail (mail.zoho.com).
 */
export const NEWSLETTER_EMAIL = 'noticias@favcode.com.br';
const DEFAULT_FROM = `Clara Poleto · Radar FavCode <${NEWSLETTER_EMAIL}>`;

export const siteOrigin = (env) => env.CANONICAL_ORIGIN || DEFAULT_ORIGIN;
export const fromAddress = (env) => env.NEWSLETTER_FROM || DEFAULT_FROM;
export const replyTo = (env) => env.NEWSLETTER_REPLY_TO || NEWSLETTER_EMAIL;
export const editorEmails = (env) =>
  String(env.EDITOR_EMAILS || NEWSLETTER_EMAIL)
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
