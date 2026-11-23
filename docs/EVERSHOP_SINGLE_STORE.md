# EverShop 2.4 é single-store — evidências locais e consequências

## Status e escopo

Documento de registro/evidência da Fase 0. Não altera código, tema, textos, dados, saída renderizada, configuração nem o rascunho `pb-draft-1`.

- Base local: `@evershop/evershop@2.4.0` (`package.json:26`), com sete patches aplicados no `postinstall` (`package.json:7`).
- Método adotado aqui: **somente leitura** de arquivos locais. Não foi executado build, seed, migração, SQL, teste, comando de instalação, commit, push nem publicação de changeset.
- Fontes: arquivos do pacote instalado em `node_modules/@evershop/evershop/src/`, arquivos de configuração do projeto e os documentos `docs/AGENT_CONTRACT.md` e `docs/ARQUITETURA_MULTI_INSTALACAO.md`.
- Nenhum dado novo foi introduzido. Onde o contrato não traz valor real, o campo continua `null` ou a seção é omitida (`docs/AGENT_CONTRACT.md:11`).

Conclusão registrada: o EverShop 2.4 instalado neste projeto **não possui tenancy nativa**. Settings, metafields da loja, rewrites de URL e posições de widgets são globais por banco/instalação.

---

## Evidências locais

### 1. `setting` é global: chave única por `name`, sem dimensão de loja

- `node_modules/@evershop/evershop/src/modules/setting/migration/Version-1.0.0.js:6-14` cria a tabela com `setting_id`, `uuid`, `name`, `value` e `is_json`, e define `CONSTRAINT "SETTING_NAME_UNIQUE" UNIQUE ("name")`. Não há `store_id`, `website_id`, `site_id` ou qualquer outra coluna de loja.
- `node_modules/@evershop/evershop/src/modules/setting/services/setting.ts:27-33` mantém um cache único em memória (`let setting: Setting[] | undefined`) e carrega `select().from('setting').execute(pool)` sem cláusula de filtro. A linha é encontrada apenas por `s.name === name`.
- O mesmo arquivo repete a leitura global em `getSettingSync` (`:58-63`) e em `refreshSetting` (`:76-78`). `getStoreName` (`:80-84`) lê `storeName` desse conjunto único.
- `docs/ARQUITETURA_MULTI_INSTALACAO.md:26` já classificava `setting` como global; a leitura do DDL e do serviço confirma localmente essa classificação.

**O que prova:** não existe uma linha de `setting` por empresa dentro do mesmo banco. Um valor de configuração com determinado `name` é único por instalação.

### 2. `metafield_shop` é um singleton por banco

- `node_modules/@evershop/evershop/src/modules/base/migration/Version-1.0.3.ts:47-60`: o comentário descreve o owner `shop` como "global / standalone" e o blob de metadados como "one-row singleton (id is always true)". A DDL usa `"id" boolean PRIMARY KEY DEFAULT true`, `CONSTRAINT "METAFIELD_SHOP_SINGLETON" CHECK ("id")` e `INSERT INTO "metafield_shop" ("id") VALUES (true) ...`.
- `node_modules/@evershop/evershop/src/modules/base/services/shopMetafield.ts:21-28`: leitura `SELECT meta_data FROM "metafield_shop" WHERE id = true LIMIT 1`.
- Escrita: upsert em `id = true` (`shopMetafield.ts:32-45`) e `whereClause: 'id = true'` no caminho de um único metafield (`:53-68`).

**O que prova:** há exatamente um registro de metafield de "shop" por banco, sem chave que o separe por loja.

### 3. `url_rewrite` não tem dimensão de loja/tenant

