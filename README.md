# Radar FavCode

Radar de notícias com as manchetes do dia sobre **IA, tecnologia, marketing, design, publicidade, redes sociais, e-commerce e startups**, reunidas de dezenas de veículos do Brasil e do mundo.

- 8 editorias em colunas, com a manchete principal de cada uma em destaque.
- **Em alta agora**: os termos mais citados nas últimas horas, desenhados num radar e listados em ranking.
- Tudo em português: manchetes de veículos em inglês chegam traduzidas (veja "Tradução").
- Busca nas manchetes (atalho `/`) e tema claro/escuro.
- **Favoritos** com a estrela (salvos no navegador) e botão de compartilhar.
- Marca o que chegou desde a última visita e avisa quando há manchetes novas.
- **Protegido contra cópia**: só abre no endereço oficial, não pode ser exibido dentro de outro site e bloqueia programas de clonagem e robôs de IA (veja "Direitos autorais e proteção contra cópia").
- Não publica nada relacionado ao **Google**: a marca e os produtos dele (Google Ads, Google Meu Negócio, Gemini, Android, Chrome, Analytics, Search Console…) são descartados na coleta. O site também não carrega nada do Google: as fontes tipográficas ficam em `assets/fonts`.

## Como funciona

```
config/radar.config.mjs   editorias, fontes RSS, bloqueios e termos monitorados
scripts/build.mjs         busca os feeds, filtra, organiza, traduz e grava o index.html
scripts/lib/translate.mjs tradução das manchetes em inglês com o Claude
data/translations.json    traduções já feitas (reaproveitadas a cada hora)
src/index.template.html   layout, estilos e interação do site
index.html                site pronto (gerado e minificado; não edite à mão)
cloudflare/worker.mjs     Worker que publica o site na Cloudflare e aplica as proteções
.github/workflows/radar.yml  roda o build a cada hora e publica o index.html
LICENSE                   direitos reservados (uso proibido sem autorização)
```

O GitHub Actions executa `node scripts/build.mjs` a cada hora (e a cada mudança em `config/`, `scripts/`, `src/` ou `assets/`). O script lê os feeds, descarta manchetes antigas, repetidas, de oferta/cupom e as que citam os assuntos bloqueados, e grava tudo dentro do `index.html`. Se menos de 40 manchetes chegarem (queda de rede, por exemplo), o site anterior é mantido.

Requer Node.js 20 ou mais novo. A única dependência é o SDK da Anthropic (`@anthropic-ai/sdk`), usado na tradução; o `esbuild` entra só no build, para minificar a página.

## Tradução

As manchetes de veículos em inglês entram no radar já traduzidas para o português do Brasil, feitas pelo Claude (modelo `claude-opus-5`, esforço baixo, resposta em JSON validado). Cada título e resumo é traduzido uma vez só e fica guardado em `data/translations.json`; nas coletas seguintes a tradução é reaproveitada.

Para funcionar, cadastre a chave da API da Anthropic no GitHub: Settings → Secrets and variables → Actions → New repository secret, nome `ANTHROPIC_API_KEY`. A chave é criada em console.anthropic.com.

Sem a chave (ou se a API falhar), o site nunca mostra manchete em inglês: as que ainda não têm tradução guardada ficam de fora até a próxima coleta.

Custo aproximado: com 10 a 20 manchetes novas em inglês por hora, fica na faixa de US$ 20 a US$ 40 por mês com o `claude-opus-5`. Para gastar menos, crie a variável `RADAR_TRANSLATION_MODEL` (Settings → Secrets and variables → Actions → Variables) com `claude-sonnet-5` ou `claude-haiku-4-5`; o Haiku sai cerca de 5 vezes mais barato.

## Publicado na Cloudflare

O site está em **https://radar.favcode.com.br**, servido pelo Worker `radar-favcode` (código em `cloudflare/worker.mjs`):

