# ROADMAP.md — roadmap white-label multi-instalação (pt-BR)

- Versão: 1.0 (2026-11-23)
- Dono: sessão `ses_df5c4640effeRRaBpu67gq10Os` (roadmap)
- Base absoluta: `C:\Projetos\Loja Exemplo\evershop-seu-ecommerce-facil`
- Fontes: `docs/AGENT_CONTRACT.md` e `docs/ARQUITETURA_MULTI_INSTALACAO.md`
- Natureza: documento de sequenciamento. Não altera código, tema, visual, textos, dados nem a saída renderizada da Loja Exemplo.

## Premissas

1. Decisão aprovada: **modelo B operando como C híbrido** — uma instalação EverShop 2.4.0 por empresa, com processo e PostgreSQL próprios, e um template compartilhado versionado em Git. O modelo A (multi-tenant) está descartado nesta fase.
2. Uma empresa = uma instalação + um banco + um domínio canônico. Código comum versionado e reutilizado; automação gradual, sem plataforma multi-tenant agora.
3. Todo trabalho prático é executado pelos donos de arquivo da tabela de `docs/AGENT_CONTRACT.md`. Este documento apenas descreve a ordem e o que deve ser verificado em cada etapa.
4. Regras invioláveis em todas as fases: saída da Exemplo idêntica; somente dados reais conhecidos (ausência = `null` e seção omitida, nunca inventar); `pb-draft-1` intocável e fora do Git; não editar `node_modules/`, `dist/`, `.evershop/`, `media/` ou `public/sitemap*.xml`; não fazer `git commit`, `git push`, build, seed, migração, SQL, publicação nem deploy a partir deste documento.
5. **Não renomear tema nem extensão nesta fase.** Os identificadores `themes/loja-exemplo` e `extensions/loja-exemplo-home` — bem como os ids dos sete widgets `hc_menu`, `hc_hero`, `hc_departments`, `hc_featured_products`, `hc_differentials`, `hc_cta` e `hc_location` — permanecem como identificadores estáveis do template. A personalização de marca ocorre por manifesto, tokens CSS e conteúdo gerado, não por rename de pastas, pacotes ou tipos.

## Visão geral

| Fase | Objetivo | Dependência principal | Situação |
|---|---|---|---|
| Fase 0 | Fundação do template: manifestos, gerador e patches, sem renomear tema/extensão | Donos de config/manifesto, patches, SEO, page builder, CSS, extensão de config e CI | Decisão aprovada; entregas dependem dos respectivos donos |
| Fase 1 | Primeira empresa nova, com domínio real, em instalação separada | Fase 0 + dados reais fornecidos pela empresa | Sequenciada, não executada aqui |
| Fase 2 | Automação de provisão via `scripts/company-create.mjs` | Fase 1 validada | Sequenciada, não executada aqui |
| Fase 3 | Marketplaces Mercado Livre e Shopee | Preço real por SKU (hoje bloqueado por `price: 0`) | **Bloqueada** |

---

## Fase 0 — Template, manifesto, gerador e patches (sem renomear tema/extensão)

**Objetivo.** Extrair do código os dados rígidos da marca para um manifesto por empresa e consolidar o template compartilhado, mantendo a renderização da Loja Exemplo exatamente como hoje. Nenhuma pasta, pacote, tema ou extensão é renomeado.

**Entregas esperadas dos donos de arquivo (não deste agente):**

- `companies/_template.json`, `companies/loja-exemplo.json` (`"default": true`) e `companies/schema.json`.
- `scripts/render-company-config.mjs` com seleção por `process.env.COMPANY_SLUG || 'loja-exemplo'`, gerando de forma determinística:
  - `themes/loja-exemplo/src/components/frontStore/generated/company.ts`;
  - `extensions/loja-exemplo-home/generated/widgets.json` (sete defaults preenchidos);
  - `config/generated/company.json`.