- `node_modules/@evershop/evershop/src/modules/base/services/assertUrlKeyAvailable.ts:48-51`: a consulta é `select().from('url_rewrite').where('request_path', '=', path)` — sem `store_id`, `site_id` ou `tenant_id`.
- O conflito é decidido somente por `entity_uuid` e `entity_type` (`assertUrlKeyAvailable.ts:52-55`). O comentário de `:15-20` diz explicitamente que colisões entre tipos diferentes são permitidas e resolvidas por precedência de `entity_type` — não há precedência por loja.
- Os gravadores da mesma tabela também usam apenas a entidade como chave: por exemplo `catalog/services/product/productUrl.ts:49` consulta `entity_uuid, request_path ... WHERE entity_type = $1 AND entity_uuid = ANY($2::uuid[])`, e os subscribers de catálogo/blog/CMS gravam `url_rewrite` por `entity_uuid` (ex.: `catalog/subscribers/product_created/buildUrlRewrite.ts:20`, `cms/services/page/syncPageUrlRewrite.ts:25`).

**O que prova:** um `request_path` (slug) é global por instalação. Duas empresas na mesma tabela disputariam o mesmo namespace de URLs.

### 4. `widget_placement` não tem coluna de loja/site

- `node_modules/@evershop/evershop/src/modules/cms/migration/Version-1.3.0.ts:46-61`: a tabela contém `widget_placement_id`, `uuid`, `widget_instance_id`, `route`, `area`, `sort_order`, `entity_urn` e timestamps. A única FK é `widget_instance_id → widget_instance(widget_instance_id)`.
- Índices locais: `(route, area)` em `:63-66`, `widget_instance_id` em `:67-70` e `entity_urn` em `:71-74`. Nenhum inclui loja/site.
- Restrição de unicidade em `:78-82`: `CREATE UNIQUE INDEX widget_placement_unique ON widget_placement(widget_instance_id, route, area, COALESCE(entity_urn, ''))` — sem `store_id`/`site_id`.
- O backfill de `:87-98` produz uma linha por combinação `widget_instance × route × area`. O comentário de `:15-19` descreve os widgets filhos por convenção de `area` (`columnsContainer_<parent_uuid>_col_<index>`), também sem dimensão de loja.

**O que prova:** instâncias e posições de widgets são globais por banco. Não há como publicar uma posição distinta por empresa sem alterar o schema do core.

### 5. Ausência de `website`/`store`/`channel` e de colunas `*_id` de loja

- A varredura registrada em `docs/ARQUITETURA_MULTI_INSTALACAO.md:41` em `node_modules/@evershop/evershop/src/**/*.ts` por `store_id`, `tenant_id`, `website_id` e `multi_store` não encontrou resultados.
- Varredura adicional deste documento nos arquivos `.ts` do pacote, ampliada com `channel_id`, `multiStore`, `multi-store` e `site_id`, encontrou **um único** local com `site_id`: `node_modules/@evershop/evershop/src/types/db/index.ts:1484-1514`. Trata-se de `SiteRow`, sob o cabeçalho literal `SITE (Cloud specific - may not exist in all installations)`, com colunas como `domain`, `db_name`, `db_username`, `db_password`, `admin_email`, `github_repository` e `version`.
- Esse `site_id` **não** é uma coluna de loja nas tabelas de negócio: é o tipo de uma tabela de controle do EverShop Cloud que descreve um Site hospedado com seu próprio banco e domínio. A busca por `site_id` dentro de `src/modules/**/migration/*.ts` não retornou resultados, ou seja, nenhuma migration do core cria essa coluna em `setting`, `url_rewrite`, `widget_placement` ou tabelas de catálogo/OMS.
- Corroboração documental já registrada localmente: a documentação oficial "Multi-Language Stores" trata de prefixo de idioma no mesmo domínio, não de múltiplas lojas (`docs/ARQUITETURA_MULTI_INSTALACAO.md:47`), e os termos do EverShop Cloud definem "Site" como uma loja hospedada, com domínio customizado e tema por Site (`docs/ARQUITETURA_MULTI_INSTALACAO.md:48`).

