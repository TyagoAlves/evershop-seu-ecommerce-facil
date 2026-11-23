# Onboarding de nova empresa (white-label — Fase 0)

Este guia descreve como entrar com uma **empresa nova** no template compartilhado do EverShop 2.4.0. A decisão de arquitetura é **uma empresa = uma instalação + um processo + um banco PostgreSQL + um domínio canônico**, com código comum versionado (`docs/ARQUITETURA_MULTI_INSTALACAO.md`).

Regras de leitura obrigatórias antes de qualquer ação: `docs/AGENT_CONTRACT.md`. Em particular:

- **Domínios futuros ainda não foram definidos.** Não inventar host, URL, prefixo ou domínio “provisório”. Se o cliente não forneceu o domínio real, `domain` fica `null` e a geração de sitemap/robots é ignorada.
- **Dados ausentes ficam `null`.** Seção sem dado real fornecido pelo cliente não recebe texto, SKU, telefone, endereço, cor ou mensagem inventada. “Omitir a seção” significa não preencher o conteúdo; as **chaves exigidas por `companies/schema.json` permanecem presentes** com `null`/`[]`, porque o schema usa `required` e `additionalProperties: false`.
- A saída da Loja Exemplo continua idêntica: o manifesto padrão é `companies/loja-exemplo.json` com `"default": true`; uma empresa nova nunca herda esse `default`.
- Este documento registra o procedimento. **Nenhum comando foi executado, nenhum build/seed/deploy foi feito e nada foi publicado** na redação deste guia. Os comandos abaixo são a sequência prevista para o responsável pela operação.

---

## 0. Coletar os dados reais do cliente

Só avance com informações efetivamente fornecidas pelo cliente. Checklist mínimo:

| Bloco | Dados a solicitar |
|---|---|
| Identidade | `slug` (lowercase com hífens), `name`, `shortName`, `default` (`false`), `theme`, `extension` |
| Localização | `city`, `uf`, `region`, `address` (`full`, `short`, `streetAddress`, `locality`, `region`, `postalCode`, `country`), `mapsUrl`, `placeId` |
| Contato | `phone.display`/`phone.e164`, `whatsapp.display`/`number`/`defaultMessage`/`infoMessage`/`quoteMessageTemplate`, `publicEmail`, `facebook`, `hours` |
| Conteúdo | `tagline`, `description`, `nav`, `cmsSlugs`, `departments`, `departmentsIntro`, `featured`, `differentialsIntro`, `differentials`, `hero`, `cta`, `location` |
| Marca e preço | `brand` (`primary`, `hover`, `dark`, `soft`, `shortName`), `priceMode` (`quote` ou `sale`) |
| SEO | `seo.description`, `seo.titleTemplates`, `seo.robotsTxt` |
| Catálogo | `catalog.skuPrefix`, `collections`, `categories`, `products`, `pages` — somente itens reais; sem catálogo, manter arrays vazios e `skuPrefix: null` |
| Domínio | **Ainda não definido para empresas futuras.** Manter `domain: null` até o cliente informar a URL pública canônica |
| Segredos | E-mail/senha do primeiro administrador e credenciais do banco **não entram no manifesto**; ficam no `.env` local/cofre da instalação |

Se o cliente não souber um valor, deixe `null`. Não copie valores da Exemplo para preencher lacunas.

---

## 1. Criar o manifesto a partir de `companies/_template.json`

1. Copie `companies/_template.json` para `companies/<slug>.json`.
2. Ajuste `schema: 1` e `slug` para o mesmo `<slug>` do nome do arquivo.
3. Mantenha `default: false`. Apenas `loja-exemplo.json` pode ser `true`.
4. Preencha **somente** dados reais do cliente. Todo o resto continua `null` ou `[]`.
5. Não adicione propriedades fora do schema; `additionalProperties: false` rejeita campos extras.
6. Use JSON válido (sem comentários no arquivo final).

`theme` e `extension` precisam apontar para os diretórios que realmente existem no template. Na Fase 0, os valores conhecidos são `loja-exemplo` e `loja-exemplo-home`; não renomear pastas nem criar tema novo sem o dono do arquivo correspondente.

