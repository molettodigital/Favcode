// HTML dos e-mails (newsletter, boas-vindas e link de acesso ao editor), em tabelas e estilos
// inline, que é o que os programas de e-mail entendem. Todo texto passa por escapeHtml.

import { escapeHtml, paragraphs } from '../lib/util.mjs';
import { NEWSLETTER } from './settings.mjs';

const C = {
  navy: '#060737',
  ink: '#0a0d2e',
  ink2: '#2e3558',
  muted: '#535c82',
  line: '#dde4f2',
  bg: '#f3f6fc',
  soft: '#edf2fb',
  link: '#0847ee',
  sky: '#0aa0f7',
};
const FONT = "'Figtree','Segoe UI',Helvetica,Arial,sans-serif";
const DISPLAY = "'Sora','Segoe UI',Helvetica,Arial,sans-serif";

export const UNSUBSCRIBE_PLACEHOLDER = '{{{RESEND_UNSUBSCRIBE_URL}}}';

const p = (html, style = '') =>
  `<p style="margin:0 0 14px;font-family:${FONT};font-size:16px;line-height:1.6;color:${C.ink2};${style}">${html}</p>`;

function layout({ title, preheader = '', body, footer, origin }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg};">${escapeHtml(preheader)}${'&#8199;&#65279;&#847; '.repeat(30)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid ${C.line};">
<tr><td style="background:${C.navy};padding:22px 28px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="padding-right:12px;"><img src="${escapeHtml(origin)}/assets/favcode-mark-180.png" width="36" height="36" alt="FavCode" style="display:block;border:0;"></td>
    <td style="font-family:${DISPLAY};font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">Fav<span style="color:${C.sky};">Code</span> <span style="font-family:${FONT};font-size:12px;font-weight:600;letter-spacing:0.14em;color:#bff9ff;">RADAR</span></td>
  </tr></table>