**O que prova:** não existe `website_id`, `store_id`, `channel_id` ou coluna equivalente particionando os dados transacionais. O `site_id` existente no Cloud reforça a unidade "um Site = um domínio = um DB", em vez de viabilizar várias lojas em um DB só.

### 6. Configuração e saída estática são por processo, não por loja

- `config/custom-environment-variables.json:2-7`: `shop.homeUrl` ← `HOME_URL` e `system.theme` ← `THEME`. São duas variáveis por instalação, não uma por loja. `docs/ARQUITETURA_MULTI_INSTALACAO.md:46` registra `EVERSHOP_HOME_URL` como a URL pública canônica usada em links absolutos, canonical, `hreflang`, `<loc>` do sitemap e linha `Sitemap:` do `robots.txt`.
- `node_modules/@evershop/evershop/src/modules/base/services/sitemap/storage.ts:30-35` e `:56-60`: os arquivos são gravados de forma plana no `public/` da instalação (`sitemap.xml`, `sitemap-products.xml`, etc.); `:86-101` remove órfãos que casam com o padrão `^sitemap(-[a-z0-9-]+)?\.xml$`.

**O que prova:** uma única instalação sirvendo vários domínios colidiria em `homeUrl`, canonical e nos mesmos arquivos de sitemap/robots em `public/`.

---

## Consequências por área

### Domínio

- Um `HOME_URL`/`EVERSHOP_HOME_URL` e um `THEME` por instalação (`config/custom-environment-variables.json:3,6`). Não há seletor de loja por requisição.
- Cada empresa terá seu `domain` no manifesto (`docs/AGENT_CONTRACT.md:26`) e seu ambiente próprio (`docs/ARQUITETURA_MULTI_INSTALACAO.md:58`).
- Isolamento real é de processo/container + banco: a instalação atual usa `DB_NAME=loja-exemplo` e `PORT=3001` (`docs/ARQUITETURA_MULTI_INSTALACAO.md:82-83`).

### SEO

- Canonical, `hreflang`, links absolutos, `<loc>` do sitemap e `robots.txt` derivam da URL canônica única da instalação (`docs/ARQUITETURA_MULTI_INSTALACAO.md:46`).
- Com `url_rewrite` global, um slug idêntico entre empresas colidiria em `assertUrlKeyAvailable.ts:48-55`; não há dimensão de loja para desempatar.
- A gravação plana em `public/` (`storage.ts:33-35,59`) impede compartilhar a mesma instalação entre domínios sem sobrescrever `sitemap.xml`.
- A geração de sitemap e `StructuredData` depende de arquivos de outros donos; este documento não os edita (`docs/ARQUITETURA_MULTI_INSTALACAO.md:62`).

### Page builder

- `widget_placement` sem coluna de loja (`Version-1.3.0.ts:46-61,78-82`) significa que, na mesma DB, editar uma posição afetaria todas as empresas. O isolamento só existe com banco separado por instalação (`docs/ARQUITETURA_MULTI_INSTALACAO.md:66-69`).
- Os tipos e schemas dos sete defaults (`hc_menu`, `hc_hero`, `hc_departments`, `hc_featured_products`, `hc_differentials`, `hc_cta` e `hc_location`) permanecem versionados no template; o conteúdo editado fica no DB da loja (`docs/ARQUITETURA_MULTI_INSTALACAO.md:67-68`).
- `pb-draft-1` continua fora do Git e não publicado (`docs/AGENT_CONTRACT.md:9`; `docs/ARQUITETURA_MULTI_INSTALACAO.md:69`).
- Dependência registrada: `extensions/loja-exemplo-home/src/bootstrap.js:8-16` resolve o tema por caminho fixo `themes/loja-exemplo/dist/components` (`docs/ARQUITETURA_MULTI_INSTALACAO.md:70`).

### Upgrades do core

