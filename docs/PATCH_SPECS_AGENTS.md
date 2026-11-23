# Especificações adicionais produzidas por agentes somente-leitura

Use este arquivo apenas para replicar, com agentes `general`, o conteúdo que as sessões `explore` não puderam gravar. Não é fonte de verdade de código; `AGENT_CONTRACT.md` continua valendo.

---

## A. `docs/MAPEAMENTO_DADOS.md`

```markdown
# MAPEAMENTO_DADOS.md — inventário de dados rígidos para white-label

- Versão: 1.0 (2026-11-23)
- Dono: sessão `ses_df5c5dd52ffev3Dhe790NJ7G62` (mapeamento)
- Base absoluta: `<repo>/evershop-seu-ecommerce-facil`
- Destino dos campos: `companies/<slug>.json` (default `companies/loja-exemplo.json`), conforme `docs/AGENT_CONTRACT.md`
- Regras observadas: somente leitura; nenhum dado inventado; ausência = `null`; saída renderizada atual permanece idêntica
- Convenção das colunas: `arquivo:linha` → `dado rígido encontrado` → `campo do manifesto / parametrização`

## Legenda de campos do manifesto referenciados

`slug`, `default`, `domain`, `theme`, `extension`, `name`, `shortName`, `tagline`, `description`, `city`, `uf`, `region`, `phone.display`, `phone.e164`, `whatsapp.display`, `whatsapp.number`, `whatsapp.defaultMessage`, `address.full`, `address.short`, `address.streetAddress`, `address.locality`, `address.region`, `address.postalCode`, `address.country`, `hours`, `mapsUrl`, `placeId`, `facebook`, `publicEmail`, `rating.value`, `rating.reviews`, `rating.sourceUrl`, `nav[]`, `cmsSlugs[]`, `departments[]`, `differentials[]`, `hero.*`, `cta.*`, `location.*`, `brand.primary`, `brand.hover`, `brand.dark`, `brand.soft`, `brand.shortName`, `priceMode`, `seo.description`, `seo.titleTemplates.*`, `seo.robotsTxt`, `catalog.skuPrefix`, `catalog.collections`, `catalog.categories`, `catalog.products`, `catalog.pages`.

## 1. Identidade

| arquivo:linha | dado rígido | campo do manifesto / parametrização |
|---|---|---|
| `...\README.md:1` | `# Loja Exemplo — MVP (EverShop)` | `name` |
| `...\README.md:3-4` | “Versão final do site da Loja Exemplo em EverShop 2.4.0, com tema próprio, catálogo ‘sob consulta’, conteúdo em pt-BR e WhatsApp como canal principal.” | `name`, `priceMode`, `theme`, `extension` |
| `...\README.md:45` | `Tema ativo: loja-exemplo.` | `theme` |
| `...\README.md:46-48` | Extensão `extensions/loja-exemplo-home`; widgets `hc_hero`, `hc_departments`, `hc_featured_products`, `hc_differentials`, `hc_cta`, `hc_location` | `extension`; tipos de widget permanecem fixos |
| `...\themes\loja-exemplo\src\components\frontStore\site.ts:11` | `name: 'Loja Exemplo'` | `name` |
| `...\site.ts:12` | `tagline: 'Materiais de construção com preço justo em Sua Cidade'` | `tagline` |
| `...\site.ts:13-15` | “Na Loja Exemplo você encontra materiais de construção, hidráulica, elétrica, tintas, ferragens e ferramentas em Sua Cidade, UF. Atendimento próximo e os menores preços.” | `description`, `city`, `uf`, `departments[]` |
| `...\src\components\frontStore\BrandLogo.tsx:13-14` | `LOJA` / `EXEMPLO` | `name`, `shortName`, `brand.shortName` |
| `...\src\pages\cmsPageView\CmsPageView.tsx:13` | Eyebrow `Loja Exemplo` | `name` |
| `...\src\pages\blogPostView\BlogPostHeader.tsx:45` | “Fale com a Loja Exemplo” | `name` |
| `...\src\pages\blogHome\BlogHomeHeader.tsx:15-16` | “escritas por quem atende todos os dias em Sua Cidade” | `city` |
| `...\src\pages\login\LoginPage.tsx:35-50` | “Sua conta, seus orçamentos.”, “preços sob consulta”, “Atendimento próximo em Sua Cidade”, “Retirada nas lojas 1 e 2” | `priceMode`, `city`, `address.full` |
| `...\extensions\loja-exemplo-home\widgets.json:4,22,49,65,81,119,134` | Nomes dos widgets com “Loja Exemplo” | `name`; `hero`, `cta`, `location` |
| `...\widgets.json:87` | `eyebrow: "Por que a Exemplo"` | `shortName` / `brand.shortName` |
| `...\config\default.json:50` | Logo `alt: "Loja Exemplo"` | `name` |
| `...\config\default.json:64` | `© 2026 Loja Exemplo. Todos os direitos reservados.` | `name` + ano corrente |
| `...\themes\loja-exemplo\seed\pages.json:6-8,22,30` | Página `empresa`: título/descrição/keywords e texto “A Loja Exemplo é uma loja ...” | `name`, `city`, `departments[]`, `seo.titleTemplates.cms` |
| `...\seed\blog.json:75,126,177,228,278,328` | 6 `meta_title` terminando em `| Loja Exemplo` | `seo.titleTemplates.cms` + `name` |
| `...\seed\products.json:12-14,71-73,130-132,189-191,248-250,307-309,366-368` | `meta_title`/`meta_keywords` com “Loja Exemplo” | `seo.titleTemplates.product` + `name` |
| `...\seed\collections.json:18` | “Linhas de produtos em destaque na Loja Exemplo.” | `name`, `catalog.collections` |
| `...\scripts\seed-metadata-cms.mjs:38` | `storeName = 'Loja Exemplo'` | `name` |
| `...\scripts\install-headless.mjs:30` | Fallback `ADMIN_FULLNAME || 'Loja Exemplo'` | `name` / `ADMIN_FULLNAME` |
| `...\.env.example:11` | `ADMIN_FULLNAME="Loja Exemplo"` | `name` (admin) |
| `...\package.json:2` | `"name": "evershop-seu-ecommerce-facil"` | `slug` |