- `.env.example` e `package.json` (somente script `company:render` e prefixo no `build`).
- Patches pt-BR centralizados em `scripts/patch-ptbr-core.mjs` e `scripts/patch-verify.mjs`, reaplicados no `postinstall`, sem tocar em `node_modules/`.
- Compatibilidade da API: `site.ts` continua exportando `SITE`, `NAV`, `quoteHref(productName?)` e, opcionalmente, `waLink({ source, productName?, categoryName?, itemCount? })`; `Header`, `Footer`, `ProductSingleForm`, `CartSummary` e widgets mantêm a assinatura atual.
- Configuração: `extensions/company-config/**`, `config/default.json` e `scripts/compile-extension.mjs` refletindo `theme`/`extension` do manifesto nos mapeamentos de ambiente.
- SEO/domínio: `scripts/render-company-sitemap.mjs`, `StructuredData.tsx` e `Base.tsx` usando `domain`/`HOME_URL` da instância.
- Tokens CSS (`theme.css`, `company-overrides.css`) e page builder (`seed-homepage-widgets.mjs`, `bootstrap.js`) sem alterar `pb-draft-1`.
- Documentação e verificação de apoio: CI de template, checklist de publicação, segurança/isolamento, LGPD, onboarding, nomenclatura e auditoria de vazamento, cada uma no respectivo dono.

**Guardrails específicos da Fase 0:** manter `themes/loja-exemplo` e `extensions/loja-exemplo-home` com os mesmos nomes em código, configuração e documentação de referência; não editar manualmente os três artefatos gerados; não mover, copiar ou publicar o rascunho `pb-draft-1`.

**Critérios de saída da Fase 0:**

1. Diff visual e textual zero na Loja Exemplo (home, departamentos, produtos, CMS, blog, carrinho, login, WhatsApp, SEO e rodapé).
2. Gerador é determinístico e idempotente: com ou sem `COMPANY_SLUG`, produz os mesmos três artefatos para o manifesto default; não há edição manual nesses arquivos.
3. Manifestos validam contra `companies/schema.json`; campos desconhecidos não existem; dado ausente é `null` e a seção correspondente é omitida; nenhum dado foi inventado.
4. Patches pt-BR reaplicáveis e verificáveis; `node_modules/`, `dist/`, `.evershop/`, `media/` e `public/sitemap*.xml` permanecem intocados.
5. API antiga preservada: `SITE`, `NAV`, `quoteHref` e componentes atuais continuam com a mesma assinatura; `waLink` é aditiva.
6. Nenhum rename de tema, extensão, diretório de pacote ou id de widget; `priceMode` da Exemplo continua `quote`.
7. `pb-draft-1` permanece fora do Git e intocável; nenhum commit, push, build, seed, migração, SQL ou publicação foi feito como parte desta fase.
8. Pendências conhecidas estão registradas nos documentos dos donos, em especial o caminho fixo do tema em `extensions/loja-exemplo-home/src/bootstrap.js:8-16` e a divergência README (seis widgets) × `widgets.json` (sete).

---

## Fase 1 — Primeira empresa nova com domínio real

**Objetivo.** Validar o template em uma instalação real, isolada da Exemplo, usando **somente dados reais** da nova empresa e um domínio canônico próprio.

**Entradas necessárias antes de começar:**

- `companies/<slug>.json` preenchido pelo dono de config/manifesto com `slug`, `domain` HTTPS real, `name`, `shortName`, `tagline`, `description`, `city`, `uf`, `region`, `phone`, `whatsapp`, `address`, `hours`, `mapsUrl`, `nav`, `cmsSlugs`, `departments`, `brand`, `priceMode`, `seo` e `catalog` — ou `null`/seção omitida onde não houver dado real.
- Domínio com DNS e SSL configurados pelo responsável da infraestrutura; `HOME_URL`/`EVERSHOP_HOME_URL` apontando para esse domínio.
- Credenciais administrativas próprias, mantidas fora do manifesto público e fora do Git.

**Sequência prevista (execução pelos donos/operador autorizado):**

1. Validar o manifesto contra `companies/schema.json` e conferir que não há dados da Exemplo copiados.
2. Gerar os artefatos com `COMPANY_SLUG=<slug>`; conferir que `company.ts`, `widgets.json` e `config/generated/company.json` refletem a nova empresa.
3. Provisionar PostgreSQL próprio e `.env` próprio (`DB_NAME`, `DB_*`, `PORT`, `HOME_URL`/`EVERSHOP_HOME_URL`, `ADMIN_*`, `COMPANY_SLUG`), sem versionar esse arquivo.
4. Ajustar `system.theme`/`system.extensions` pelos mapeamentos de ambiente, mantendo os nomes `loja-exemplo` e `loja-exemplo-home`.
5. Executar build, migrations, seed de catálogo/páginas e defaults do page builder na instância nova; `pb-draft-1` não é migrado.
6. Gerar sitemap, `robots.txt`, canonical e dados estruturados no domínio novo; publicar e executar smoke test por loja, com backup e rollback preparados.