> Atenção: `companies/schema.json` aceita `null` em vários campos, mas `scripts/render-company-config.mjs` possui uma lista `requiredForRender` (tema, extensão, nome, WhatsApp, textos de hero/CTA/localização, `departmentsIntro`, `featured`, `differentialsIntro` etc.) que **não aceita `null`/vazio**. Se o cliente não fornecer um desses valores, o renderer falha: a empresa fica bloqueada até o dado real chegar. Não contorne isso com texto inventado.

---

## 2. Validar o manifesto e gerar os artefatos

Validação primária: `companies/schema.json`. O gerador também valida o manifesto antes de escrever qualquer arquivo.

Comando previsto (adaptar a sintaxe da variável de ambiente para o shell usado; no PowerShell, `$env:COMPANY_SLUG='<slug>'`):

```bash
COMPANY_SLUG=<slug> npm run company:render
```

O script `scripts/render-company-config.mjs` escolhe `companies/<COMPANY_SLUG>.json` (fallback: `loja-exemplo`) e grava, de forma determinística:

- `themes/<theme>/src/components/frontStore/generated/company.ts` — exporta `COMPANY`;
- `extensions/<extension>/generated/widgets.json` — 7 defaults: `hc_menu`, `hc_hero`, `hc_departments`, `hc_featured_products`, `hc_differentials`, `hc_cta`, `hc_location`;
- `config/generated/company.json` — cópia do manifesto ativo para runtime/CI.

Esses três arquivos são **gerados**: nunca editá-los manualmente. Se a validação falhar, corrija o manifesto com dados reais ou registre o dado pendente; não faça “ajuste temporário” no artefato gerado.

---

## 3. Preparar instalação, DB, processo e `.env` próprios

Cada empresa recebe:

- **Database e role PostgreSQL dedicados** (a baseline usa `DB_NAME=loja-exemplo`; uma nova empresa não pode reutilizá-lo);
- **Porta/container próprio** (a baseline usa `PORT=3001`; escolher outra porta livre);
- **`.env` próprio, local e não versionado**, copiado de `.env.example`;
- **Credenciais de admin próprias**, usadas apenas na criação do primeiro administrador, jamais no manifesto público;
- **`COMPANY_SLUG=<slug>`** no ambiente, para manter manifesto, artefatos gerados e seeds alinhados;
- **`EVERSHOP_HOME_URL`** como URL pública canônica definida **no deploy**. Convenção do `.env.example`: não definir `HOME_URL` à mão; `EVERSHOP_HOME_URL` é a fonte única do domínio público. Quando o domínio real ainda não existe, não preencher valor fictício — manter `domain: null` no manifesto e tratar a geração de sitemap como etapa ignorada.

Exemplo de `.env` de uma nova instalação (somente com dados reais):

```dotenv
DB_HOST=localhost
DB_PORT=5432
DB_NAME=<db_da_empresa>
DB_USER=<role_da_empresa>
DB_PASSWORD=<segredo_local>
DB_SSLMODE=disable
PORT=<porta_livre>
COMPANY_SLUG=<slug>
EVERSHOP_HOME_URL=<url_real_quando_existir>
```

### Provisão assistida (opcional)

`scripts/company-create.mjs` automatiza: validar entradas/porta/DB, criar diretório e `provision.json`, criar role/database, copiar a base, gravar `.env`, aplicar patches, renderizar, criar schema/admin, rodar seeds, buildar, gerar sitemap (somente se houver domínio), subir o servidor e fazer healthcheck.

Antes de qualquer aplicação, usar `--dry-run`; a senha do admin vai por variável de ambiente ou arquivo secreto, nunca em claro na linha de comando:

```bash
COMPANY_ADMIN_PASSWORD='...' npm run company:create -- \
  --slug=<slug> \
  --admin-email=<email_real> \
  --admin-password=COMPANY_ADMIN_PASSWORD \
  --port=<porta_livre> \
  --dry-run
```