## 2. Contato

| arquivo:linha | dado rígido | campo do manifesto / parametrização |
|---|---|---|
| `...\README.md:55` | WhatsApp `(00) 00000-0000` — `https://wa.me/5500000000000` | `whatsapp.display`, `whatsapp.number` |
| `...\README.md:56` | Telefone `(00) 0000-0000` | `phone.display` |
| `...\README.md:59` | “Não existe e-mail público; não inventar um.” | `publicEmail: null` |
| `...\README.md:65` | Exemplo `https://lojaexemplo.com.br` | `domain` |
| `...\site.ts:1` | `WHATSAPP_NUMBER = '5500000000000'` | `whatsapp.number` |
| `...\site.ts:3-8` | `quoteHref()` → `https://wa.me/<número>?text=Olá! Gostaria de consultar preço e disponibilidade ...` | `whatsapp.number`, `whatsapp.defaultMessage` |
| `...\site.ts:16-17` | `(00) 0000-0000` / `tel:+5500000000000` | `phone.display`, `phone.e164` |
| `...\site.ts:18-19` | `(00) 00000-0000` / link `wa.me` com texto codificado | `whatsapp.display`, `whatsapp.number`, `whatsapp.defaultMessage` |
| `...\site.ts:24-25` | Facebook `facebook.com/p/Loja-Exemplo-000000000000000/` | `facebook` |
| `...\widgets.json:35-36` | CTA do hero “Pedir orçamento pelo WhatsApp” + `wa.me` | `hero.primaryLabel`, `whatsapp.number` |
| `...\widgets.json:128-129` | “Falar com a Loja Exemplo” + `wa.me` | `cta.label`, `whatsapp.number` |
| `...\widgets.json:145,150-151` | `(00) 0000-0000`, `WhatsApp (00) 00000-0000`, link `wa.me` | `phone.display`, `whatsapp.display`, `whatsapp.number` |
| `...\Footer.tsx:24-27,47-48,52,62-64` | Botão “Falar no WhatsApp”, WhatsApp, telefone, Google Maps, Facebook | `whatsapp.*`, `phone.*`, `mapsUrl`, `facebook` |
| `...\Header.tsx:46-49,74-78` | “Solicitar orçamento”, “Falar no WhatsApp” no menu mobile | `cta.label`, `whatsapp.*` |
| `...\src\components\frontStore\catalog\ProductSingleForm.tsx:78-88` | `quoteHref(name)`, “Solicitar preço no WhatsApp”, telefone/endereço curto | `whatsapp.defaultMessage`, `phone.display`, `address.short` |
| `...\catalog\ProductListItemRender.tsx:89` | “Consultar no WhatsApp” | `whatsapp.*` |
| `...\src\components\frontStore\catalog\CategoryInfo.tsx:39` | “Consultar produtos deste departamento” | `whatsapp.*`, `departments[]` |
| `...\src\components\frontStore\catalog\ProductListingInfo.tsx:27` | “Pedir orçamento” | `cta.label` |
| `...\src\components\frontStore\cart\CartSummary.tsx:17-35` | “Valores sob consulta, envie sua lista pelo WhatsApp” / `Sob consulta` | `priceMode`, `whatsapp.*` |
| `...\src\components\frontStore\cart\ShoppingCartEmpty.tsx:9-26` | “Monte sua lista de materiais e envie pelo WhatsApp” | `priceMode`, `whatsapp.*` |
| `...\src\components\frontStore\cart\CartTitle.tsx:22-23,35` | “Os valores são sob consulta — envie sua lista ... pelo WhatsApp” | `priceMode` |
| `...\src\pages\login\LoginPage.tsx:53-66` | CTA WhatsApp + telefone e horário | `whatsapp.*`, `phone.*`, `hours` |
| `...\seed\pages.json:89-91,122-125,133` | Meta e lista de contato com WhatsApp/telefone/endereço/horário e Facebook | `phone.*`, `whatsapp.*`, `address.full`, `hours`, `facebook` |
| `...\.env.example:12` | `ADMIN_EMAIL="admin@lojaexemplo.com.br"` | e-mail **administrativo**; `publicEmail` permanece `null` |
| `...\scripts\install-headless.mjs:31` | Fallback `admin@lojaexemplo.com.br` | e-mail **administrativo**; não mapear para `publicEmail` |