**Critérios de saída da Fase 1:**

1. O domínio real responde em HTTPS e `HOME_URL` é consistente em canonical, `hreflang`, `<loc>` do sitemap e linha `Sitemap:` do `robots.txt`.
2. Nenhum dado da Exemplo aparece na nova loja: nome, telefone, WhatsApp, endereço, horário, mapa, marca, navegação, textos, SEO e catálogo vêm do manifesto da nova empresa; auditoria `check-company-leaks.mjs` sem achados.
3. Dados ausentes permanecem `null`/omitidos; o responsável pela empresa revisa e aprova textos e contatos exibidos.
4. DB, mídia, widgets, rascunhos, admin e backup da nova empresa são separados; uma falha nela não derruba a Exemplo.
5. Build, migrations e seed executados com sucesso pelo operador autorizado, com rollback testado; a Exemplo continua com saída idêntica.
6. Tema e extensão continuam com os mesmos nomes do template; nenhum rename foi introduzido para "adaptar" a nova empresa.

---

## Fase 2 — Automação via `company-create`

**Objetivo.** Converter o procedimento manual da Fase 1 em um caminho determinístico e repetível, centrado em `scripts/company-create.mjs`, sem perder o isolamento por instalação.

**Escopo previsto:**

- Receber um manifesto já preenchido com dados reais e validá-lo contra `companies/schema.json` antes de qualquer escrita.
- Checar slug duplicado, domínio obrigatório/HTTPS e ausência de segredos no manifesto; falhar cedo e com mensagem clara.
- Gerar os três artefatos com `COMPANY_SLUG`, montar `.env` local a partir de `.env.example` (credenciais ficam apenas no ambiente da instalação) e preparar o diretório da nova loja.
- Encadear, por operador autorizado, patches, build, migrations, seed de catálogo/páginas/widgets, sitemap e smoke test — com backup prévio e rollback documentado.
- Integrar `.github/workflows/template-ci.yml` para validar manifesto, geração, patches e build por loja; publicar o runbook em `docs/CHECKLIST_PUBLICACAO.md` e `docs/ONBOARDING.md` pelos respectivos donos.

**Critérios de saída da Fase 2:**

1. Um único comando documentado, com manifesto/slug como entrada, reproduz o resultado da Fase 1 para uma segunda empresa real.
2. O script falha antes de provisionar se manifesto inválido, slug já existente, domínio ausente/inválido ou segredo presente no manifesto.
3. Reexecução é idempotente ou falha explicitamente sem sobrescrever instalação existente; backup do DB é pré-requisito registrado.
4. Diferença entre instalações limitada a manifesto, `.env`, DB, mídia, domínio e conteúdo editado no admin; nenhum fork de tema/extensão por empresa e nenhum rename.
5. Nenhuma credencial, dump de banco, `.env` ou `pb-draft-1` versionado; auditoria de vazamento limpa para todas as lojas.
6. CI valida cada loja independentemente; deploy ou falha de uma não altera as demais; Exemplo permanece idêntica.
7. Nenhum comando desta fase é executado, comitado ou publicado por este documento — a automação é entregue como código e runbook pelos donos.

---

## Fase 3 — Marketplaces Mercado Livre e Shopee (bloqueada hoje por `price: 0`)

**Situação: BLOQUEADA. Não implementar, não prometer data e não criar anúncios nesta fase.**

**Motivo do bloqueio.** O catálogo atual opera em `priceMode: "quote"`: produtos são "sob consulta", com `quoteOnly`/`price: 0` no patch pt-BR, e a conversão acontece pelo WhatsApp (`quoteHref`/`waLink`). Mercado Livre e Shopee exigem preço numérico real, estoque e regras comerciais/fiscais para anunciar, vender e conciliar pedidos. Publicar `price: 0` distorceria a oferta, poderia gerar venda por valor inválido e feriria a regra de nunca inventar dado — não existe hoje preço real no manifesto que autorize essa integração.

**Condições para desbloqueio (a validar com os donos de catálogo e das empresas; não executar agora):**

