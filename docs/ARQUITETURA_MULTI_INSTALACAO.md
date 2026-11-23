# Arquitetura multi-instalação — decisão aprovada (Fase 0)

## Status

Decisão aprovada para a Fase 0: **múltiplas instalações EverShop + template compartilhado**.

Este documento apenas registra a decisão. Não altera código, tema, visual, textos, dados ou saída renderizada da Loja Exemplo. O rascunho do page builder `pb-draft-1` permanece intocável e fora do Git, conforme `docs/AGENT_CONTRACT.md` e `README.md:71-72`.

## Decisão

Adota-se o **modelo B como base, operando como C híbrido**:

- **Uma instalação do EverShop 2.4.0 por empresa**, com processo próprio e banco PostgreSQL próprio.
- **Um template compartilhado**, versionado em Git, contendo tema, extensão, patches, manifests públicos e scripts de geração/provisionamento.
- **Automação centralizada gradual**: primeiro manifests e scripts determinísticos; depois CI/CD por loja. Não é necessário construir uma plataforma multi-tenant agora.

O **modelo A (multi-tenant em uma única instalação) foi descartado nesta fase**.

---

## Comparação A / B / C

| Critério | A — 1 instalação multi-tenant | B — N instalações, template compartilhado | C — Híbrido: B + automação |
|---|---|---|---|
| Custo de infra | Menor custo bruto: 1 processo + 1 DB. Exige escalar verticalmente e criar isolamento custom. | Maior: 1 processo + 1 DB por empresa. Cada instância precisa de recursos próprios. | Custo próximo de B, com menos retrabalho humano conforme a automação amadurece. |
| Isolamento de dados | Fraco sem customização: `setting`, `metafield_shop`, `url_rewrite` e `widget_placement` são globais. | Forte: DB, admin, pedidos, widgets, rascunhos e mídia separados por empresa. | Forte, com backup, migration e deploy padronizados por empresa. |
| Domínio e SEO | Arriscado: `homeUrl` é único por instalação; canonical, sitemap e `robots.txt` colidem entre domínios. | Natural: cada loja tem `HOME_URL`, domínio, `public/`, sitemap e robots próprios. | Ideal: mesmos benefícios de B + validação automática de domínio/canonical/sitemap/robots no deploy. |
| Page builder | Widgets e posições podem misturar empresas; `widget_placement` não tem coluna de loja/site. | Cada DB mantém seus próprios widgets e conteúdos editados. | Biblioteca de blocos/tokens versionada; conteúdo editado permanece específico da instalação. |
| Upgrades do core | Uma só atualização de core, mas fork multi-tenant colidiria com os patches e com futuras versões. | Mais deploys, porém todos usam a mesma versão do pacote comum e os mesmos patches centralizados. | Melhor equilíbrio: atualizar o template uma vez e propagar por loja, com backup e smoke test por instância. |
| Risco operacional | Alto: vazamento entre empresas, colisão de slug, canonical errado e admin compartilhado. | Médio: risco de drift entre instalações e de esquecer uma loja em um deploy. | Médio no início, menor depois; more peças de automação, porém menos erro manual. |
| Esforço inicial | Alto: é preciso implementar tenancy onde o core 2.4 não a possui. | Médio: extrair a marca do código atual para manifestos e consolidar tema/extensão. | Médio-alto: B + scripts/CI. Recomenda-se começar por B e automatizar o que causar mais atrito. |

---

## Por que multi-tenant foi descartado no EverShop 2.4

A base local usa `@evershop/evershop@2.4.0` (`package.json:25`) com sete patches aplicados no `postinstall` (`package.json:7`; `README.md:28-30`). Qualquer camada de tenancy custom aumentaria o conflito com esse conjunto de patches e com upgrades futuros.

Evidências verificadas no core, somente para leitura:

- Busca por `store_id`, `tenant_id`, `website_id` ou `multi_store` em `node_modules/@evershop/evershop/src/**/*.ts`: **nenhum resultado**.
- `metafield_shop` é singleton: `node_modules/@evershop/evershop/src/modules/base/migration/Version-1.0.3.ts:51-60` cria a tabela e insere `id = true`; `services/shopMetafield.ts:26` lê `WHERE id = true`.
- A checagem de slug em `node_modules/@evershop/evershop/src/modules/base/services/assertUrlKeyAvailable.ts:49` consulta `url_rewrite` sem dimensão de loja/tenant.
- `widget_placement` tem índice único por `(widget_instance_id, route, area, COALESCE(entity_urn, ''))` em `node_modules/@evershop/evershop/src/modules/cms/migration/Version-1.3.0.ts:80-81`, sem `store_id`/`site_id`.
- O sitemap local grava arquivos `sitemap.xml`, `sitemap-products.xml` etc. de forma plana em `public/` (`node_modules/@evershop/evershop/src/modules/base/services/sitemap/storage.ts:33-34,59`). Uma instalação única para vários domínios teria colisão de arquivos e de canonical.
- `config/custom-environment-variables.json:3,6` mapeia `shop.homeUrl` para `HOME_URL` e `system.theme` para `THEME`. `EVERSHOP_HOME_URL` é a URL pública canônica usada em links absolutos, canonical, `hreflang`, `<loc>` do sitemap e linha `Sitemap:` do `robots.txt`.
- A documentação oficial “Multi-Language Stores” trata de prefixo de idioma no mesmo domínio (por exemplo `/de/...`), não de múltiplas lojas ou domínios por empresa.
- Os termos do EverShop Cloud reforçam o modelo por unidade: “Site” é uma loja hospedada, com um domínio customizado e um tema por Site.