- A cada 15 minutos o Worker busca o `index.html` mais recente do branch padrão do repositório e guarda no KV `radar-favcode`. Os visitantes recebem sempre a cópia guardada, mesmo que o GitHub esteja fora do ar.
- Fontes e imagens de `assets/` são renovadas uma vez por dia.
- As tags de compartilhamento (imagem e endereço) saem com o domínio oficial, para a prévia aparecer no WhatsApp.
- O domínio `favcode.com.br` é registrado no Registro.br e tem o DNS na Cloudflare (servidores `amber` e `hunts`). O subdomínio `radar` é um Custom Domain do Worker, com certificado HTTPS automático.
- O endereço provisório https://radar-favcode.molettocomunicacao.workers.dev redireciona (301) para o domínio oficial, com o mesmo caminho: é o binding `CANONICAL_ORIGIN` do Worker.

O agendamento de hora em hora do GitHub Actions costuma atrasar ou pular horários. Para garantir uma coleta por hora, o Worker pode disparar o workflow: crie um token em GitHub → Settings → Developer settings → Fine-grained tokens, com acesso só ao repositório `molettodigital/Favcode` e as permissões **Contents: Read-only** e **Actions: Read and write**, e cadastre-o na Cloudflare em Workers & Pages → `radar-favcode` → Settings → Variables and Secrets → Add, tipo **Secret**, nome `GITHUB_TOKEN`. Sem o token, o site continua funcionando com as coletas que o GitHub fizer.

Para mudar o código do Worker, edite `cloudflare/worker.mjs` e publique de novo pela API da Cloudflare (upload do script com os bindings `RADAR`, `SOURCE`, `GITHUB_REPO`, `LIMITER` e `CANONICAL_ORIGIN`, mantendo `keep_bindings: ["secret_text"]` para não perder o token).

## Direitos autorais e proteção contra cópia

O código, o layout, a marca FavCode e a seleção e organização das notícias são de uso exclusivo da FavCode (arquivo `LICENSE`; Lei nº 9.610/1998 e Lei nº 9.279/1996). O aviso de direitos reservados aparece no rodapé do site e no código-fonte da página. As matérias, títulos e imagens continuam sendo de cada veículo; o radar só aponta para elas.

Camadas de proteção:

- **Só abre no endereço oficial.** Se alguém salvar a página e publicar em outro domínio, a cópia redireciona o visitante para o radar original. A lista de endereços permitidos fica em `site.allowedHosts`, em `config/radar.config.mjs` (abrir o arquivo no próprio computador e em `localhost` continua funcionando, para testes).
- **Não pode ser embutido em outro site.** O Worker envia `X-Frame-Options: DENY` e `Content-Security-Policy: frame-ancestors 'none'`, recusa pedidos feitos por iframe e a página se esconde se mesmo assim for aberta dentro de uma moldura.
- **Programas de clonagem e robôs de IA são bloqueados** (HTTrack, Wget, curl, bibliotecas de raspagem, navegadores automatizados, GPTBot, ClaudeBot, CCBot, Perplexity e outros): recebem erro 403. O `robots.txt` também proíbe esses robôs, e as respostas levam `X-Robots-Tag: noai, noimageai`. Buscadores e as prévias de link do WhatsApp, Instagram, Facebook, LinkedIn, X, Telegram, Slack e Discord continuam funcionando.
- **Fontes e logo só funcionam aqui.** Outro site que tente carregar esses arquivos do radar recebe 403 (a imagem de compartilhamento fica liberada para as prévias).
- **Limite de acessos:** mais de 240 pedidos por minuto do mesmo IP recebem erro 429 por um minuto (binding `LIMITER` do Worker).
- **Código minificado** (`esbuild`): o HTML publicado sai compactado, sem comentários, o que dificulta reaproveitar o código.
- **Crédito automático:** quem copiar um trecho grande de texto do site leva junto a fonte e o aviso de direitos reservados.