Se houver domínio real confirmado, acrescentar `--domain=https://dominio-real.com.br`. Sem `--domain`, a etapa de sitemap é marcada como ignorada (“nada inventado”). O comando pertence ao dono da CLI de provisão; conferir se `company:create` está registrado no `package.json` antes de usar. A execução real cria DB/role e copia a base — não fazê-la sem autorização e sem backup.

---

## 4. Instalar/buildar e subir o processo

Sequência prevista para o responsável da instalação (não executada neste documento):

1. Aplicar o `postinstall` do template: os sete patches ficam centralizados em `scripts/patch-*.mjs`; **não editar `node_modules/`**.
2. Rodar `npm run company:render` com `COMPANY_SLUG` da empresa.
3. Rodar `npm run build`: o script já prefixa `company:render`, compila tema/extensão e roda `evershop build`.
4. Subir **uma instalação por vez**, com migrations no start e backup do DB antes de upgrades.
5. Executar smoke test por loja; uma empresa com problema não pode impedir as demais.

Não editar `dist/`, `.evershop/`, `media/` nem `public/sitemap*.xml`. Esses diretórios/artefatos são locais por instalação.

---

## 5. Seeds da empresa

Ordem recomendada, sempre com o `.env`/`COMPANY_SLUG` da instalação correta e o DB dedicado:

1. `npm run setup` — cria schema e primeiro administrador usando `ADMIN_*` do ambiente daquela instalação.
2. `node scripts/seed-company.mjs` — seeds de catálogo a partir de `catalog` do manifesto. Sem dados reais de coleções/categorias/produtos/páginas, manter arrays vazios; não gerar SKU “de exemplo”.
3. `node scripts/seed-homepage-widgets.mjs` (equivalente a `npm run seed:home`) — cria as instâncias e posições dos 7 widgets padrão. O script é idempotente e usa UUIDs fixos para a Exemplo e UUIDv5 derivados do `slug` para empresas novas; não duplica registros ao repetir.
4. `node scripts/seed-metadata-cms.mjs` (ou `npm run seed`, que roda `evershop seed` + este script) — metadata e rewrites. `cmsSlugs` só deve conter páginas reais fornecidas/criadas para a empresa.

Conferir depois dos seeds: nenhum produto, página ou texto da Exemplo aparece no DB da nova empresa; contagens e slugs batem com o manifesto; reexecutar os scripts não cria duplicatas.

---

## 6. Page builder

- Os tipos/schemas/componentes dos 7 widgets são versionados no template; os **conteúdos editados no admin ficam no DB daquela instalação**.
- Após o seed, revisar no admin: menu, hero, departamentos, produtos em destaque, diferenciais, CTA e localização. Os textos devem vir do manifesto ativo; links de WhatsApp devem usar o número real da empresa.
- O rascunho `pb-draft-1` **não entra no Git e não é publicado** sem revisão explícita. Não tocar nele neste fluxo.
- Validação visual: home e páginas CMS da nova empresa com a marca dela; a home da Exemplo permanece idêntica à baseline.
- Dependência conhecida: `extensions/loja-exemplo-home/src/bootstrap.js` resolve o tema por caminho fixo `themes/loja-exemplo/dist/components`. Até o dono do arquivo ajustar, a troca de tema por manifesto não é totalmente genérica.

---

## 7. Domínio, SEO e sitemap

- **Enquanto não houver domínio real:** `domain: null`, sem sitemap, sem `robots.txt` inventado e sem substituto temporário em `EVERSHOP_HOME_URL`.
- **Quando o cliente fornecer o domínio:** conferir que `companies/<slug>.json → domain` e `EVERSHOP_HOME_URL` no deploy apontam para a **mesma URL canônica**; então rodar `COMPANY_SLUG=<slug> node scripts/render-company-sitemap.mjs`. O script usa `domain` como base de `<loc>`, canonical e `hreflang`, além da diretiva `Sitemap:`; `public/robots.txt` só é gravado se `seo.robotsTxt` existir no manifesto.
- Cada instalação tem seu `public/` e seus XML: nunca mover/copiar sitemap de uma loja para outra nem versionar `public/sitemap*.xml`.
- Validar no deploy: canonical, hreflang, `<loc>` do sitemap, linha `Sitemap:` do robots e links absolutos usam apenas o domínio daquela empresa.