</td></tr>
${body}
<tr><td style="padding:20px 28px 26px;border-top:1px solid ${C.line};background:${C.bg};">${footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

const small = (html) => `<p style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.55;color:${C.muted};">${html}</p>`;

function authorBlock({ author, role, photoUrl }) {
  const initials = author
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const avatar = photoUrl
    ? `<img src="${escapeHtml(photoUrl)}" width="48" height="48" alt="" style="display:block;border-radius:24px;border:0;">`
    : `<div style="width:48px;height:48px;border-radius:24px;background:${C.soft};color:${C.link};font-family:${DISPLAY};font-weight:700;font-size:17px;line-height:48px;text-align:center;">${escapeHtml(initials)}</div>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;"><tr>
    <td style="padding-right:12px;vertical-align:middle;">${avatar}</td>
    <td style="vertical-align:middle;font-family:${FONT};">
      <div style="font-size:15px;font-weight:700;color:${C.ink};">${escapeHtml(author)}</div>
      <div style="font-size:13px;color:${C.muted};">${escapeHtml(role)}</div>
    </td>
  </tr></table>`;
}

function itemBlock(item, { author }) {
  const firstName = author.split(/\s+/)[0];
  const meta = [item.columnName, item.source].filter(Boolean).map(escapeHtml).join(' · ');
  const image =
    item.image && /^https:\/\//.test(item.image)
      ? `<a href="${escapeHtml(item.url)}" style="text-decoration:none;"><img src="${escapeHtml(item.image)}" width="544" alt="" style="display:block;width:100%;max-width:544px;height:auto;border-radius:12px;border:0;margin:0 0 14px;"></a>`
      : '';
  const comment = paragraphs(item.comment);
  return `<tr><td style="padding:8px 28px 26px;">
    ${image}
    ${meta ? `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.muted};">${meta}</p>` : ''}
    <h2 style="margin:0 0 12px;font-family:${DISPLAY};font-size:20px;line-height:1.3;font-weight:700;color:${C.ink};letter-spacing:-0.01em;"><a href="${escapeHtml(item.url)}" style="color:${C.ink};text-decoration:none;">${escapeHtml(item.title)}</a></h2>
    ${
      comment.length
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;"><tr><td style="background:${C.soft};border-left:3px solid ${C.link};border-radius:0 10px 10px 0;padding:14px 16px;">
        <p style="margin:0 0 6px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${C.link};">Comentário da ${escapeHtml(firstName)}</p>
        ${comment.map((c) => `<p style="margin:0 0 8px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.ink2};">${c}</p>`).join('')}
      </td></tr></table>`
        : ''
    }
    <p style="margin:0;font-family:${FONT};font-size:14px;"><a href="${escapeHtml(item.url)}" style="color:${C.link};font-weight:600;text-decoration:none;">Ler a matéria completa →</a></p>
  </td></tr>`;
}

/** Newsletter semanal. Com `unsubscribeUrl` omitido, usa o marcador que o Resend troca pelo link de descadastro. */
export function renderNewsletter(edition, { origin, unsubscribeUrl = UNSUBSCRIBE_PLACEHOLDER, photoUrl = '' } = {}) {
  const author = edition.author || NEWSLETTER.author;
  const role = edition.role || NEWSLETTER.role;
  const items = (edition.items || []).filter((it) => it && it.title && it.url);
  const intro = paragraphs(edition.intro);
  const closing = paragraphs(edition.closing);
  const year = new Date().getFullYear();

  const body = `
<tr><td style="padding:28px 28px 8px;">
  ${edition.week ? `<p style="margin:0 0 16px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${C.muted};">${escapeHtml(edition.week)}</p>` : ''}
  ${authorBlock({ author, role, photoUrl })}
  ${intro.map((x) => p(x)).join('')}
</td></tr>
<tr><td style="padding:0 28px;"><div style="height:1px;background:${C.line};margin:6px 0 22px;"></div></td></tr>
${items.map((it) => itemBlock(it, { author })).join('\n')}
<tr><td style="padding:4px 28px 26px;">
  ${closing.map((x) => p(x)).join('')}
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 0;"><tr><td style="background:${C.navy};border-radius:999px;">
    <a href="${escapeHtml(origin)}/" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">Ver o radar ao vivo</a>
  </td></tr></table>
</td></tr>`;

  const footer = [
    small(`Você recebe este e-mail porque se cadastrou no <a href="${escapeHtml(origin)}/" style="color:${C.muted};">Radar FavCode</a>.`),
    small(
      `<a href="${escapeHtml(unsubscribeUrl)}" style="color:${C.muted};">Descadastrar</a> · <a href="${escapeHtml(origin)}/privacidade" style="color:${C.muted};">Política de privacidade</a>`,
    ),
    small(`© ${year} FavCode. Todos os direitos reservados. As matérias pertencem a cada veículo.`),
  ].join('');

  const html = layout({ title: edition.subject || NEWSLETTER.name, preheader: edition.preheader, body, footer, origin });

  const text = [
    edition.week,
    '',
    `${author} — ${role}`,
    '',
    edition.intro,
    '',
    ...items.flatMap((it) => [
      '————————————————————',
      [it.columnName, it.source].filter(Boolean).join(' · '),
      it.title,
      it.comment ? `\nComentário: ${it.comment}` : '',
      `\nLer a matéria: ${it.url}`,
      '',
    ]),
    edition.closing,
    '',
    `Radar ao vivo: ${origin}/`,
    `Descadastrar: ${unsubscribeUrl}`,
    `Política de privacidade: ${origin}/privacidade`,
  ]
    .filter((line) => line !== undefined && line !== null)
    .join('\n');

  return { html, text };
}

/** Boas-vindas, enviada uma vez, quando a pessoa entra na lista. */
export function renderWelcome({ name, origin }) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  const subject = 'Boas-vindas à newsletter do Radar FavCode';
  const intro = [
    `Oi${first ? `, ${escapeHtml(first)}` : ''}! Que bom ter você por aqui.`,
    `Toda ${NEWSLETTER.day} você vai receber as notícias mais importantes da semana: o que está em alta no digital, IA, tecnologia, marketing e pequenos negócios, com os meus comentários sobre o que cada uma muda para quem trabalha com comunicação ou empreende.`,
    'Enquanto a primeira edição não chega, o radar segue atualizado a cada hora:',
  ];
  const body = `<tr><td style="padding:28px 28px 26px;">
    ${authorBlock({ author: NEWSLETTER.author, role: NEWSLETTER.role })}
    ${intro.map((x) => p(x)).join('')}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;"><tr><td style="background:${C.navy};border-radius:999px;">
      <a href="${escapeHtml(origin)}/" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">Abrir o radar</a>
    </td></tr></table>
    ${p(`Até sexta,<br>${escapeHtml(NEWSLETTER.author)}`)}
  </td></tr>`;
  const footer = [
    small(`Você recebeu este e-mail porque se cadastrou em <a href="${escapeHtml(origin)}/" style="color:${C.muted};">radar.favcode.com.br</a>. Se não foi você, responda este e-mail que tiramos seu endereço da lista. Toda newsletter também tem um link para descadastrar.`),
    small(`<a href="${escapeHtml(origin)}/privacidade" style="color:${C.muted};">Política de privacidade</a> · © ${new Date().getFullYear()} FavCode`),
  ].join('');
  const text = `Oi${first ? `, ${first}` : ''}! Que bom ter você por aqui.\n\nToda ${NEWSLETTER.day} você vai receber as notícias mais importantes da semana: o que está em alta no digital, IA, tecnologia, marketing e pequenos negócios, com os meus comentários.\n\nO radar: ${origin}/\n\nAté sexta,\n${NEWSLETTER.author}\n\nPolítica de privacidade: ${origin}/privacidade`;
  return { subject, html: layout({ title: subject, preheader: 'Toda sexta, as notícias da semana comentadas por Clara Poleto.', body, footer, origin }), text };
}

/** Link de acesso ao editor (pedido de login ou aviso de rascunho pronto). */
export function renderEditorLink({ link, origin, draft = null }) {
  const subject = draft ? `Rascunho da newsletter pronto: ${draft.week || draft.id}` : 'Seu link de acesso ao editor da newsletter';
  const lines = draft
    ? [
        `O rascunho da newsletter desta semana está pronto, com ${draft.items?.length || 0} notícias e sugestões de comentário para você revisar.`,
        'Revise, escreva do seu jeito e envie quando quiser. O link abaixo vale por 4 dias.',
      ]
    : ['Use o botão abaixo para entrar no editor da newsletter. O link vale por 30 minutos e só funciona para você.'];
  const body = `<tr><td style="padding:28px 28px 26px;">
    ${lines.map((x) => p(escapeHtml(x))).join('')}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px;"><tr><td style="background:${C.link};border-radius:999px;">
      <a href="${escapeHtml(link)}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">${draft ? 'Abrir o rascunho' : 'Entrar no editor'}</a>
    </td></tr></table>
    ${p(`Se o botão não funcionar, copie este endereço: <br><span style="word-break:break-all;color:${C.muted};font-size:13px;">${escapeHtml(link)}</span>`)}
  </td></tr>`;
  const footer = small('Se você não pediu este e-mail, pode ignorá-lo: ninguém entra no editor sem este link.');
  const text = `${lines.join('\n\n')}\n\n${link}`;
  return { subject, html: layout({ title: subject, preheader: lines[0], body, footer, origin }), text };
}
