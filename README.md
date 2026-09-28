# Radar FavCode

Radar de notícias com as manchetes do dia sobre **IA, tecnologia, marketing, design, publicidade, redes sociais, e-commerce e startups**, reunidas de dezenas de veículos do Brasil e do mundo.

- 8 editorias em colunas, com a manchete principal de cada uma em destaque.
- **Em alta agora**: os termos mais citados nas últimas horas, desenhados num radar e listados em ranking.
- Tudo em português: manchetes de veículos em inglês chegam traduzidas (veja "Tradução").
- Busca nas manchetes (atalho `/`) e tema claro/escuro.
- **Favoritos** com a estrela (salvos no navegador) e botão de compartilhar.
- Marca o que chegou desde a última visita e avisa quando há manchetes novas.
- Não publica nada relacionado ao **Google**: a marca e os produtos dele (Google Ads, Google Meu Negócio, Gemini, Android, Chrome, Analytics, Search Console…) são descartados na coleta. O site também não carrega nada do Google: as fontes tipográficas ficam em `assets/fonts`.

## Como funciona

```
config/radar.config.mjs   editorias, fontes RSS, bloqueios e termos monitorados
scripts/build.mjs         busca os feeds, filtra, organiza, traduz e grava o index.html
scripts/lib/translate.mjs tradução das manchetes em inglês com o Claude
data/translations.json    traduções já feitas (reaproveitadas a cada hora)
src/index.template.html   layout, estilos e interação do site
index.html                site pronto (gerado; não edite à mão)
.github/workflows/radar.yml  roda o build a cada hora e publica o index.html
```

O GitHub Actions executa `node scripts/build.mjs` a cada hora (e a cada mudança em `config/`, `scripts/`, `src/` ou `assets/`). O script lê os feeds, descarta manchetes antigas, repetidas, de oferta/cupom e as que citam os assuntos bloqueados, e grava tudo dentro do `index.html`. Se menos de 40 manchetes chegarem (queda de rede, por exemplo), o site anterior é mantido.

Requer Node.js 20 ou mais novo. A única dependência é o SDK da Anthropic (`@anthropic-ai/sdk`), usado na tradução.

## Tradução

As manchetes de veículos em inglês entram no radar já traduzidas para o português do Brasil, feitas pelo Claude (modelo `claude-opus-5`, esforço baixo, resposta em JSON validado). Cada título e resumo é traduzido uma vez só e fica guardado em `data/translations.json`; nas coletas seguintes a tradução é reaproveitada.

Para funcionar, cadastre a chave da API da Anthropic no GitHub: Settings → Secrets and variables → Actions → New repository secret, nome `ANTHROPIC_API_KEY`. A chave é criada em console.anthropic.com.

Sem a chave (ou se a API falhar), o site nunca mostra manchete em inglês: as que ainda não têm tradução guardada ficam de fora até a próxima coleta.

Custo aproximado: com 10 a 20 manchetes novas em inglês por hora, fica na faixa de US$ 20 a US$ 40 por mês com o `claude-opus-5`. Para gastar menos, crie a variável `RADAR_TRANSLATION_MODEL` (Settings → Secrets and variables → Actions → Variables) com `claude-sonnet-5` ou `claude-haiku-4-5`; o Haiku sai cerca de 5 vezes mais barato.

## Publicar

O `index.html` e a pasta `assets/` formam o site inteiro. Qualquer hospedagem estática serve:

- **GitHub Pages**: Settings → Pages → Deploy from a branch → escolha o branch e a pasta `/ (root)`.
- **Vercel, Netlify ou Cloudflare Pages**: importe o repositório, sem comando de build e com a raiz como pasta de saída. Cada atualização do radar vira um deploy novo.

Depois de publicar, cadastre o endereço em Settings → Secrets and variables → Actions → Variables com o nome `SITE_URL` (ex.: `https://radar.favcode.com.br`). Ele entra nas tags de compartilhamento para o WhatsApp e redes sociais mostrarem a imagem.

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

Para testar sem internet, salve os feeds em uma pasta como `<fonte>-<editoria>.xml` (ex.: `tecnoblog-tecnologia.xml`) e rode `RADAR_FIXTURES=pasta npm run build`.

Espaço reservado para o Meta Pixel: comentário `<!-- PIXEL -->` no `<head>` de `src/index.template.html`.