Nenhum site público é 100% à prova de cópia: tudo o que o navegador mostra pode ser salvo por alguém determinado, e um raspador que se passa por navegador comum não tem como ser identificado com certeza. As camadas acima tiram a cópia fácil e deixam registrado de quem é o conteúdo, o que dá base para pedir a remoção de uma cópia (ao provedor, pela Lei nº 9.610/1998, ou pelo formulário de denúncia de violação de direitos autorais da hospedagem).

**Repositório privado.** Enquanto o repositório for público, qualquer um pode baixar o código completo no GitHub. Para fechar essa porta: cadastre o `GITHUB_TOKEN` na Cloudflare (seção anterior; com ele o Worker lê o repositório privado pela API do GitHub) e depois vá em GitHub → Settings → General → Danger Zone → Change repository visibility → Private. O site continua no ar. Em repositório privado o GitHub Actions passa a descontar minutos do plano: cada coleta leva menos de 1 minuto e, somando o agendamento do GitHub com o disparo do Worker, o total fica entre 700 e 1.500 minutos por mês, dentro dos 2.000 gratuitos.

## Publicar em outro lugar

O `index.html` e a pasta `assets/` formam o site inteiro. Qualquer hospedagem estática serve:

- **GitHub Pages**: Settings → Pages → Deploy from a branch → escolha o branch e a pasta `/ (root)`.
- **Vercel, Netlify ou Cloudflare Pages**: importe o repositório, sem comando de build e com a raiz como pasta de saída. Cada atualização do radar vira um deploy novo.

Depois de publicar, acrescente o novo endereço em `site.allowedHosts` (e troque `site.url`, se ele passar a ser o principal) em `config/radar.config.mjs`; sem isso a proteção contra cópia trata o novo domínio como clone e redireciona para o endereço oficial. `site.url` entra nas tags de compartilhamento para o WhatsApp e redes sociais mostrarem a imagem; a variável `SITE_URL` (Settings → Secrets and variables → Actions → Variables), se existir, tem prioridade sobre ele.

Para o workflow conseguir salvar o `index.html`, Settings → Actions → General → Workflow permissions precisa estar em **Read and write**.

## Editar fontes e assuntos

Tudo fica em `config/radar.config.mjs`:

- `feeds`: cada fonte tem nome, site, idioma, editoria e URL do feed. `routes` manda manchetes de fontes generalistas para a editoria certa (ex.: uma notícia de IA no Tecnoblog vai para a coluna de IA).
- `blocklist`: assuntos que nunca entram (Google e todos os produtos e serviços dele). O YouTube continua; para tirar, acrescente `/\bYouTube\b/i` à lista.
- `noise`: posts que não são notícia (ofertas, cupons, guias de compra, tutoriais, listas).
- `exclude` e `excludeUrl` por fonte: tiram assuntos ou seções fora do tema (ciência, games e carros dos portais de tecnologia, por exemplo).
- `watchlist`: termos acompanhados no "Em alta". Nomes próprios que aparecem em várias fontes entram sozinhos.
- `limits`: quantidade de manchetes por editoria, idade máxima e afins.

## Rodar localmente

```bash
npm install     # instala o SDK da Anthropic
npm test        # testes do leitor de feeds, filtros e "Em alta"
npm run build   # busca os feeds e gera o index.html
npm run render  # só reaplica o template (src/) às manchetes atuais, sem internet
```

O `index.html` sai minificado. Para gerar a versão legível ao depurar, rode com `RADAR_NO_MINIFY=1`.

Para testar sem internet, salve os feeds em uma pasta como `<fonte>-<editoria>.xml` (ex.: `tecnoblog-tecnologia.xml`) e rode `RADAR_FIXTURES=pasta npm run build`.

Espaço reservado para o Meta Pixel: comentário `<!-- PIXEL -->` no `<head>` de `src/index.template.html`.