## 3. Endereço / NAP (nome, endereço, telefone, horário, localização, avaliação)

| arquivo:linha | dado rígido | campo do manifesto / parametrização |
|---|---|---|
| `...\site.ts:20-21` | `Rua Exemplo, 123 — Centro, Sua Cidade – UF, CEP 00000-000` | `address.full`, `address.streetAddress`, `address.postalCode` |
| `...\site.ts:22` | `Centro — Sua Cidade/UF` | `address.short`, `address.locality`, `address.region`, `address.country` |
| `...\site.ts:23` | `Seg a Sáb, 8h às 18h · Dom, 9h às 12h` | `hours` |
| `...\site.ts:26-27` | `mapsUrl`: Google Maps **search** por nome + endereço | `mapsUrl`; `placeId: null` |
| `...\widgets.json:30` | `Sua Cidade · Sua Cidade – UF` | `hero.eyebrow`, `city`, `uf`, `region` |
| `...\widgets.json:34,112,127` | Textos com “lojas 1 e 2, no mesmo endereço em Sua Cidade” / “região de Sua Cidade” | `hero.text`, `differentials[]`, `cta.text`, `region` |
| `...\widgets.json:40` | `4,5★` / `avaliação no Google` | `rating.value` |
| `...\widgets.json:142-146` | Endereço completo; horário; `(00) 0000-0000`; `4,5 no Google · 13 avaliações` | `address.full`, `hours`, `phone.display`, `rating.value`, `rating.reviews` |
| `...\widgets.json:148-154` | `Abrir no Google Maps`, maps search, `cardTitle`, `Lojas 1 e 2 · Rua Exemplo, 123...`, `Centro — Sua Cidade/UF` | `mapsUrl`, `name`, `address.short`, `location.*` |
| `...\Footer.tsx:20-22,71,74` | Descrição e endereço/horário no rodapé | `address.full`, `hours`, `departments[]` |
| `...\Footer.tsx:76-79` | **Texto fixo no JSX**: `4,5 no Google · 13 avaliações` | `rating.value`, `rating.reviews` |
| `...\Header.tsx:23,27,31,78` | Endereço curto, horário e telefone no topo/menu mobile | `address.short`, `hours`, `phone.display` |
| `...\README.md:57-58` | Endereço completo em documentação | `address.full` |
| `...\seed\pages.json:30,72,124-125,140` | Endereço, horários, “Avaliação 4,5 no Google, com 13 avaliações” | `address.full`, `hours`, `rating.value`, `rating.reviews` |
| `...\seed\categories.json:23-25,86-88,142-144,198-200,254-256,310-312,366-368,422-424,478-480` | SEO “<departamento> em Sua Cidade | Loja Exemplo” + keywords locais | `city`, `uf`, `name`, `seo.titleTemplates.category` |
| `...\scripts\seed-metadata-cms.mjs:39` | StoreDescription com Sua Cidade/DF e lojas 1 e 2 | `seo.description`, `city`, `uf` |
| `...\scripts\patch-ptbr-core.mjs:24,56` | Metas com “em Sua Cidade” | `city` |

