# Contrato de implementação white-label (Fase 0)

## Regras globais para TODOS os agentes

1. Trabalhe **somente** nos arquivos do seu dono (tabela abaixo). Não edite nada fora deles.
2. **Não** rode `npm install`, `npm ci`, `postinstall`, `npm run build`, `npm run seed`, `npm start`, migrações ou SQL.
3. **Não** edite `node_modules/`, `dist/`, `.evershop/`, `media/` ou `public/sitemap*.xml`.
4. **Não** faça `git commit`, `git push`, `git checkout`, `git clean`, `git reset`.
5. **Não** publique nem tocno no changeset 2 do page builder (`pb-draft-1`).
6. A saída renderizada da Loja Exemplo deve continuar **idêntica** à atual. Nenhuma mudança visual ou de texto nesta fase.
7. Use apenas dados reais já conhecidos. Se um dado não existe, deixe `null` e omita a seção — nunca invente.
8. Ao terminar, responda: arquivos criados/editados, o que mudou, e qualquer risco. Não reporte "pronto para publicar".

## Manifesto por empresa

Arquivo: `companies/<slug>.json`. Default: `companies/loja-exemplo.json`.
Template vazio: `companies/_template.json`. Validação: `companies/schema.json`.

Formato mínimo (jsonc para leitura; o arquivo real é JSON válido):

```jsonc
{
  "schema": 1,
  "slug": "loja-exemplo",
  "default": true,
  "domain": "https://lojaexemplo.com.br",
  "theme": "loja-exemplo",
  "extension": "loja-exemplo-home",
  "name": "Loja Exemplo",
  "shortName": "LOJA",
  "tagline": "Materiais de construção com preço justo em São Paulo",
  "description": "Na Loja Exemplo você encontra materiais de construção, hidráulica, elétrica, tintas, ferragens e ferramentas em São Paulo, SP.",
  "city": "São Paulo",
  "uf": "SP",
  "region": "São Paulo, SP",
  "phone": { "display": "(00) 0000-0000", "e164": "+5500000000000" },
  "whatsapp": {
    "display": "(00) 00000-0000",
    "number": "5500000000000",
    "defaultMessage": "Olá! Gostaria de consultar preço e disponibilidade."
  },
  "address": {
    "full": "Rua Exemplo, 100, Centro, São Paulo – SP, CEP 00000-000",
    "short": "Centro — São Paulo/SP",
    "streetAddress": "Rua Exemplo, 100",
    "locality": "São Paulo",
    "region": "SP",
    "postalCode": "00000-000",
    "country": "BR"
  },
  "hours": "Seg a Sáb, 8h às 18h · Dom, 9h às 12h",
  "mapsUrl": "https://www.google.com/maps/search/?api=1&query=Loja+Exemplo+Rua+Exemplo+100+Sao+Paulo+SP",
  "placeId": null,
  "facebook": "https://www.facebook.com/lojaexemplo",
  "publicEmail": null,
  "rating": { "value": "4,5", "reviews": 13, "sourceUrl": null },
  "nav": [
    { "label": "Início", "href": "/" },
    { "label": "Departamentos", "href": "/departamentos" },
    { "label": "Produtos", "href": "/products" },
    { "label": "Blog", "href": "/blog" },
    { "label": "Empresa", "href": "/empresa" },
    { "label": "Contato", "href": "/contato" }
  ],
  "cmsSlugs": ["empresa", "contato", "departamentos"],
  "departments": ["Hidráulica", "Elétrica", "Tintas e acabamento", "Ferragens", "Ferramentas", "Materiais de construção", "Coberturas", "Iluminação", "Orçamento e entrega"],
  "differentials": [],
  "hero": { "eyebrow": "São Paulo · São Paulo – SP", "titlePrefix": "Tudo para sua obra com ", "titleHighlight": "preço justo", "titleSuffix": " e atendimento de verdade.", "text": "", "primaryLabel": "Pedir orçamento pelo WhatsApp", "stats": [] },
  "cta": { "title": "Precisa de um orçamento?", "text": "", "label": "Falar com a Loja Exemplo" },
  "location": { "title": "Onde estamos", "text": "", "meta": [] },
  "brand": { "primary": "#116dff", "hover": "#0b52d6", "dark": "#0c1f4d", "soft": "#eef4ff", "shortName": "LOJA" },
  "priceMode": "quote",
  "seo": {
    "description": "Materiais de construção em São Paulo, SP. Valores sob consulta pelo WhatsApp.",
    "titleTemplates": { "category": "{{name}} em {{city}} | {{name}}", "product": "{{name}} | {{company}}", "cms": "{{title}} | {{company}}" },
    "robotsTxt": null
  },
  "catalog": { "skuPrefix": "HC", "collections": [], "categories": [], "products": [], "pages": [] }
}
```

## Artefatos gerados (criados pelo `scripts/render-company-config.mjs`)