Conclusão: multi-tenant exigiria fork/camada custom em settings, metafields, URLs, widgets, mídia, sitemap e admin. O custo de implementação e o risco de upgrade não se justificam para o estágio atual.

---

## Impacto por área

### Domínio e SEO local

- Cada empresa terá seu `domain` no manifesto (`companies/<slug>.json`) e seu `HOME_URL`/`EVERSHOP_HOME_URL` no ambiente da instalação.
- Canonical, `hreflang`, sitemap e `robots.txt` serão gerados no contexto do domínio daquela loja, sem compartilhar `public/`.
- Dados locais reais do manifesto — `city`, `uf`, `region`, `phone`, `whatsapp`, `address`, `mapsUrl` e `hours` — alimentam a renderização e os dados estruturados de cada empresa.
- Onde não há dado real conhecido, o manifesto mantém `null` e a seção correspondente é omitida. Exemplos já presentes no contrato: `publicEmail`, `placeId`, `rating.sourceUrl` e `seo.robotsTxt`.
- A geração de sitemap e `StructuredData` depende dos arquivos de outro dono; este documento não os edita.

### Page builder

- Cada instalação terá seu banco, logo seus widgets, posições e rascunhos são isolados.
- O template compartilhado versiona os **tipos**, schemas e componentes dos sete defaults atuais: `hc_menu`, `hc_hero`, `hc_departments`, `hc_featured_products`, `hc_differentials`, `hc_cta` e `hc_location` (`extensions/loja-exemplo-home/widgets.json:1-157`).
- Os defaults gerados serão gravados em `extensions/loja-exemplo-home/generated/widgets.json`; o conteúdo editado no admin permanece no DB da loja.
- `pb-draft-1` não entra no Git e não é publicado sem revisão.
- Dependência identificada: `extensions/loja-exemplo-home/src/bootstrap.js:8-16` resolve o tema por caminho fixo `themes/loja-exemplo/dist/components`. Enquanto isso não for ajustado pelo dono do arquivo, a troca de tema por manifesto não fica totalmente genericamente resolvida.

### Upgrades do core

- Os sete patches permanecem centralizados em `scripts/patch-*.mjs` e são reaplicados pelo `postinstall`; não devem ser editados dentro de `node_modules/`.
- Todas as lojas devem consumir a mesma versão do template compartilhado. Cada deploy roda `npm run build` e as migrations no start.
- Em ambiente com várias instâncias, subir uma de cada vez; fazer backup do DB antes de cada upgrade.
- Preferir tokens CSS, adições e componentes aditivos a overrides profundos do core, para reduzir o custo de atualização.
- Artefatos como `themes/loja-exemplo/src/components/frontStore/generated/company.ts`, `extensions/loja-exemplo-home/generated/widgets.json` e `config/generated/company.json` são gerados por `scripts/render-company-config.mjs` a partir de `COMPANY_SLUG`; não devem ser editados manualmente.

### Isolamento operacional

- Uma DB por empresa — a atual é `DB_NAME=loja-exemplo` (`.env.example:4`).
- Uma porta ou container por instalação — a atual é `PORT=3001` (`.env.example:8`).
- Credenciais de admin e `.env` são próprias de cada instalação e não fazem parte do manifesto público versionado.
- Backups, restore, smoke test e rollback são executados por loja; uma falha em uma empresa não derruba as demais.

---

## Layout recomendado

### Versionado no template compartilhado

```txt
companies/
  _template.json
  <slug>.json
  loja-exemplo.json
  schema.json

scripts/
  render-company-config.mjs
  render-company-sitemap.mjs
  company-create.mjs
  seed-company.mjs
  seed-homepage-widgets.mjs
  seed-metadata-cms.mjs
  patch-*.mjs
  check-company-leaks.mjs

themes/loja-exemplo/
  src/components/frontStore/site.ts
  src/components/frontStore/generated/company.ts
  src/components/frontStore/StructuredData.tsx
  src/pages/all/Base.tsx
  src/pages/all/theme.css
  public/company-overrides.css

extensions/
  loja-exemplo-home/
    widgets.json
    generated/widgets.json
    src/bootstrap.js
  company-config/

config/
  default.json
  custom-environment-variables.json
  generated/company.json

.env.example
```