## 4. CSS / assets

| arquivo:linha | dado rígido | campo do manifesto / parametrização |
|---|---|---|
| `...\themes\loja-exemplo\src\pages\all\theme.css:2-12` | `--color-brand-50..950`: `#eef4ff`, `#dbe7ff`, `#bfd3ff`, `#93b5ff`, `#5f8dff`, `#3a6bff`, `#116dff`, `#0b52d6`, `#0f42a8`, `#123a84`, `#0c1f4d` | `brand.soft`, `brand.primary`, `brand.hover`, `brand.dark` + escala derivada |
| `...\theme.css:14-15` | Sombras com `rgb(17 109 255 / 0.18)` | derivar de `brand.primary` |
| `...\theme.css:18-42` | `--primary #116dff`, `--accent #eef4ff`, `--accent-foreground #0b52d6`, `--ring #3a6bff`, `--chart-1..3` | `brand.*` |
| `...\theme.css:111-138,196-198,217,220-221,292-293` | Botões, selo, ícones e logo claro em azuis fixos | `brand.*` |
| `...\theme.css:235-236,256-257,369,386-387,402,433-434` | Topo do header escuro e hero com `#070f24`, `#0c1f4d`, `#bfd3ff`, `#93b5ff`, `rgb(17 109 255 / .28)` | `brand.dark`, `brand.primary` + derivados |
| `...\theme.css:503-504,563-564,598-599,609-616` | Gradientes `#0c1f4d → #116dff`, `#123a84` em departamentos/CTA | `brand.dark`, `brand.primary` |
| `...\theme.css:645,655-669,678-680,721,739,752` | Localização e footer com azuis antigos | `brand.*` |
| `...\theme.css:834-852,949-956,1052-1057,1099-1140,1151-1156,1185,1256-1259,1271-1272,1296,1311,1335` | Page hero, preço “Sob consulta”, quote card, blog, login com mesmos tokens | `brand.*`, `priceMode` |
| `...\config\default.json:57,61` | Favicon `/favicon.svg`; `theme-color #0c1f4d` | `brand.dark`, caminho do favicon |
| `...\themes\loja-exemplo\public\logo.svg:1-6` | `aria-label="Loja Exemplo"`, `#116dff`, textos `LOJA`/`EXEMPLO` | `name`, `shortName`, `brand.primary`; gerador de logo |
| `...\public\favicon.svg:2-4` | Gota azul `#116dff` | `brand.primary`; gerador de favicon |
| `...\scripts\generate-theme-images.mjs:4-6` | Pasta `themes/loja-exemplo/public/images` | `theme` |
| `...\generate-theme-images.mjs:9-20` | 10 ícones SVG embutidos | biblioteca de ícones por departamento |
| `...\generate-theme-images.mjs:22-33` | Paletas `hidraulica`, `eletrica`, `tintas`, `ferragens`, `ferramentas`, `materiais`, `coberturas`, `iluminacao`, `orcamento`, `obras` | `departments[]`, `brand.*` |
| `...\generate-theme-images.mjs:35-58` | 22 SVGs `categoria-*`, `produto-*`, `blog-*` | `departments[]`, `catalog.categories`, `catalog.products` |
| `...\generate-theme-images.mjs:63-82` | Template SVG com `aria-label="${label}"` e gradientes | `departments[]`, `brand.*` |
| `...\generate-theme-images.mjs:80` | `<text ...>EXEMPLO</text>` | `brand.shortName` |
| `...\themes\loja-exemplo\public\images\*.svg:18` (22 arquivos) | `EXEMPLO` em todas as imagens | `brand.shortName` via gerador |
| `...\media\catalog\*\*.svg:18` (25) e `...\media\blog\*\*\*.svg:18` (6) | Cópia das imagens com `EXEMPLO` | regenerar via seed/gerador; não editar manualmente |
| `...\seed\categories.json:21,84,140,196,252,308,364,420,476` | `images/categoria-*.svg` | nomes de arquivo podem permanecer; conteúdo muda |
| `...\seed\products.json:56,115,174,233,292,351,410` | `images/produto-*.svg` | idem |
| `...\seed\blog.json:74,125,176,227,277,327` | `images/blog-*.svg` | idem |
| `...\scripts\patch-row-templates.mjs:317` | CSS admin com `#116dff`, `#eef4ff`, `#0b52d6` | `brand.primary`, `brand.soft`, `brand.hover` |

