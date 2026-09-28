# Radar FavCode

Radar de notícias com as manchetes do dia sobre **IA, tecnologia, marketing, design, publicidade, redes sociais, e-commerce e startups**, reunidas de dezenas de veículos do Brasil e do mundo.

- 8 editorias em colunas, com a manchete principal de cada uma em destaque.
- **Em alta agora**: os termos mais citados nas últimas horas, desenhados num radar e listados em ranking.
- Busca nas manchetes (atalho `/`), filtro de idioma (PT/EN), tema claro/escuro.
- **Favoritos** com a estrela (salvos no navegador) e botão de compartilhar.
- Marca o que chegou desde a última visita e avisa quando há manchetes novas.
- Não publica nada relacionado ao **Google**: a marca e os produtos dele (Google Ads, Google Meu Negócio, Gemini, Android, Chrome, Analytics, Search Console…) são descartados na coleta. O site também não carrega nada do Google: as fontes tipográficas ficam em `assets/fonts`.

## Como funciona

```
config/radar.config.mjs   editorias, fontes RSS, bloqueios e termos monitorados
scripts/build.mjs         busca os feeds, filtra, organiza e grava o index.html
src/index.template.html   layout, estilos e interação do site
index.html                site pronto (gerado; não edite à mão)
.github/workflows/radar.yml  roda o build a cada hora e publica o index.html
```

O GitHub Actions executa `node scripts/build.mjs` a cada hora (e a cada mudança em `config/`, `scripts/`, `src/` ou `assets/`). O script lê os feeds, descarta manchetes antigas, repetidas, de oferta/cupom e as que citam os assuntos bloqueados, e grava tudo dentro do `index.html`. Se menos de 40 manchetes chegarem (queda de rede, por exemplo), o site anterior é mantido.

Não há dependências: só Node.js 20 ou mais novo.

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
npm test        # testes do leitor de feeds, filtros e "Em alta"
npm run build   # busca os feeds e gera o index.html
npm run render  # só reaplica o template (src/) às manchetes atuais, sem internet
```

Para testar sem internet, salve os feeds em uma pasta como `<fonte>-<editoria>.xml` (ex.: `tecnoblog-tecnologia.xml`) e rode `RADAR_FIXTURES=pasta npm run build`.

Espaço reservado para o Meta Pixel: comentário `<!-- PIXEL -->` no `<head>` de `src/index.template.html`.
