// Configuração do Radar FavCode.
// Editorias, fontes (feeds RSS/Atom), bloqueios e termos monitorados.
// Para incluir uma fonte, adicione um objeto em `feeds`; para tirar, apague a linha.

/**
 * Dados do site e proteção contra cópia. `allowedHosts` são os únicos endereços onde o radar abre;
 * uma cópia publicada em qualquer outro domínio redireciona o visitante para `url`.
 * Ao ligar outro domínio, acrescente-o aqui. O endereço .workers.dev continua na lista porque o
 * Worker só passa a redirecioná-lo depois que a página com o domínio oficial está publicada.
 */
export const site = {
  name: 'Radar FavCode',
  owner: 'FavCode',
  url: 'https://radar.favcode.com.br',
  allowedHosts: ['radar.favcode.com.br', 'radar-favcode.molettocomunicacao.workers.dev'],
};

/**
 * Newsletter semanal comentada pela Clara. Com `enabled`, o site pede cadastro (nome, e-mail e
 * telefone opcional) a partir da matéria número `freeReads + 1`. Só liga com `privacyEmail`
 * preenchido: a política de privacidade precisa de um contato para os pedidos da LGPD.
 * noticias@favcode.com.br é encaminhado pela Cloudflare (Email Routing) para o e-mail da conta.
 * `consentVersion` acompanha o texto do consentimento e da política; ao mudar um deles, atualize
 * aqui e em cloudflare/newsletter/settings.mjs.
 */
export const newsletter = {
  enabled: true,
  freeReads: 1,
  author: 'Clara Poleto',
  role: 'Redatora Publicitária e Colunista do FavCode',
  day: 'sexta-feira',
  controller: 'FavCode',
  privacyEmail: 'noticias@favcode.com.br',
  consentVersion: '2026-09-29',
  turnstileSiteKey: '0x4AAAAAAFIhmsH5ZAf0Qnyv',
};

/**
 * Editorias, na ordem em que aparecem no site e nos setores do radar.
 * Cores: paleta categórica validada (daltonismo e contraste) para fundo claro (`color`)
 * e escuro (`colorDark`). A ordem importa: setores vizinhos no radar têm cores bem distintas.
 * Com dez editorias a cor nunca identifica sozinha: todo card e setor leva o nome ou a sigla.
 */
export const columns = [
  { id: 'ia', name: 'Inteligência artificial', short: 'IA', code: 'IA', color: '#2a78d6', colorDark: '#3987e5', blurb: 'Modelos, agentes, ferramentas e o que muda no trabalho com IA.' },
  { id: 'tecnologia', name: 'Tecnologia', short: 'Tecnologia', code: 'TEC', color: '#eb6834', colorDark: '#d95926', blurb: 'Big techs, gadgets, plataformas, regulação e infraestrutura.' },
  { id: 'marketing', name: 'Marketing', short: 'Marketing', code: 'MKT', color: '#1baf7a', colorDark: '#199e70', blurb: 'Estratégia, dados, SEO, CRM e comportamento do consumidor.' },
  { id: 'marca', name: 'Marca e branding', short: 'Branding', code: 'BRAND', color: '#a150a2', colorDark: '#903ab2', blurb: 'Rebrands, identidade visual, posicionamento, naming, embalagens e reputação de marca.' },
  { id: 'design', name: 'Design', short: 'Design', code: 'DES', color: '#eda100', colorDark: '#c98500', blurb: 'UX, UI, tipografia, ilustração, motion e ferramentas.' },
  { id: 'publicidade', name: 'Publicidade', short: 'Publicidade', code: 'PUB', color: '#e87ba4', colorDark: '#d55181', blurb: 'Campanhas, agências, criatividade, mídia e premiações.' },
  { id: 'social', name: 'Redes sociais', short: 'Redes sociais', code: 'SOC', color: '#008300', colorDark: '#008300', blurb: 'Instagram, TikTok, YouTube, LinkedIn, creators e influência.' },
  { id: 'pautas', name: 'Pautas em alta', short: 'Pautas', code: 'PAUTA', color: '#9d024c', colorDark: '#9a4855', blurb: 'Virais, trends, datas e novidades úteis do momento para usar em conteúdo, redes e campanhas.' },
  { id: 'ecommerce', name: 'E-commerce e varejo', short: 'E-commerce', code: 'ECOM', color: '#4a3aa7', colorDark: '#9085e9', blurb: 'Marketplaces, varejo digital, pagamentos e datas sazonais.' },
  { id: 'startups', name: 'Startups e negócios', short: 'Startups', code: 'STA', color: '#e34948', colorDark: '#e66767', blurb: 'Rodadas, aquisições, lançamentos e movimentos do mercado.' },
];