## 5. Seeds / SEO

| arquivo:linha | dado rígido | campo do manifesto / parametrização |
|---|---|---|
| `...\seed\pages.json:4-8` | Página `empresa` com meta_title/description/keywords | `cmsSlugs[]`, `seo.titleTemplates.cms`, `name`, `city` |
| `...\seed\pages.json:22,30,37,45,54-56,64,72` | Conteúdo “Sobre a Loja Exemplo”, diferenciais e endereço/horário | `name`, `differentials[]`, `address.full`, `hours` |
| `...\seed\pages.json:87-91,105,113,122-125,133,140` | Página `contato` com WhatsApp/telefone/Facebook/avaliação | `phone.*`, `whatsapp.*`, `facebook`, `rating.*` |
| `...\seed\pages.json:155-159,173,181,190-198,206` | Página `departamentos` e lista dos 9 departamentos | `cmsSlugs[]`, `departments[]`, `city` |
| `...\seed\categories.json:3-15` | Categorias padrão desativadas `Women`, `Men`, `Kids` | genérico; manter fora do manifesto |
| `...\seed\categories.json:18-25,81-88,137-144,193-200,249-256,305-312,361-368,417-424,473-480` | 9 departamentos ativos com SEO local | `departments[]`, `city`, `uf`, `seo.titleTemplates.category`, `catalog.categories` |
| `...\categories.json:67,477,511,513` | CTAs “pelo WhatsApp” e entrega na região | `whatsapp.*`, `region` |
| `...\seed\products.json:6-14,65-73,124-132,183-191,242-250,301-309,360-368` | 7 SKUs `LE-*`, metas com nome da empresa, “Preço sob consulta pelo WhatsApp” | `catalog.skuPrefix`, `catalog.products`, `seo.titleTemplates.product`, `priceMode` |
| `...\products.json:35,94,153,212,271,330,382,389` | Descrições “sob consulta”, retirada nas lojas 1 e 2, entrega em Sua Cidade | `priceMode`, `address.full`, `region` |
| `...\seed\blog.json:75,126,177,228,278,328` | 6 metas com nome da empresa | `seo.titleTemplates.cms`, `name` |
| `...\seed\collections.json:18` | Coleção com nome da empresa | `catalog.collections`, `name` |
| `...\scripts\seed-metadata-cms.mjs:38-40` | `storeName`, `storeDescription`, `/favicon.svg` | `name`, `seo.description`, `city`, `uf` |
| `...\scripts\seed-metadata-cms.mjs:44-55` | `url_rewrite` para `empresa`, `contato`, `departamentos` | `cmsSlugs[]` |
| `...\config\default.json:7` | `homeUrl: http://localhost:3001` | `domain` |
| `...\config\custom-environment-variables.json:3` | `homeUrl ← HOME_URL` | `domain` via env |
| `...\.env.example:16`, `...\ .env:8` | `EVERSHOP_HOME_URL` / `HOME_URL` locais | `domain` |
| `...\README.md:65` | Domínio de exemplo `lojaexemplo.com.br` | `domain` |
| `...\site.ts:32-38` | `NAV` com rotas `/departamentos`, `/empresa`, `/contato` | `nav[]`, `cmsSlugs[]` |
| `...\widgets.json:10-17` | Menu com 6 links (Contato com `showInDesktop: false`) | `nav[]` |

## 6. Scripts / patches