- Os sete patches ficam centralizados em `scripts/patch-*.mjs` e são reaplicados no `postinstall` (`package.json:7`; `docs/ARQUITETURA_MULTI_INSTALACAO.md:74`). `node_modules/` não é editado (`docs/AGENT_CONTRACT.md:3`).
- Qualquer camada de tenancy teria que alterar DDL e consultas do core em `setting`, `metafield_shop`, `url_rewrite`, `widget_placement`, mídia, sitemap e admin; isso colidiria com os patches e com versões futuras (`docs/ARQUITETURA_MULTI_INSTALACAO.md:37,50`).
- Por isso a decisão é uma versão de template consumida por todas as lojas, com `npm run build` e migrations por deploy, backup do DB antes de cada upgrade, subida de uma instância por vez e preferência por tokens/componentes aditivos a overrides profundos (`docs/ARQUITETURA_MULTI_INSTALACAO.md:75-78`).

---

## O que isso impediu no multi-tenant

O modelo A (uma instalação multi-tenant) foi descartado na Fase 0 (`docs/ARQUITETURA_MULTI_INSTALACAO.md:17,35-50`). As evidências acima impediram, sem fork do core:

1. Uma linha de `setting` por empresa — `SETTING_NAME_UNIQUE` e leitura global em cache.
2. Metafields de shop por empresa — singleton `id = true`.
3. Slugs por empresa — `url_rewrite` sem dimensão de loja.
4. Widgets e posições por empresa — `widget_placement` sem `store_id`/`site_id`.
5. Sitemap e `robots.txt` por domínio na mesma instalação — arquivos planos em `public/`.
6. `homeUrl` e tema por empresa no mesmo processo — `HOME_URL` e `THEME` únicos.

Substituiu-se isso pelo modelo B operando como C híbrido: **uma empresa = uma instalação + um banco + um domínio**, com template compartilhado e automação centralizada gradual (`docs/ARQUITETURA_MULTI_INSTALACAO.md:11-15,183`). Reavaliação futura só sob as condições listadas em `docs/ARQUITETURA_MULTI_INSTALACAO.md:175-181` (tenancy nativa, custo das N instalações, isolamento oficial de canonical/sitemap/domínios, testes de vazamento/upgrade/SEO ou estabilidade da automação sem o modelo A continuar sendo gargalo).

---

## Limites desta verificação

- Não houve inspeção de banco em execução, deploy, build, seed, migração, SQL ou SEO publicado. As conclusões são de leitura estática dos arquivos locais citados.
- A ausência de colunas de loja foi aferida por varredura textual nos arquivos `.ts` do pacote; isso não garante que uma extensão de terceiros não adicione tenancy por conta própria.
- Os sete patches locais podem alterar comportamento do pacote; foram citadas evidências de `src/`, sem conclusões sobre código alterado por patch além das já registradas em `docs/ARQUITETURA_MULTI_INSTALACAO.md`.
- Arquivos de SEO/domínio, page builder e configuração pertencem a outros donos conforme `docs/AGENT_CONTRACT.md:101-125`; nenhum foi editado aqui.

## Riscos

- O `site_id` de `SiteRow` (`src/types/db/index.ts:1488-1508`) existe no pacote, embora marcado como específico do Cloud. Se o core passar a propagar essa coluna às tabelas de negócio, a conclusão "single-store" precisará ser revalidada.
- A varredura negativa cobre o código-fonte local, não o comportamento em runtime nem um banco já migrado; um banco custom poderia ter colunas adicionais fora deste escopo.
- Colisão de slug e de arquivos de sitemap permanecem riscos reais se alguém tentar servir múltiplos domínios em uma única instalação.
- A troca de tema por manifesto ainda depende do ajuste de `extensions/loja-exemplo-home/src/bootstrap.js` pelo dono do arquivo.
- Este documento não reporta nada como "pronto para publicar" e não autoriza deploy, publicação de changeset ou alteração da saída renderizada da Loja Exemplo.