### Por empresa / por instalação

```txt
.env                         # DB_NAME, DB_*, PORT, HOME_URL/EVERSHOP_HOME_URL, ADMIN_*, COMPANY_SLUG
PostgreSQL                   # um database por empresa
public/                      # sitemap.xml e demais arquivos estáticos daquela instalação
media/                       # uploads daquela empresa
.evershop/ e pb-draft-1      # estado local/rascunho, fora do Git
domínio + DNS + SSL          # um domínio canônico por empresa
backup                       # backup restaurável por empresa
```

### Contrato do manifesto

- Arquivo: `companies/<slug>.json`; padrão: `companies/loja-exemplo.json` com `"default": true`.
- Template vazio: `companies/_template.json`; validação: `companies/schema.json`.
- Seleção: `COMPANY_SLUG`, com fallback para `loja-exemplo`.
- Campos mínimos conhecidos: `schema`, `slug`, `default`, `domain`, `theme`, `extension`, `name`, `shortName`, `tagline`, `description`, `city`, `uf`, `region`, `phone`, `whatsapp`, `address`, `hours`, `mapsUrl`, `nav`, `cmsSlugs`, `departments`, `brand`, `priceMode`, `seo` e `catalog`.
- `theme` e `extension` no manifesto devem ser refletidos em `system.theme` e `system.extensions` de `config/default.json`, respeitando os mapeamentos de `config/custom-environment-variables.json`.
- Dados ausentes continuam `null`; seções sem dado real são omitidas.

---

## Dependências de outros donos

Não editadas neste documento, conforme a tabela de donos de `docs/AGENT_CONTRACT.md`:

- `companies/*`, `scripts/render-company-config.mjs`, `.env.example` e `package.json` — config/manifesto.
- `scripts/render-company-sitemap.mjs`, `StructuredData.tsx` e `Base.tsx` — SEO/domínio.
- `extensions/loja-exemplo-home/src/bootstrap.js` e `scripts/seed-homepage-widgets.mjs` — page builder.
- `themes/loja-exemplo/src/components/frontStore/site.ts` — WhatsApp.
- `theme.css` e `company-overrides.css` — tokens CSS.
- `extensions/company-config/**`, `config/default.json` e `scripts/compile-extension.mjs` — extensão de configuração.
- `scripts/company-create.mjs` — CLI de provisão.
- `scripts/patch-ptbr-core.mjs` e `scripts/patch-verify.mjs` — patches pt-BR.
- `scripts/check-company-leaks.mjs` — auditoria de vazamento.
- CI, checklist, segurança, LGPD, onboarding, roadmap e nomenclatura — donos próprios em `docs/`.

---

## O que será reconsiderado no futuro

Reavaliar o modelo A somente quando pelo menos uma destas condições se tornar real e comprovada:

1. O EverShop passar a expor tenancy/store nativa: `store_id`/`website_id` em settings, metafields, `url_rewrite`, widgets, mídia e sitemap.
2. A quantidade de empresas crescer a ponto de o custo de N processos/DBs superar o custo de manter uma camada multi-tenant custom.
3. Existir uma forma oficial ou bem testada de isolar canonical, sitemap, `robots.txt` e domínios dentro de uma única instalação.
4. A camada custom de tenancy passar em testes automatizados de vazamento, upgrade e regressão de SEO sem forks frágeis.
5. A automação de provisão/deploy por loja estiver estável e o modelo B/C ainda assim se tornar o gargalo principal.

Até lá, a decisão permanece: **uma empresa = uma instalação + um DB + um domínio; código comum versionado e reutilizado**.

---

## Riscos registrados nesta Fase 0

- `README.md:46-48` descreve seis widgets (`hc_menu` não aparece na lista), enquanto `extensions/loja-exemplo-home/widgets.json:1-157` e `docs/AGENT_CONTRACT.md` descrevem sete. O README não pertence a este agente e não foi alterado.
- O diretório `companies/` ainda não existia no momento da leitura; depende do agente de config/manifesto.
- `scripts/patch-verify.mjs` consta no contrato, mas não estava presente em `scripts/` no momento da leitura; depende do agente de patches pt-BR.
- O caminho fixo do tema em `extensions/loja-exemplo-home/src/bootstrap.js:8-16` limita a troca de tema por empresa até ser tratado pelo dono do arquivo.
- Este documento não valida deploy, build, migração, SEO publicado nem conteúdo do page builder; apenas consolida a decisão de arquitetura aprovada.