| arquivo:linha | dado rígido | campo do manifesto / parametrização |
|---|---|---|
| `...\scripts\patch-ptbr-core.mjs:24` | Descrição do blog com “em Sua Cidade” | `city` |
| `...\patch-ptbr-core.mjs:56` | Descrição do catálogo com “em Sua Cidade. Valores sob consulta.” | `city`, `priceMode` |
| `...\patch-ptbr-core.mjs:61` | “orçamento pelo WhatsApp na Loja Exemplo” | `whatsapp.*`, `name` |
| `...\patch-row-templates.mjs:317` | Cores do page builder | `brand.*` |
| `...\scripts\generate-theme-images.mjs:5,80` | Pasta do tema e texto `EXEMPLO` | `theme`, `brand.shortName` |
| `...\scripts\seed-metadata-cms.mjs:38-40` | Metadata global da loja | `name`, `seo.description` |
| `...\scripts\seed-homepage-widgets.mjs:14` | `THEME = 'loja-exemplo'` | `theme` |
| `...\seed-homepage-widgets.mjs:19-22,24-51` | UUIDs fixos de instâncias/placements | identificadores estáveis; não são dados da empresa |
| `...\seed-homepage-widgets.mjs:54-64` | Leitura de `extensions/loja-exemplo-home/widgets.json` | `extension`; destino é `generated/widgets.json` |
| `...\scripts\normalize-seed-blocks.mjs:5-6` | `themes/loja-exemplo/seed` | `theme` |
| `...\scripts\compile-theme.mjs:17-18` | `theme = 'loja-exemplo'` | `theme` |
| `...\scripts\compile-extension.mjs:12-13,26` | Pastas `extensions/loja-exemplo-home/src` e `/dist` | `extension` |
| `...\scripts\install-headless.mjs:30-32` | Fallback de admin com nome/e-mail antigos | `name`, `ADMIN_FULLNAME`, `ADMIN_EMAIL` |
| `...\package.json:7` | `postinstall` com 7 patches | dono de patches; sem dado de empresa |
| `...\package.json:15-16` | `seed` → `evershop seed` + `seed-metadata-cms.mjs`; `seed:meta` | dono de seeds/config |
| `...\scripts\patch-image-root-assets.mjs:2-5,22,57` | Ajuste genérico `/favicon.svg`/Windows | sem dado de empresa; revisar se caminho do favicon mudar |

## 7. Traduções

| arquivo:linha | dado rígido | campo do manifesto / parametrização |
|---|---|---|
| `...\translations\pt\zz-loja-exemplo.csv:1-21` | 21 traduções genéricas (“Home→Início”, “Shopping cart→Seu carrinho”, “Media library→Biblioteca de mídia” etc.) — nenhum dado da empresa | renomear para `zz-<slug>.csv`; conteúdo reutilizável |
| `...\translations\pt\admin.csv:222,299,308,314`; `...\contact.csv:50`; `...\import.csv:271,287-289`; `...\store.csv:1237`; `...\webhook.csv:45` | Apenas domínios/ e-mails de exemplo (`yourdomain.com`, `example.com`, `voce@exemplo.com`) | genérico; nenhum campo do manifesto |
| `...\translations\pt\*.csv` (13 arquivos no total) | Busca por `Loja`, `Exemplo`, `Sua Cidade`, telefones e e-mail de domínio: **zero ocorrências** | nenhuma parametrização de empresa necessária |

## 8. Artefatos gerados (não editar; regenerar)

| arquivo:linha | dado rígido | campo do manifesto / parametrização |
|---|---|---|
| `...\themes\loja-exemplo\dist\components\frontStore\site.js:1,10-21` | Cópia compilada com nome, telefones, endereço, Facebook e Maps antigos | regenerar por `npm run build` a partir de `site.ts` |
| `...\dist\components\frontStore\site.d.ts:1` | `WHATSAPP_NUMBER = "5500000000000"` | regenerar |
| `...\dist\components\frontStore\Footer.js:46` | Copyright antigo | regenerar |
| `...\dist\pages\cmsPageView\CmsPageView.js:11`; `...\dist\pages\blogPostView\BlogPostHeader.js:27`; `...\dist\pages\all\TailwindCss.js:2` | Nome antigo no bundle | regenerar |
| `...\.evershop\build\frontStore\server\index.js:51176-51190,51255` | Bundle de produção com dados antigos | regenerar via `npm run build` |
| `...\public\sitemap.xml:4,8,12,16,19,23,27` | `http://localhost:3001/sitemap-*.xml` | `domain`; regenerar via gerador de sitemap |
| `...\public\sitemap-static.xml:4,9`; `...\public\sitemap-cms-pages.xml:4,10,16`; `...\public\sitemap-products.xml:4,10,16,...`; `sitemap-categories.xml`, `sitemap-blog-*.xml` | Mesmo padrão `localhost` nos 8 arquivos | `domain`, `cmsSlugs[]` |
| `...\.evershop\sitemap\meta.json:2-14` | Fingerprint, contagens (6 posts, 9 categorias, 3 páginas, 7 produtos), `urlCount: 37` | artefato; apagar/regenerar |
| `...\themes\loja-exemplo\src\components\frontStore\generated\company.ts` (previsto no contrato, ainda não existe) | `COMPANY` gerado | artefato de `scripts/render-company-config.mjs` — dono: config/manifesto |
| `...\extensions\loja-exemplo-home\generated\widgets.json` (previsto, ainda não existe) | 7 defaults preenchidos | artefato do mesmo gerador |
| `...\config\generated\company.json` (previsto, ainda não existe) | cópia do manifesto | artefato do mesmo gerador |