// Regras de redirecionamento: fontes generalistas mandam a manchete para a
// editoria mais específica quando o título casa com o padrão.
const AI = /\b(?:IA|AI|LLMs?|GenAI)\b|intelig[eê]ncia artificial|artificial intelligence|\bChat\s?GPT\b|\bOpen\s?AI\b|\bGPT-?\d|\bClaude\b|\bAnthropic\b|\bCopilot\b|\bMidjourney\b|\bDeepSeek\b|\bLlama\b|\bMistral\b|\bPerplexity\b|\bGrok\b|\bxAI\b|machine learning|aprendizado de m[aá]quina|\bchatbots?\b|\bagentes? de IA\b|\bAI agents?\b|\bagentic\b|\bag[eê]ntic[ao]s?\b|\bgenerativ[ao]s?\b|\bgenerative\b/;
const SOCIAL = /\b(?:Instagram|TikTok|Threads|YouTube|YouTubers?|WhatsApp|LinkedIn|Bluesky|Facebook|Snapchat|Pinterest|Kwai|Twitch|Reels|Stories)\b|\binfluenciador(?:a|es|as)?\b|\binfluencers?\b|\bcreators?\b|criador(?:es|as)? de conte[uú]do|redes sociais|social media|creator economy/i;
const ECOM = /\be-?commerce\b|\bvarejo\b|\bvarejistas?\b|\bShopee\b|\bMercado Livre\b|\bMagalu\b|\bShein\b|\bTemu\b|\bmarketplaces?\b|\bBlack Friday\b|loja virtual|com[eé]rcio eletr[oô]nico|\bretail(?:ers?)?\b|\bTikTok Shop\b/i;
const STARTUP = /\bstartups?\b|\brodada\b|\baporte\b|\bunic[oó]rnios?\b|\bunicorns?\b|venture capital|\bSeries [A-E]\b|\bS[eé]rie [A-E]\b|\braises \$|\bfunding\b|\bIPO\b|\badquire\b|\baquisi[cç][aã]o\b|\bacquires?\b|\bacquisition\b/i;
// Marca: rebrands, identidade, posicionamento, naming e embalagem.
const BRAND = /\brebrand\w*|\bbranding\b|\bbrand (?:identity|refresh|strategy|positioning|purpose|platform|architecture|equity|guidelines|values?)\b|\bvisual identit\w*|\bidentit(?:y|ies)\b|\bnew\b[\w\s'’-]{0,30}\blogo\b|\blogos\b|\blogo (?:design|redesign|refresh|change|reveal)\b|\blogo(?:tipo|marca)\b|\bidentidades? visua(?:l|is)\b|\bnova identidade\b|\bnova marca\b|\bnov[oa] logo\b|\breposicion\w*|\bposicionamento de marca\b|\b(?:o|de|do|um|novo) naming\b|\bnaming (?:de|da|do|e)\b|\bbrand naming\b|\bembalage(?:m|ns)\b|\bpackaging\b|\bmascotes?\b|\bmascots?\b|\bmost valuable brands?\b|\bmarcas? mais valiosas?\b|\bInterbrand\b|\bBrandZ\b|\bbrand value\b|\bvalor de marca\b/i;
// Pautas: virais, memes, trends, datas e recursos novos que dá para usar no conteúdo.
const TRENDING = /\bvira(?:l|is)\b|\bviraliz\w*|\b(?:goes|went|gone) viral\b|\bmemes?\b|\btrends?\b|\btrending\b|\btend[eê]ncias?\b|\b(?:TikTok|viral|dance) challenges?\b|\bdesafio (?:viral|do TikTok)\b|\bdatas? comemorativ\w*|\bcalend[aá]rio (?:de conte[uú]do|editorial|de datas|de marketing)\b|\bhashtags?\b|\bem alta\b|\bbombou\b|\bnovos? recursos?\b|\bnovas? fun[cç](?:ão|ões)\b|\b(?:novidades?|recursos?) d[oa]s? (?:Instagram|TikTok|WhatsApp|YouTube|LinkedIn|Threads|Reels|Canva|CapCut|redes)\b|\bnew features?\b|\bdicas?\b|\btips\b|\bpasso a passo\b|\bmais (?:vist[oa]s|visualizad[oa]s|ouvid[oa]s|baixad[oa]s|buscad[oa]s|assistid[oa]s|comentad[oa]s)\b|\bmost[\s-](?:viewed|watched|downloaded|searched|subscribed|shared)\b/i;
const ADS = /\bag[eê]ncias?\b|\bcampanhas?\b|\bpublicidade\b|\bpropaganda\b|\bpublicit[aá]ri[oa]s?\b|\bcomerciais?\b|\bfilme publicit|\bCannes\b|\bLe[oõ]es\b|\bcria[cç][aã]o\b|\bcriativ[oa]s?\b|\bad campaign\b|\bagency\b|\bagencies\b|\bcampaign\b/i;

// Fontes generalistas também publicam ciência, carros e curiosidades: fora do radar.
const OFF_TOPIC = /\b(?:placas? tect[oô]nicas?|asteroides?|cometas?|gal[aá]xias?|telesc[oó]pios?|buracos? negros?|dinossauros?|f[oó]sseis|f[oó]ssil|vulc[aã]o|terremotos?|tsunamis?|eclipses?|meteoros?|exoplanetas?|arqueolog|paleontolog|esp[eé]cies?|cientistas descobrem|hor[oó]scopo|signos?|carros?|motos?|picapes?|SUVs?|sed[aã]s?|hatch|Volkswagen|Fiat|Chevrolet|Toyota|Hyundai|Renault|Jeep|Nissan|Fórmula 1|F1|abuso sexual|pornografia infantil|pedofil\w*|estupr\w*|homic[ií]dios?|assassinad[oa]s?|latroc[ií]nio|fac[cç](?:ão|ões) criminos\w*)\b/i;

const techRoutes = [
  { column: 'ia', match: AI },
  { column: 'pautas', match: TRENDING },
  { column: 'social', match: SOCIAL },
  { column: 'ecommerce', match: ECOM },
  { column: 'startups', match: STARTUP },
];

/**
 * Fontes. `column` é a editoria padrão; `routes` (opcional) redireciona por título;
 * `include`/`exclude` (opcionais) filtram manchetes daquela fonte.
 */
export const feeds = [
  // Inteligência artificial
  { name: 'Olhar Digital', site: 'https://olhardigital.com.br', lang: 'pt', column: 'ia', url: 'https://olhardigital.com.br/tag/inteligencia-artificial/feed/' },
  { name: 'The Verge', site: 'https://www.theverge.com', lang: 'en', column: 'ia', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { name: 'TechCrunch', site: 'https://techcrunch.com', lang: 'en', column: 'ia', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { name: 'MIT Technology Review', site: 'https://www.technologyreview.com', lang: 'en', column: 'ia', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed' },
  { name: 'The Decoder', site: 'https://the-decoder.com', lang: 'en', column: 'ia', url: 'https://the-decoder.com/feed/' },
  { name: 'OpenAI', site: 'https://openai.com/news', lang: 'en', column: 'ia', url: 'https://openai.com/news/rss.xml' },
  { name: 'Hugging Face', site: 'https://huggingface.co/blog', lang: 'en', column: 'ia', url: 'https://huggingface.co/blog/feed.xml' },

  // Tecnologia (fontes generalistas: redirecionam para IA, redes, e-commerce e startups)
  { name: 'Tecnoblog', site: 'https://tecnoblog.net', lang: 'pt', column: 'tecnologia', url: 'https://tecnoblog.net/feed/', routes: techRoutes, exclude: OFF_TOPIC, excludeUrl: /\/achados\// },
  { name: 'Olhar Digital', site: 'https://olhardigital.com.br', lang: 'pt', column: 'tecnologia', url: 'https://olhardigital.com.br/feed/', routes: techRoutes, exclude: OFF_TOPIC, excludeUrl: /\/\d{2}\/(?:ciencia-e-espaco|reviews|games-e-consoles|carros-e-tecnologia|medicina-e-saude|cinema-e-streaming|dicas-e-tutoriais|videos)\// },
  { name: 'Canaltech', site: 'https://canaltech.com.br', lang: 'pt', column: 'tecnologia', url: 'https://canaltech.com.br/rss/', routes: techRoutes, exclude: OFF_TOPIC, excludeUrl: /canaltech\.com\.br\/(?:entretenimento|games|ciencia|espaco|saude|carros|veiculos|e-reader|curiosidades|meio-ambiente|filmes|series|quadrinhos|anime|esportes|casa-conectada|produtos|ofertas)\// },
  { name: 'g1 Tecnologia', site: 'https://g1.globo.com/tecnologia/', lang: 'pt', column: 'tecnologia', url: 'https://g1.globo.com/rss/g1/tecnologia/', routes: techRoutes, exclude: OFF_TOPIC, excludeUrl: /g1\.globo\.com\/(?:fantastico|ciencia|saude|turismo-e-viagem|pop-arte|natureza|inovacao)\// },
  { name: 'The Verge', site: 'https://www.theverge.com', lang: 'en', column: 'tecnologia', url: 'https://www.theverge.com/rss/tech/index.xml', routes: techRoutes },
  { name: 'Ars Technica', site: 'https://arstechnica.com', lang: 'en', column: 'tecnologia', url: 'https://feeds.arstechnica.com/arstechnica/technology-lab', routes: techRoutes },

  // Marketing
  { name: 'Meio & Mensagem', site: 'https://www.meioemensagem.com.br', lang: 'pt', column: 'marketing', url: 'https://www.meioemensagem.com.br/feed', routes: [{ column: 'marca', match: BRAND }, { column: 'pautas', match: TRENDING }, { column: 'publicidade', match: ADS }, { column: 'social', match: SOCIAL }] },
  { name: 'Consumidor Moderno', site: 'https://www.consumidormoderno.com.br', lang: 'pt', column: 'marketing', url: 'https://www.consumidormoderno.com.br/feed/', routes: [{ column: 'marca', match: BRAND }, { column: 'pautas', match: TRENDING }, { column: 'ecommerce', match: ECOM }] },
  { name: 'Marketing Dive', site: 'https://www.marketingdive.com', lang: 'en', column: 'marketing', url: 'https://www.marketingdive.com/feeds/news/', routes: [{ column: 'marca', match: BRAND }] },
  { name: 'MarTech', site: 'https://martech.org', lang: 'en', column: 'marketing', url: 'https://martech.org/feed/' },
  { name: 'Search Engine Journal', site: 'https://www.searchenginejournal.com', lang: 'en', column: 'marketing', url: 'https://www.searchenginejournal.com/feed/' },
  { name: 'HubSpot', site: 'https://blog.hubspot.com/marketing', lang: 'en', column: 'marketing', url: 'https://blog.hubspot.com/marketing/rss.xml', routes: [{ column: 'pautas', match: TRENDING }] },

  // Marca e branding
  { name: 'BP&O', site: 'https://bpando.org', lang: 'en', column: 'marca', url: 'https://bpando.org/feed/' },
  { name: 'Brandingmag', site: 'https://www.brandingmag.com', lang: 'en', column: 'marca', url: 'https://www.brandingmag.com/feed/' },
  { name: 'GKPB', site: 'https://gkpb.com.br', lang: 'pt', column: 'marca', url: 'https://gkpb.com.br/feed/', routes: [{ column: 'pautas', match: TRENDING }, { column: 'publicidade', match: ADS }] },

  // Design
  { name: 'Design Culture', site: 'https://designculture.com.br', lang: 'pt', column: 'design', url: 'https://designculture.com.br/feed', routes: [{ column: 'marca', match: BRAND }] },
  { name: 'Smashing Magazine', site: 'https://www.smashingmagazine.com', lang: 'en', column: 'design', url: 'https://www.smashingmagazine.com/feed/' },
  { name: 'Creative Bloq', site: 'https://www.creativebloq.com', lang: 'en', column: 'design', url: 'https://www.creativebloq.com/feeds.xml', routes: [{ column: 'marca', match: BRAND }], exclude: /\breview:|\b(?:laptops?|batter(?:y|ies)|gaming|PS5|PlayStation|Xbox|Nintendo|Marvel|Wolverine|TVs?|monitors?|headphones|earbuds|VPN|Black Friday|Prime Day)\b/i },
  { name: 'UX Collective', site: 'https://uxdesign.cc', lang: 'en', column: 'design', url: 'https://uxdesign.cc/feed' },
  { name: 'Abduzeedo', site: 'https://abduzeedo.com', lang: 'en', column: 'design', url: 'https://abduzeedo.com/rss.xml', routes: [{ column: 'marca', match: BRAND }] },
  { name: 'designboom', site: 'https://www.designboom.com', lang: 'en', column: 'design', url: 'https://www.designboom.com/design/feed/', routes: [{ column: 'marca', match: BRAND }] },
  { name: 'Nielsen Norman Group', site: 'https://www.nngroup.com', lang: 'en', column: 'design', url: 'https://www.nngroup.com/feed/rss/' },
  { name: 'Fast Company', site: 'https://www.fastcompany.com/co-design', lang: 'en', column: 'design', url: 'https://www.fastcompany.com/co-design/rss', routes: [{ column: 'marca', match: BRAND }], exclude: /\b(?:Mars|Martian|climate|carbon|glaciers?|reefs?|yeast|species|fossil fuels?|heat waves?|floods?)\b/i },
  { name: 'Figma', site: 'https://www.figma.com/blog', lang: 'en', column: 'design', url: 'https://www.figma.com/blog/feed/atom.xml' },
  { name: 'Creative Review', site: 'https://www.creativereview.co.uk', lang: 'en', column: 'design', url: 'https://www.creativereview.co.uk/feed/', routes: [{ column: 'marca', match: BRAND }, { column: 'publicidade', match: ADS }] },
  { name: 'Creative Boom', site: 'https://www.creativeboom.com', lang: 'en', column: 'design', url: 'https://www.creativeboom.com/feed/', routes: [{ column: 'marca', match: BRAND }, { column: 'publicidade', match: ADS }] },

  // Publicidade
  { name: 'Propmark', site: 'https://propmark.com.br', lang: 'pt', column: 'publicidade', url: 'https://propmark.com.br/feed/', routes: [{ column: 'marca', match: BRAND }, { column: 'pautas', match: TRENDING }], excludeUrl: /\/acervo\// },
  { name: 'ADNEWS', site: 'https://adnews.com.br', lang: 'pt', column: 'publicidade', url: 'https://adnews.com.br/feed/', routes: [{ column: 'marca', match: BRAND }, { column: 'pautas', match: TRENDING }, { column: 'social', match: SOCIAL }] },
  { name: 'B9', site: 'https://www.b9.com.br', lang: 'pt', column: 'publicidade', url: 'https://www.b9.com.br/feed/', routes: [{ column: 'marca', match: BRAND }, { column: 'pautas', match: TRENDING }] },
  { name: 'Adweek', site: 'https://www.adweek.com', lang: 'en', column: 'publicidade', url: 'https://www.adweek.com/feed/', routes: [{ column: 'marca', match: BRAND }, { column: 'pautas', match: TRENDING }] },
  { name: 'Muse by Clio', site: 'https://musebycl.io', lang: 'en', column: 'publicidade', url: 'https://musebycl.io/rss.xml', routes: [{ column: 'marca', match: BRAND }] },
  { name: 'Campaign', site: 'https://www.campaignlive.com', lang: 'en', column: 'publicidade', url: 'https://www.campaignlive.com/rss/news', routes: [{ column: 'marca', match: BRAND }] },

  // Redes sociais
  { name: 'Social Media Today', site: 'https://www.socialmediatoday.com', lang: 'en', column: 'social', url: 'https://www.socialmediatoday.com/feeds/news/', routes: [{ column: 'pautas', match: TRENDING }] },
  { name: 'TechCrunch', site: 'https://techcrunch.com', lang: 'en', column: 'social', url: 'https://techcrunch.com/category/social/feed/', routes: [{ column: 'pautas', match: TRENDING }] },
  { name: 'Tubefilter', site: 'https://www.tubefilter.com', lang: 'en', column: 'social', url: 'https://www.tubefilter.com/feed/', routes: [{ column: 'pautas', match: TRENDING }] },
  { name: 'Olhar Digital', site: 'https://olhardigital.com.br', lang: 'pt', column: 'social', url: 'https://olhardigital.com.br/tag/redes-sociais/feed/', routes: [{ column: 'pautas', match: TRENDING }] },

  // Pautas em alta (guias de ferramentas dos próprios fornecedores ficam de fora)
  { name: 'YOUPIX', site: 'https://youpix.com.br', lang: 'pt', column: 'pautas', url: 'https://youpix.com.br/feed/' },
  { name: 'Social Media Examiner', site: 'https://www.socialmediaexaminer.com', lang: 'en', column: 'pautas', url: 'https://www.socialmediaexaminer.com/feed/' },
  { name: 'Hootsuite', site: 'https://blog.hootsuite.com', lang: 'en', column: 'pautas', url: 'https://blog.hootsuite.com/feed/', exclude: /\bHootsuite\b|\bbest\b.*\btools?\b|\bvs\.?\s/i },
  { name: 'Sprout Social', site: 'https://sproutsocial.com/insights', lang: 'en', column: 'pautas', url: 'https://sproutsocial.com/insights/feed/', exclude: /\bSprout\b|\bbest\b.*\btools?\b|\bvs\.?\s/i },
  { name: 'Buffer', site: 'https://buffer.com/resources', lang: 'en', column: 'pautas', url: 'https://buffer.com/resources/rss/', exclude: /\bBuffer\b|\bbest\b.*\btools?\b|\bvs\.?\s/i },

  // E-commerce e varejo
  { name: 'Modern Retail', site: 'https://www.modernretail.co', lang: 'en', column: 'ecommerce', url: 'https://www.modernretail.co/feed/' },
  { name: 'Retail Dive', site: 'https://www.retaildive.com', lang: 'en', column: 'ecommerce', url: 'https://www.retaildive.com/feeds/news/' },
  { name: 'Practical Ecommerce', site: 'https://www.practicalecommerce.com', lang: 'en', column: 'ecommerce', url: 'https://www.practicalecommerce.com/feed' },

  // Startups e negócios
  { name: 'Startups', site: 'https://startups.com.br', lang: 'pt', column: 'startups', url: 'https://startups.com.br/feed/' },
  { name: 'Startupi', site: 'https://startupi.com.br', lang: 'pt', column: 'startups', url: 'https://startupi.com.br/feed/' },
  { name: 'NeoFeed', site: 'https://neofeed.com.br', lang: 'pt', column: 'startups', url: 'https://neofeed.com.br/feed/', excludeUrl: /neofeed\.com\.br\/(?:finde|insiders|economia|lifestyle|lideres)\// },
  { name: 'LatamList', site: 'https://latamlist.com', lang: 'en', column: 'startups', url: 'https://latamlist.com/feed/' },
  { name: 'TechCrunch', site: 'https://techcrunch.com', lang: 'en', column: 'startups', url: 'https://techcrunch.com/category/startups/feed/' },
];

/**
 * Nada do Google entra no radar: a marca, as pessoas que a comandam e os produtos e serviços
 * dela (Ads, Meu Negócio, Gemini, Android, Chrome, Analytics, Search Console…).
 * Qualquer manchete que cite esses termos no título, no resumo, nas categorias ou na URL é descartada.
 * O YouTube continua no radar por ser uma rede social à parte; para tirar, inclua /\bYouTube\b/i aqui.
 */
export const blocklist = [
  /\bgoogl\w*/i, // Google, Googlebot, "googlar"
  /\bAlphabet\b/,
  /\bSundar Pichai\b|\bPichai\b|\bDemis Hassabis\b/i,
  // IA do Google
  /\bGemini\b|\bGemma\b|\bVeo\b|\bImagen \d/,
  /\bDeepMind\b|\bNotebookLM\b|\bNano Banana\b|\bSynthID\b|\bTensorFlow\b|\bKaggle\b|\bTPUs?\b/i,
  // Sistemas, apps e aparelhos
  /\bAndroid\b|\bGmail\b|\bWaze\b|\bWaymo\b|\bFitbit\b|\bWear ?OS\b|\bPixel (?:\d|Watch|Buds|Fold|Tablet)/i,
  /\bChrome(?:OS|books?)?\b/,
  // Anúncios: Google Ads, AdWords, Performance Max e afins
  /\bad[\s-]*words\b|\bAdSense\b|\bAdMob\b|\bDV360\b/i,
  /\bperformance[\s-]*max\b|\bpmax\b|\bsmart[\s-]*bidding\b|\bkeyword[\s-]*planner\b|planejador de palavras[\s-]*chave|\blocal[\s-]*services[\s-]*ads\b/i,
  // Busca e análise: AI Overviews, atualizações do algoritmo, GA4, Search Console
  /\bAI Overviews?\b|\bAI Mode\b|\bcore (?:algorithm )?update\b|\bspam update\b/i,
  /\bSearch Console\b|\bGSC\b|\bGA4\b|\bLooker Studio\b|\bData Studio\b|\bFirebase\b|\bBigQuery\b/i,
  // Busca paga (na prática, Google Ads mesmo quando o nome não aparece)
  /\bPPC\b|\bpaid search\b|\bbrand bidding\b|\bbusca paga\b/i,
  // Google Meu Negócio / Perfil da Empresa (o nome "Google" já é pego acima)
  /\bGMB\b/,
];

/**
 * Ofertas, cupons e promoções (título, em português e em inglês). Fazem parte de `noise` e
 * também são conferidas de novo nas manchetes traduzidas, junto com `blocklist` e `sponsored`.
 */
export const offers = [
  /\b\d{1,2}\s?% (?:de desconto|off|mais barat[oa])\b/i,
  /\b(?:cupom|cupons|desconto agressivo|menor pre[cç]o|melhor(?:es)? pre[cç]os?|melhor oferta|em promo[cç][aã]o|queda de pre[cç]o|despenca de pre[cç]o|pela metade do pre[cç]o|sem juros)\b/i,
  /\b(?:cai|caem|fica|ficam|sai|saem)\s(?:quase\s)?\d{1,2}\s?%/i,
  /^(?:aproveite|oferta|ofertas|promo[cç][aã]o)\b/i,
  /\b(?:best .+ deals|deal of the day|lowest price|on sale|promo codes?|coupons?|\d{1,2}% off)\b/i,
  /\bpor (?:menos de|apenas|s[oó]) R\$\s?\d|\bchuta a porta\b/i,
  /\bsele[cç][aã]o de .*ofertas\b|\bofertas (?:em|de|para) (?:jogos|games|celulares|notebooks|tablets?|fones|TVs?)\b/i,
];

/**
 * Ruído que não é notícia: posts de oferta/cupom, guias de compra e tutoriais passo a passo.
 * Vale só para o título.
 */
export const noise = [
  ...offers,
  /\b\d+\s(?:modelos|op[cç][oõ]es)\s(?:para comprar|para jogos)\b|\bqual (?:modelo )?comprar\b|\bpara comprar em 20\d\d\b/i,
  /^como (?:usar|fazer|baixar|recuperar|ativar|desativar|espelhar|justificar|ver|mudar|trocar|configurar|limpar|apagar|excluir|instalar|atualizar|colocar|tirar|cancelar|consultar|emitir|transferir|conectar|resetar|formatar|desbloquear|bloquear|salvar|converter|gravar|editar|imprimir|assistir|ligar|desligar|saber se)\b/i,
  /\bhor[oó]scopo\b|\bloterias?\b|\bmega-?sena\b|\bresultado da quina\b/i,
  // Listas, comparativos e curiosidades atemporais.
  /^\d+\s(?:pol[eê]micas|curiosidades|coisas|fatos|dicas|motivos|raz[oõ]es|erros|truques|segredos|jogos|filmes|s[eé]ries|apps|aplicativos|diferen[cç]as|celulares|notebooks|fones)\b/i,
  /\bqual (?:[eé] )?(?:o |a )?melhor\b|:\s*qual escolher\b|^quanto custaria\b/i,
  /^edi[cç][aã]o (?:de|do dia)\b|^newsletter\b/i,
  // Guias de compra e testes de produto em inglês ("Best Party Speakers (2026)", "12 Best Gifts").
  /^(?:the\s+)?\d*\s*best\b.*\(20\d\d\)|^\d+\s+best\b|\bwe tested\b|\bgift guide\b|\bgifts? (?:for|ideas)\b/i,
  // Promoção de ingressos de eventos ("Last 24 hours to save up to $200 on TechCrunch Disrupt").
  /\bTechCrunch Disrupt\b|\bsave up to \$\d+|\bexpo\+? pass\b/i,
  // Agenda de esportes.
  /\bjogos de hoje\b|\bonde assistir\b|\bfutebol ao vivo\b|\bhor[aá]rios? d[aoe]s? (?:jogos|partidas)\b/i,
];

/** Conteúdo patrocinado, verificado no título e no resumo. */
export const sponsored = [
  /\b(?:this (?:post|article|content) (?:was|is) (?:created|produced|brought to you) in partnership with|sponsored (?:content|post|by)|paid post|partner content|conte[uú]do patrocinado|publieditorial|publipost)\b/i,
];

/**
 * Termos monitorados para o "Em alta". Além destes, o radar detecta sozinho nomes
 * próprios que aparecem em várias fontes ao mesmo tempo.
 */
export const watchlist = [
  // IA
  { label: 'OpenAI', match: /\bOpen\s?AI\b/i },
  { label: 'ChatGPT', match: /\bChat\s?GPT\b/i },
  { label: 'Claude', match: /\bClaude\b/ },
  { label: 'Anthropic', match: /\bAnthropic\b/ },
  { label: 'Meta AI', match: /\bMeta AI\b|\bLlama\b/ },
  { label: 'DeepSeek', match: /\bDeepSeek\b/i },
  { label: 'Grok', match: /\bGrok\b|\bxAI\b/ },
  { label: 'Perplexity', match: /\bPerplexity\b/ },
  { label: 'Copilot', match: /\bCopilot\b/ },
  { label: 'Midjourney', match: /\bMidjourney\b/i },
  { label: 'Sora', match: /\bSora\b/ },
  { label: 'Agentes de IA', match: /\bagentes? de IA\b|\bAI agents?\b|\bagentic\b|\bag[eê]ntic[ao]s?\b/i },
  { label: 'IA generativa', match: /\bIA generativa\b|\bgenerative AI\b|\bGenAI\b/i },
  { label: 'Nvidia', match: /\bNvidia\b/i },
  // Big techs e plataformas
  { label: 'Apple', match: /\bApple\b/ },
  { label: 'iPhone', match: /\biPhone\b/ },
  { label: 'Samsung', match: /\bSamsung\b|\bGalaxy\b/ },
  { label: 'Microsoft', match: /\bMicrosoft\b/ },
  { label: 'Meta', match: /\bMeta\b(?! AI)/ },
  { label: 'Amazon', match: /\bAmazon\b/ },
  { label: 'Elon Musk', match: /\bMusk\b/ },
  { label: 'Tesla', match: /\bTesla\b/ },
  { label: 'Netflix', match: /\bNetflix\b/ },
  { label: 'Spotify', match: /\bSpotify\b/ },
  // Redes sociais
  { label: 'Instagram', match: /\bInstagram\b/ },
  { label: 'TikTok', match: /\bTikTok\b/i },
  { label: 'YouTube', match: /\bYouTube\b/i },
  { label: 'WhatsApp', match: /\bWhatsApp\b/i },
  { label: 'LinkedIn', match: /\bLinkedIn\b/i },
  { label: 'Threads', match: /\bThreads\b/ },
  { label: 'X (Twitter)', match: /\bTwitter\b|\bX \(ex-Twitter\)|\bantigo Twitter\b/ },
  { label: 'Bluesky', match: /\bBluesky\b/i },
  { label: 'Pinterest', match: /\bPinterest\b/ },
  { label: 'Virais e memes', match: /\bmemes?\b|\bviraliz\w*|\b(?:goes|went) viral\b/i },
  { label: 'Datas comemorativas', match: /\bdatas? comemorativ\w*/i },
  { label: 'Creators e influência', match: /\binfluenciador(?:a|es|as)?\b|\binfluencers?\b|\bcreator economy\b|\beconomia dos criadores\b/i },
  // Marketing, mídia e publicidade
  { label: 'SEO', match: /\bSEO\b/ },
  { label: 'Busca com IA', match: /\bGEO\b|generative engine optimi[sz]ation|\bbusca com IA\b|\bAI search\b/i },
  { label: 'Retail media', match: /\bretail media\b/i },
  { label: 'TV conectada', match: /\bCTV\b|\bconnected TV\b|\bTV conectada\b/i },
  { label: 'Privacidade e dados', match: /\bLGPD\b|\bcookies?\b|\bfirst-party data\b|\bdados pr[oó]prios\b|\bprivacidade\b/i },
  { label: 'Branding', match: /\brebrand\w*|\bbranding\b|\bnova identidade visual\b|\bnovo logo\b|\bnew logo\b|\bidentidade de marca\b/i },
  { label: 'Cannes Lions', match: /\bCannes\b/ },
  { label: 'Black Friday', match: /\bBlack Friday\b/i },
  { label: 'Dia das Crianças', match: /\bDia das Crian[cç]as\b/i },
  { label: 'Natal', match: /\bNatal\b|\bholiday season\b/ },
  // Design
  { label: 'Figma', match: /\bFigma\b/i },
  { label: 'Adobe', match: /\bAdobe\b|\bPhotoshop\b|\bIllustrator\b|\bFirefly\b/ },
  { label: 'Canva', match: /\bCanva\b/ },
  { label: 'Tipografia', match: /\btipografia\b|\btypography\b|\btypefaces?\b/i },
  { label: 'Acessibilidade', match: /\bacessibilidade\b|\baccessibility\b/i },
  // E-commerce e negócios
  { label: 'Mercado Livre', match: /\bMercado Livre\b/i },
  { label: 'Shopee', match: /\bShopee\b/i },
  { label: 'Shein e Temu', match: /\bShein\b|\bTemu\b/i },
  { label: 'TikTok Shop', match: /\bTikTok Shop\b/i },
  { label: 'Pix', match: /\bPix\b/ },
  { label: 'Rodadas de investimento', match: /\brodada\b|\baporte\b|\bfunding round\b|\braises \$|\bSeries [A-E]\b|\bS[eé]rie [A-E]\b/i },
  { label: 'Aquisições', match: /\baquisi[cç][aã]o\b|\bacquires?\b|\bacquisition\b|\bcompra a\b/i },
  { label: 'Demissões', match: /\bdemiss\w+|\blayoffs?\b|\bcortes? de (?:vagas|empregos)\b/i },
];

/** Palavras que nunca viram "termo em alta" sozinhas (além das stopwords comuns). */
export const trendStoplist = [
  'IA', 'AI', 'Inteligência Artificial', 'Artificial Intelligence', 'Tecnologia', 'Marketing', 'Design',
  'Publicidade', 'Brasil', 'Brazil', 'Brasileiro', 'Brasileira', 'Brasileiros', 'EUA', 'US', 'USA', 'UK', 'CEO',
  'Review', 'Podcast', 'Newsletter', 'Episode', 'Webinar', 'Guide', 'Report', 'Oferta', 'Ofertas', 'Promoção',
  'Vídeo', 'Video', 'Veja', 'Confira', 'Saiba', 'Entenda', 'Exclusivo', 'Exclusive', 'Opinião', 'Análise',
  // Lugares aparecem demais e dizem pouco sobre o assunto.
  'Estados Unidos', 'China', 'Europa', 'Europe', 'Japão', 'Japan', 'Índia', 'India', 'México', 'Mexico', 'Argentina',
  'Colômbia', 'Chile', 'Portugal', 'Reino Unido', 'São Paulo', 'Rio', 'Rio de Janeiro', 'Nova York', 'New York',
  'Califórnia', 'California', 'Washington', 'Londres', 'London', 'América Latina', 'Latin America', 'LatAm',
];

export const limits = {
  /** Manchetes mais antigas que isso ficam de fora. */
  maxAgeDays: 10,
  /** Máximo de manchetes guardadas por editoria. */
  perColumn: 36,
  /** Máximo de manchetes de uma mesma fonte dentro de uma editoria. */
  perSourcePerColumn: 7,
  /** Quantidade de termos no "Em alta". */
  trends: 12,
  /** Abaixo disso a atualização é considerada falha e o site anterior é mantido. */
  minItems: 40,
};