1. Definir `priceMode` efetivo com preço real por SKU, ou modelo híbrido em que o preço publicável seja explicitamente fornecido pela empresa. Nunca inferir preço a partir de `price: 0`.
2. Definir e documentar, por empresa, estoque, frete, tributos, identificadores de produto e política de devolução.
3. Manter credenciais de ML/Shopee apenas no `.env`/cofrinho da instalação, nunca no manifesto público versionado; sincronização restrita ao DB daquela empresa.
4. Verificar isolamento: anúncio, pedido, estoque e token da empresa A nunca podem usar dados da B; auditoria de vazamento e testes de regressão de SEO/canonical.
5. Revisar segurança, LGPD e checklist de publicação com os donos desses documentos antes de qualquer integração.

**Critérios de saída da Fase 3 (somente após desbloqueio):**

1. Nenhum anúncio é criado sem preço real validado e aprovado pela empresa; `price: 0` continua significando apenas "sob consulta" na loja própria.
2. Pedidos de marketplace são importados no DB da empresa correta, com conciliação de preço e estoque sem alterar o modo "sob consulta" do canal direto.
3. Segredos fora do Git, logs sem dados sensíveis e documentação de segurança/LGPD atualizada.
4. Desativar a integração não afeta venda direta nem WhatsApp; Exemplo e todas as demais lojas permanecem idênticas.
5. Publicação em ML/Shopee somente com aprovação explícita da empresa responsável — este documento não autoriza nem realiza publicação.

---

## Dependências de outros donos

| Fase | Arquivos/áreas envolvidos | Dono conforme `AGENT_CONTRACT.md` |
|---|---|---|
| 0 | `companies/*`, `scripts/render-company-config.mjs`, `.env.example`, `package.json` | config/manifesto |
| 0 | `scripts/patch-ptbr-core.mjs`, `scripts/patch-verify.mjs` | patches pt-BR |
| 0 | `scripts/render-company-sitemap.mjs`, `StructuredData.tsx`, `Base.tsx` | SEO/domínio |
| 0 | `extensions/loja-exemplo-home/src/bootstrap.js`, `scripts/seed-homepage-widgets.mjs` | page builder |
| 0 | `site.ts`, `theme.css`, `company-overrides.css`, `extensions/company-config/**`, `config/default.json` | WhatsApp, tokens CSS, extensão config |
| 0 | `.github/workflows/template-ci.yml`, `scripts/check-company-leaks.mjs`, docs de checklist/segurança/LGPD/onboarding/nomenclatura | CI, auditoria e donos de docs |
| 1 | `scripts/seed-company.mjs`, `schemas/catalog.schema.json`, domínio/DNS/SSL e `.env` da instalação | seeds catálogo + operador autorizado |
| 2 | `scripts/company-create.mjs`, CI, checklist e onboarding | CLI provisão + respectivos donos |
| 3 | Catálogo/preço, `.env` de cada instalação, segurança/LGPD | donos de catálogo, config e docs |

## Riscos e pendências registrados

- **Preço zero:** `priceMode: "quote"` / `price: 0` impede ML e Shopee; qualquer preço inventado viola o contrato. É o bloqueio explícito da Fase 3.
- **Caminho fixo do tema:** `extensions/loja-exemplo-home/src/bootstrap.js:8-16` aponta para `themes/loja-exemplo/dist/components`; limita a genericidade da troca de tema até ser tratado pelo dono do arquivo.
- **Divergência de inventário:** README cita seis widgets; `extensions/loja-exemplo-home/widgets.json` e o contrato citam sete. README não pertence a este agente.
- **Artefatos ausentes no momento da leitura:** `companies/` ainda não existia e `scripts/patch-verify.mjs` não estava presente; dependem dos respectivos donos.
- **Deriva entre instalações:** sem CI e checklist maduros, uma loja pode ficar fora de um deploy. Mitigação: uma instância por vez, backup antes de upgrade e smoke test por empresa.
- **Rascunho do page builder:** `pb-draft-1` permanece fora do Git e não deve ser publicado sem revisão; nenhuma fase aqui o considera pronto.
- **Dados ausentes:** se uma empresa nova não fornecer dado real (por exemplo `publicEmail`, `placeId`, `rating.sourceUrl`, `seo.robotsTxt`), o campo fica `null` e a seção é omitida; não se reaproveitam dados da Exemplo.
- **Reavaliação futura:** o modelo A só volta a ser considerado se houver tenancy nativa no EverShop, custo de N instalações claramente superior, isolamento oficial de canonical/sitemap/domínio em uma única instalação ou automação estável que ainda assim torne B/C o gargalo — conforme `docs/ARQUITETURA_MULTI_INSTALACAO.md`.