## 9. Dados NÃO encontrados (deixar `null` / omitir)

| dado | evidência | campo do manifesto |
|---|---|---|
| Coordenadas geográficas (latitude/longitude) | Nenhuma ocorrência no working tree; `git grep` nos commits `13ac066`, `da2f4e4`, `eb7551f`, `14794e1`, `f512abc` não retornou `latitude`, `longitude`, `-15.*`, `47.*` | não existe campo; não criar |
| Google Place ID | Nenhuma ocorrência de `ChIJ`, `place_id`, `placeId`. O Maps é apenas `search/?api=1&query=...` (`site.ts:26-27`, `widgets.json:149`) | `placeId: null` |
| Link de origem das avaliações | Apenas as strings `4,5` / `13 avaliações` em `widgets.json:40,146`, `Footer.tsx:78`, `pages.json:140` | `rating.sourceUrl: null` |
| CNPJ / razão social | Nenhuma ocorrência de `CNPJ` ou “razão social”; existe apenas o nome fantasia | não existe campo; não criar |
| E-mail público | Ausente em todo o repo; `README.md:59` diz explicitamente “Não existe e-mail público; não inventar um.” Único e-mail é administrativo (`.env.example:12`, `install-headless.mjs:31`) | `publicEmail: null` |
| Domínio real de produção | Somente `localhost:3001` e o exemplo `https://lojaexemplo.com.br` em `README.md:65` | `domain` a definir no deploy |

## 10. Dependências de outros donos (somente descritas; não editadas)

- `themes/.../src/components/frontStore/site.ts`, `quoteHref`, `waLink` — dono WhatsApp.
- `themes/.../src/pages/all/theme.css`, `public/company-overrides.css` — dono tokens CSS.
- `companies/_template.json`, `companies/loja-exemplo.json`, `companies/schema.json`, `scripts/render-company-config.mjs`, `.env.example`, `package.json` — dono config/manifesto.
- `scripts/patch-ptbr-core.mjs`, `scripts/patch-verify.mjs` — dono patches pt-BR.
- `scripts/seed-homepage-widgets.mjs`, `extensions/loja-exemplo-home/src/bootstrap.js` — dono page builder.
- `scripts/seed-company.mjs`, `schemas/catalog.schema.json` — dono seeds catálogo.
- `scripts/render-company-sitemap.mjs`, `StructuredData.tsx`, `Base.tsx` — dono SEO/domínio.
- `config/default.json`, `scripts/compile-extension.mjs`, `extensions/company-config/**` — dono extensão config.
- `scripts/check-company-leaks.mjs` — dono auditoria.

Este documento é apenas o inventário. Nenhuma linha de código, seed, config, patch ou artefato foi alterado.
```

---

## B. Extensão `company-config`

### `extensions/company-config/src/company-config.js`

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from 'config';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
// Vale para src/ e dist/: os dois ficam um nível abaixo da raiz da extensão.
const projectRoot = path.resolve(moduleDir, '..', '..', '..');
const generatedFile = path.join(projectRoot, 'config', 'generated', 'company.json');

function fromConfig(key, fallback = null) {
  try {
    return config.has(key) ? config.get(key) : fallback;
  } catch {
    return fallback;
  }
}

/** Manifesto gerado, ou null se ausente/inválido. */
export function readGeneratedCompany() {
  try {
    const parsed = JSON.parse(fs.readFileSync(generatedFile, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Artefato ainda não gerado; o chamador usa o fallback.
  }
  return null;
}

/** Dados efetivos: manifesto gerado sobreposto a valores reais já existentes na config. */
export function getCompanyData() {
  const generated = readGeneratedCompany();
  const logo = fromConfig('themeConfig.logo');
  const fallback = {
    domain: fromConfig('shop.homeUrl'),
    theme: fromConfig('system.theme'),
    name: logo && typeof logo === 'object' ? logo.alt ?? null : null,
    copyRight: fromConfig('themeConfig.copyRight')
  };
  return generated ? { ...fallback, ...generated } : fallback;
}
```