---

## 8. Checklist final de validação

| Item | Critério |
|---|---|
| Manifesto | JSON válido, `schema: 1`, `slug` = nome do arquivo, `default: false`, validado por `companies/schema.json` e pelo `company:render` |
| Dados | Somente dados reais do cliente; ausentes = `null`/`[]`; nenhuma cópia da Exemplo |
| Domínio | `domain: null` enquanto não definido; `EVERSHOP_HOME_URL` sem placeholder; se definido, manifesto e env iguais |
| Isolamento | DB/role, porta, `.env`, `media/`, `public/`, admin e backup próprios por empresa |
| Artefatos | `company.ts`, `generated/widgets.json` e `config/generated/company.json` gerados pelo `COMPANY_SLUG` correto; sem edição manual |
| Seeds | catálogo, CMS e 7 widgets carregados no DB da empresa; seeds idempotentes; sem duplicatas |
| Page builder | conteúdo editável no admin; `pb-draft-1` intocado e não publicado |
| SEO | canonical/sitemap/robots coerentes com o domínio real quando ele existir; nada gerado enquanto não existe |
| Saúde | healthcheck previsto: `/` e `/admin` respondem 200 na porta da instalação |
| Baseline | Loja Exemplo com saída visual/textual idêntica |
| Versionamento | Sem `git commit`, `git push` ou publicação provenientes deste fluxo de documentação |

---

## Dependências de outros donos (não editadas aqui)

- `companies/*`, `companies/schema.json`, `scripts/render-company-config.mjs`, `.env.example` e `package.json` — config/manifesto.
- `scripts/company-create.mjs` — CLI de provisão (inclusive a eventual entrada `company:create` no `package.json`).
- `scripts/render-company-sitemap.mjs`, `StructuredData.tsx` e `Base.tsx` — SEO/domínio.
- `scripts/seed-company.mjs` e `schemas/catalog.schema.json` — seeds de catálogo.
- `scripts/seed-homepage-widgets.mjs` e `extensions/loja-exemplo-home/src/bootstrap.js` — page builder.
- `extensions/company-config/**`, `config/default.json`, `config/custom-environment-variables.json` e `scripts/compile-extension.mjs` — extensão de configuração.
- `scripts/check-company-leaks.mjs`, CI, checklist, segurança e LGPD — donos próprios conforme `docs/AGENT_CONTRACT.md`.

## Riscos registrados neste onboarding

- **Domínios futuros não definidos:** qualquer preenchimento antecipado de `domain`/`EVERSHOP_HOME_URL` criaria canonical e sitemap errados; a regra é manter `null` e pular o sitemap.
- **`null` × `requiredForRender`:** o schema aceita `null`, mas o renderer exige vários campos não vazios. Empresas com dados incompletos ficam bloqueadas no `company:render` até o cliente fornecer o conteúdo real.
- **Scripts pendentes de outros donos:** na leitura desta Fase 0, `scripts/seed-company.mjs`, `scripts/check-company-leaks.mjs` e a entrada `company:create` em `package.json` não estavam presentes; `schemas/catalog.schema.json` existe. Sem essas peças, a provisão automatizada e a auditoria de vazamento ficam incompletas.
- **Tema fixo:** o `bootstrap.js` aponta para `themes/loja-exemplo/dist/components`, limitando a troca de tema por empresa.
- **Divergência documental:** `README.md` lista seis widgets, enquanto `extensions/loja-exemplo-home/widgets.json`, o gerador e o contrato descrevem sete. O README não foi alterado.
- **Custo operacional:** N instalações significam N processos, N DBs, N deploys e N backups; drift entre instalações exige disciplina de versionar só o template comum.
- **Validação não executada:** este documento não validou build, migration, seed, SEO publicado, page builder, healthcheck nem a renderização da Exemplo; apenas descreve o fluxo aprovado e não reporta publicação pronta.