- `themes/loja-exemplo/src/components/frontStore/generated/company.ts` — `export const COMPANY = {...}; export default COMPANY;` com os dados do manifesto ativo.
- `extensions/loja-exemplo-home/generated/widgets.json` — os 7 defaults (`hc_menu`, `hc_hero`, `hc_departments`, `hc_featured_products`, `hc_differentials`, `hc_cta`, `hc_location`) já preenchidos com os dados da empresa.
- `config/generated/company.json` — cópia do manifesto para consumidores de runtime/CI.

O script escolhe o manifesto por `process.env.COMPANY_SLUG || 'loja-exemplo'` e sempre gera os três arquivos de forma determinística.

## API que deve permanecer compatível

`themes/.../src/components/frontStore/site.ts` continua exportando:

- `SITE` (mesmo formato de hoje: `name`, `tagline`, `description`, `phone`, `phoneHref`, `whatsapp`, `whatsappHref`, `addressFull`, `addressShort`, `hours`, `facebook`, `mapsUrl`)
- `NAV`
- `quoteHref(productName?)`
- Nova função opcional: `waLink({ source, productName?, categoryName?, itemCount? })`

Os componentes atuais (`Header`, `Footer`, `ProductSingleForm`, `CartSummary`, widgets) continuam importando `SITE`/`NAV`/`quoteHref` sem mudança de assinatura.

## Donos de arquivo

| Agente (sessionID) | Tema | Arquivos que pode editar |
|---|---|---|
| `ses_df5c5dd52ffev3Dhe790NJ7G62` | mapeamento | `docs/MAPEAMENTO_DADOS.md` |
| `ses_df5c57d5cffeX65MHZ807mRoGO` | arquitetura | `docs/ARQUITETURA_MULTI_INSTALACAO.md` |
| `ses_df5c566e5ffeB0V5dhTxU30hbL` | config/manifesto | `companies/_template.json`, `companies/loja-exemplo.json`, `companies/schema.json`, `scripts/render-company-config.mjs`, `.env.example`, `package.json` (somente script `company:render` + prefixo no `build`) |
| `ses_df5c55386ffeYBYwg7cJwh086G` | schema DB | `docs/EVERSHOP_SINGLE_STORE.md` |
| `ses_df5c5403affe64yNCHWsxeggVX` | SEO/domínio | `scripts/render-company-sitemap.mjs`, `themes/loja-exemplo/src/components/frontStore/StructuredData.tsx`, `themes/loja-exemplo/src/pages/all/Base.tsx` |
| `ses_df5c52c0affe3onRfnlZGXF63h` | patches pt-BR | `scripts/patch-ptbr-core.mjs`, `scripts/patch-verify.mjs` |
| `ses_df5c5159bffeM4LEdxPbh45aOv` | page builder | `scripts/seed-homepage-widgets.mjs`, `extensions/loja-exemplo-home/src/bootstrap.js` |
| `ses_df5c501a2ffeWM9b4KbFtNR9AS` | seeds catálogo | `scripts/seed-company.mjs`, `schemas/catalog.schema.json` |
| `ses_df5c4ec68ffe77MfvyzeoMva8J` | WhatsApp | `themes/loja-exemplo/src/components/frontStore/site.ts` |
| `ses_df5c4d7b2ffeNEOy68vPGbhx0E` | tokens CSS | `themes/loja-exemplo/src/pages/all/theme.css`, `themes/loja-exemplo/public/company-overrides.css` |
| `ses_df5c4c6b0ffex9Xs1ebiZQ0Zde` | extensão config | `extensions/company-config/**`, `config/default.json`, `scripts/compile-extension.mjs` |
| `ses_df5c4ae8affeBeKm27vws5YOH5` | CLI provisão | `scripts/company-create.mjs` |
| `ses_df5c49ca1ffek1uh4y4adtiWZI` | checklist | `docs/CHECKLIST_PUBLICACAO.md` |
| `ses_df5c48b16ffe0G80czDmTI1Klv` | LGPD/dados | `docs/DADOS_E_LGPD.md` |
| `ses_df5c477ccffetKA5ZFfzeB22cN` | onboarding | `docs/ONBOARDING.md` |
| `ses_df5c4640effeRRaBpu67gq10Os` | roadmap | `docs/ROADMAP.md` |
| `ses_df5c450efffeC4pues2Q7BdP45` | CI | `.github/workflows/template-ci.yml` |
| `ses_df5c4303cffeDO4NHgCB9NF63S` | nomenclatura | `docs/NAMING_E_REPOS.md` |
| `ses_df5c41893ffejuV0LPNpZwVdmj` | segurança | `docs/SEGURANCA_ISOLAMENTO.md` |
| `ses_df5c3ff51ffeIQh9FwS22HEW6I` | auditoria vazamento | `scripts/check-company-leaks.mjs` |

Se precisar de um arquivo que não é seu, **não edite**: descreva a dependência na resposta.