### `extensions/company-config/src/bootstrap.js`

```js
import config from 'config';
import { addProcessor } from '@evershop/evershop/lib/util/registry';
import { merge } from '@evershop/evershop/lib/util/merge';
import { getCompanyData, readGeneratedCompany } from './company-config.js';

export default function bootstrap() {
  addProcessor('configurationSchema', (schema) => {
    merge(schema, {
      properties: {
        company: {
          type: 'object',
          properties: {
            slug: { type: 'string' },
            name: { type: 'string' },
            theme: { type: 'string' },
            domain: { type: 'string' }
          }
        }
      }
    });
    return schema;
  }, 20);

  // Tema: useAppState().config.company (mesmo seam de base/bootstrap.js:26).
  addProcessor('appConfig', (appConfig) => ({
    ...appConfig,
    company: getCompanyData()
  }), 20);

  const generated = readGeneratedCompany();
  if (generated) {
    const defaults = {};
    for (const key of ['slug', 'name', 'theme', 'domain']) {
      if (typeof generated[key] === 'string' && generated[key] !== '') {
        defaults[key] = generated[key];
      }
    }
    if (Object.keys(defaults).length > 0) {
      config.util.setModuleDefaults('company', defaults);
    }
  }
}
```

### `extensions/company-config/src/graphql/types/CompanyConfig/CompanyConfig.graphql`

```graphql
type CompanyConfig {
  schema: Int
  slug: String
  default: Boolean
  domain: String
  theme: String
  extension: String
  name: String
  shortName: String
  tagline: String
  description: String
  city: String
  uf: String
  region: String
  phone: JSON
  whatsapp: JSON
  address: JSON
  hours: String
  mapsUrl: String
  placeId: String
  facebook: String
  publicEmail: String
  rating: JSON
  nav: JSON
  cmsSlugs: [String]
  departments: [String]
  differentials: JSON
  hero: JSON
  cta: JSON
  location: JSON
  brand: JSON
  priceMode: String
  seo: JSON
  catalog: JSON
  copyRight: String
  logo: JSON
}

extend type Query {
  companyConfig: CompanyConfig
}
```

### `extensions/company-config/src/graphql/types/CompanyConfig/CompanyConfig.resolvers.js`

```js
import { getCompanyData } from '../../../company-config.js';

export default {
  Query: {
    companyConfig: () => getCompanyData()
  }
};
```

`widgets.json`: inexistente, conforme permitido.

### `config/default.json` — acréscimo em `system.extensions`

Logo antes do objeto `loja-exemplo-home` (linha 22), mantendo todo o branding atual:

```json
      {
        "name": "company-config",
        "resolve": "extensions/company-config",
        "enabled": true,
        "priority": 5
      },
```

### `scripts/compile-extension.mjs` — substituir conteúdo

```js
/**
 * Sincroniza `src/` -> `dist/` de todas as extensões locais.
 * O loader do EverShop 2.4 exige `dist` fora de development e lê
 * SDL/resolvers de `<dist>/graphql/types/**`.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionsDir = path.join(root, 'extensions');
const COPY_EXTENSIONS = new Set(['.js', '.json', '.graphql']);

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const source = path.join(from, entry);
    const target = path.join(to, entry);
    if (statSync(source).isDirectory()) {
      copyDir(source, target);
    } else if (COPY_EXTENSIONS.has(path.extname(entry).toLowerCase())) {
      copyFileSync(source, target);
    }
  }
}

const names = [];
for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const src = path.join(extensionsDir, entry.name, 'src');
  if (!existsSync(src)) continue;
  copyDir(src, path.join(extensionsDir, entry.name, 'dist'));
  names.push(entry.name);
}

console.log(`[compile-extension] Sincronizado: ${names.join(', ') || 'nenhuma extensão'}.`);
```
