# Nomenclatura e repositório — convenções white-label (Fase 0)

## 1. Escopo

Este documento registra **convenções de nomenclatura e de organização de repositório** para o modelo aprovado em `docs/ARQUITETURA_MULTI_INSTALACAO.md`:

> **uma empresa = um domínio + um banco PostgreSQL + um processo + um `.env`**, com um **template Git compartilhado**.

Ele é apenas documentação. Não altera código, tema, extensão, config, seed, tradução, artefato gerado, domínio publicado nem a saída renderizada da Loja Exemplo. A autoridade da Fase 0 é `docs/AGENT_CONTRACT.md`; em caso de conflito, ele prevalece.

Fonte dos exemplos reais usados aqui: `docs/AGENT_CONTRACT.md`, `companies/loja-exemplo.json`, `companies/schema.json`, `.env.example`, `config/default.json`, `config/custom-environment-variables.json`, `scripts/render-company-config.mjs`, `scripts/render-company-sitemap.mjs`, `scripts/company-create.mjs`, `translations/pt/zz-loja-exemplo.csv`, `.github/workflows/template-ci.yml` e `docs/MAPEAMENTO_DADOS.md`.

---

## 2. Matriz de nomes

| Item | Convenção | Valor real de referência | Onde é usado |
| --- | --- | --- | --- |
| Slug da empresa | `kebab-case`: minúsculas, `a-z0-9`, hífens simples | `loja-exemplo` | `companies/<slug>.json`, campo `slug`, `COMPANY_SLUG`, `companies/<slug>/`, DB/role, CSV `zz-<slug>.csv` |
| Manifesto | `companies/<slug>.json` | `companies/loja-exemplo.json` | Fonte de dados da empresa; validado por `companies/schema.json` |
| Domínio | URL absoluta `http(s)`, sem `/` final, sem `/pt-br` | `https://lojaexemplo.com.br` | `domain` do manifesto, `EVERSHOP_HOME_URL`, `HOME_URL`, canonical, sitemap, `robots.txt` |
| Tema | Mesmo padrão kebab-case; **deve bater com o diretório** | `loja-exemplo` | `theme` do manifesto, `system.theme`, `themes/<theme>/`, `THEME` |
| Extensão | Mesmo padrão kebab-case; **deve bater com o diretório** | `loja-exemplo-home` | `extension` do manifesto, `system.extensions[].name/resolve`, `extensions/<extension>/` |
| Tradução específica | `translations/pt/zz-<slug>.csv` | Convenção futura: `zz-loja-exemplo.csv`; legado atual: `zz-loja-exemplo.csv` | Camada final do dicionário pt-BR; carregada por último pela ordem dos arquivos |
| Banco | Derivado do slug pelo provisionador | Legado: `loja-exemplo`; novos: `db_<slug>_<hash6>` | `DB_NAME`, `CREATE DATABASE` |
| Role PostgreSQL | Derivado do slug pelo provisionador | Novos: `role_<slug>_<hash6>` | `DB_USER`, `CREATE ROLE`, owner do DB |
| Diretório da instalação | `companies/<slug>/` dentro do template | `companies/loja-exemplo/` seria reservado; novo exemplo da CLI: `companies/empresa2/` | Cópia isolada do template, com `.env`, `provision.json`, `public/`, `media/`, `.evershop/`, logs |
| Porta do processo | Inteiro livre `1024-65535`, por instalação | Legado: `3001`; exemplo da CLI: `3002` | `PORT`, `--port`, healthcheck, PID/logs próprios |

---

## 3. Slug de empresa

### 3.1 Formato

Use sempre:

```txt
^[a-z0-9]+(?:-[a-z0-9]+)*$
```

Regras:

- somente minúsculas, dígitos e hífens;
- sem acentos, cedilha, espaços, underscore, ponto ou barras;
- sem hífen no início ou no fim;
- sem hífens repetidos;
- até **40 caracteres** na CLI de provisão (`scripts/company-create.mjs`);
- estável e imutável depois do provisionamento: ele participa de caminhos, variáveis, identificadores PostgreSQL e namespace dos UUIDs dos widgets.

Exemplo válido: `loja-exemplo` (sem acento em `loja-exemplo`).  
Exemplos inválidos: `Loja-Exemplo`, `loja_exemplo`, `empresa--2`, `-empresa`.

### 3.2 Slugs reservados

Não usar para nova empresa:

- `_template` — reservado ao template vazio `companies/_template.json`;
- `schema` — reservado a `companies/schema.json`;
- `.rollback` — área de rollback da CLI;
- `loja-exemplo` — baseline protegido, já existente e com `"default": true`.

`companies/schema.json` aceita `_template` no pattern; a CLI rejeita explicitamente os quatro nomes acima. Isso é intencional: o template é arquivo de documento, não empresa instalada.

### 3.3 Relação com o manifesto

O nome do arquivo, o campo `slug` e a variável `COMPANY_SLUG` devem ser o mesmo valor:

```txt
companies/loja-exemplo.json
  "slug": "loja-exemplo"
COMPANY_SLUG=loja-exemplo
```

O gerador `scripts/render-company-config.mjs` usa `process.env.COMPANY_SLUG || 'loja-exemplo'` e valida o formato antes de ler `companies/<slug>.json`. Não aponte `COMPANY_SLUG` para `_template`.

---

## 4. Tema e extensão

Embora `companies/schema.json` não imponha regex para `theme` e `extension`, adota-se o mesmo padrão kebab-case do slug para ambos.

### 4.1 Tema

- O identificador do tema é o **nome do diretório** em `themes/<theme>/`.
- A fonte é `theme` no manifesto ativo; `config/default.json` mantém `system.theme: "loja-exemplo"` como padrão do template.
- `config/custom-environment-variables.json` mapeia `system.theme ← THEME`. Se `THEME` for definido no `.env` da instalação, ele deve ter **exatamente** o mesmo valor de `theme` no manifesto.
- Um novo manifesto pode reutilizar o tema compartilhado (`loja-exemplo`) ou apontar para outro tema já versionado no template. Não crie cópias por empresa renomeando a pasta do tema.
- Artefatos como `themes/loja-exemplo/src/components/frontStore/generated/company.ts` são gerados por `company:render`; nunca editá-los manualmente.

### 4.2 Extensão

- O identificador da extensão é o **nome do diretório** em `extensions/<extension>/` e o `name` declarado em `system.extensions` de `config/default.json`.
- Valor real: `loja-exemplo-home`, com `resolve: "extensions/loja-exemplo-home"`.
- O caminho gerado `extensions/loja-exemplo-home/generated/widgets.json` acompanha o valor de `extension` do manifesto.
- Tipos de widget são identificadores estáveis e **não** entram na convenção `zz-<slug>`: `hc_menu`, `hc_hero`, `hc_departments`, `hc_featured_products`, `hc_differentials`, `hc_cta`, `hc_location`.
- Conteúdo editado no page builder pertence ao DB da instalação; o template versiona apenas tipos, schemas, componentes e defaults gerados.

---

## 5. Traduções pt-BR: `zz-<slug>.csv`

### 5.1 Convenção para novas instalações

- Diretório: `translations/pt/`.
- Arquivo específico da empresa: `translations/pt/zz-<slug>.csv`, usando o mesmo slug do manifesto.
- Formato: duas colunas por linha, `texto em inglês,texto em pt-BR`, **sem cabeçalho**, igual aos CSVs atuais.
- Exemplo: para `slug = empresa2`, o arquivo seria `translations/pt/zz-empresa2.csv`.
- Os CSVs genéricos (`account.csv`, `admin.csv`, `catalog.csv`, …, `webhook.csv`) permanecem compartilhados e não devem ser duplicados por empresa.
- Só inclua no CSV da empresa traduções reais e conhecidas. Dado ausente não vira tradução inventada.

### 5.2 Por que o prefixo `zz-`

O core do EverShop 2.4.0 lê todos os `*.csv` de `translations/<locale>/`, ordena os nomes e mescla com `Object.assign`; **o último arquivo vence** em chave duplicada (`node_modules/@evershop/evershop/src/lib/locale/dictionary.ts:55-75`). O prefixo `zz-` coloca a camada da empresa depois de `account`, `admin`, `blog`, `catalog`, `checkout`, `contact`, `email`, `general`, `import`, `paypal`, `store` e `webhook`.

### 5.3 Situação da baseline na Fase 0

O arquivo real hoje é `translations/pt/zz-loja-exemplo.csv`, com 21 traduções genéricas e nenhum dado da empresa. `docs/MAPEAMENTO_DADOS.md:172` registra a intenção de renomeá-lo para `zz-<slug>.csv`, mas **a renomeação não deve ser feita nesta Fase 0**:

- `scripts/patch-verify.mjs:118` verifica explicitamente `translations/pt/zz-loja-exemplo.csv`; renomear quebraria a verificação;
- a regra 6 do contrato exige saída renderizada idêntica;
- se `zz-loja-exemplo.csv` e `zz-loja-exemplo.csv` coexistirem, a ordem lexicográfica coloca `zz-loja-exemplo.csv` **antes** de `zz-loja-exemplo.csv` (`-` vem antes de `.`), então o arquivo legado sobrescreveria as chaves do novo — o oposto do esperado.

Qualquer migração desse arquivo depende do dono de `scripts/patch-verify.mjs` (`docs/AGENT_CONTRACT.md`, tema patches pt-BR) e de rodar a verificação/regressão correspondente.

---

## 6. Variáveis de ambiente

`.env.example` é versionado no template; `.env` é **por instalação e não versionado**. Nenhuma senha vai para o manifesto público.

| Variável | Finalidade | Regra de nomenclatura/valor |
| --- | --- | --- |
| `COMPANY_SLUG` | Seleciona `companies/<slug>.json` | Igual ao slug e ao nome do arquivo; default `loja-exemplo` |
| `EVERSHOP_HOME_URL` | URL canônica pública usada pelo core | Deve ser igual a `domain` do manifesto; nunca `localhost` em produção |
| `HOME_URL` | Mapeia `shop.homeUrl` em `config/custom-environment-variables.json` | Se definido, deve ter o **mesmo** valor de `EVERSHOP_HOME_URL`; `.env.example` da baseline não o define para evitar divergência |
| `THEME` | Mapeia `system.theme` | Igual a `theme` no manifesto; na baseline, `loja-exemplo` |
| `COMPANY_DOMAIN` | Domínio passado pelo provisionador à etapa de sitemap | Opcional; ausente quando `--domain` não é informado |
| `DB_HOST`, `DB_PORT` | Conexão PostgreSQL da loja | Próprios da instalação |
| `DB_NAME` | Database da empresa | Legado `loja-exemplo`; novos bancos derivados do slug |
| `DB_USER` | Role da empresa | Novos papéis derivados do slug |
| `DB_PASSWORD` | Senha da role | Gerada na provisão; somente no `.env` local; nunca no manifesto |
| `DB_SSLMODE` | Modo SSL do driver | `disable` no exemplo local/CI |
| `PORT` | Porta do processo EverShop | Uma por instalação; baseline `3001` |
| `ADMIN_FULLNAME` | Nome do primeiro administrador | Injetado no `setup`; não é dado público |
| `ADMIN_EMAIL` | E-mail administrativo | Injetado no `setup`; **não** é `publicEmail` |
| `ADMIN_PASSWORD` | Senha do primeiro administrador | Somente no ambiente do subprocesso de `setup`; não persistida no `.env` gerado |
| `COMPANY_ADMIN_PASSWORD` | Nome da variável que contém a senha na CLI de provisão | Padrão de `--admin-password`; a CLI aceita o **nome** da env ou `--admin-password-file`, nunca a senha em claro |
| `PGADMIN_HOST`, `PGADMIN_PORT`, `PGADMIN_USER`, `PGADMIN_PASSWORD`, `PGADMIN_DATABASE` | Conexão administrativa usada apenas para criar role/DB | Alternativa a `DB_*`/`POSTGRES_*` na CLI; credenciais de admin da infra, não da loja |

Regras adicionais:

- `scripts/render-company-sitemap.mjs` define `EVERSHOP_HOME_URL` e `HOME_URL` a partir de `domain` do manifesto antes de carregar o core; manifesto e ambiente não podem divergir.
- `scripts/company-create.mjs` grava `DB_*`, `PORT`, `HOME_URL`, `EVERSHOP_HOME_URL`, `COMPANY_SLUG`, `COMPANY_DOMAIN` e `THEME` no `.env` da instalação, mas **não grava `ADMIN_*`**.
- Nomes de variáveis são contrato entre scripts, config e CI: não renomeá-las na Fase 0.

---

## 7. Banco, role e isolamento

- Modelo B/C híbrido: **um database PostgreSQL por empresa**, sem `store_id`/`tenant_id`/`website_id`.
- Cada role é `LOGIN` e `OWNER` do database correspondente; a aplicação conecta com `DB_USER`/`DB_PASSWORD` dessa role.
- Para novos bancos, `scripts/company-create.mjs` usa:

```txt
db_<slug>_<hash6>
role_<slug>_<hash6>
```

O sufixo vem de `pgIdentifier()`: minúsculas, sequências de não-`a-z0-9` viram `_`, corte em 50 caracteres no stem e hash SHA-1 de 6 hex digits do valor bruto, com limite final de 63 caracteres do PostgreSQL. O nome exato é impresso pela CLI, inclusive em `--dry-run`; não inventar nomes manuais.

- O database legado da baseline continua `loja-exemplo` (`.env.example:4`, CI), com role `loja-exemplo`. Não renomear na Fase 0.
- Nunca apontar duas empresas para o mesmo `DB_NAME`.
- A conexão administrativa (`PGADMIN_*`) serve apenas para provisionar/validar; não é credencial usada pela loja.
- Backup, restore, migration, smoke test e rollback são por empresa. A CLI remove DB/role criados por uma execução falha apenas quando seguros; se houver dados, mantém o DB e exige decisão explícita (`--confirm-drop-db`).

---

## 8. Diretórios de instalação

### 8.1 Template compartilhado (versionado no Git)

```txt
<raiz do template>/
  companies/
    _template.json
    schema.json
    loja-exemplo.json
    <slug>.json
  scripts/
  themes/loja-exemplo/
  extensions/loja-exemplo-home/
  extensions/company-config/
  config/
    default.json
    custom-environment-variables.json
    generated/company.json        # gerado; não editar à mão
  translations/pt/
  docs/
  .github/workflows/template-ci.yml
  .env.example
```

### 8.2 Instalação por empresa (fora do versionamento efetivo)

`scripts/company-create.mjs` cria uma cópia isolada em:

```txt
companies/<slug>/
  .env                            # segredos locais daquela loja
  provision.json                  # estado da provisão (modo 0600)
  companies/<slug>.json           # cópia do manifesto ativo da instalação
  public/                         # sitemap.xml, robots.txt e estáticos daquela loja
  media/                          # uploads daquela empresa
  .evershop/                      # cache/build local
  logs/server.log
  server.pid
  node_modules                    # junction/symlink para a base, salvo --install-deps
```

Cada instalação tem ainda seu próprio domínio/DNS/SSL, database, role, porta/processo e backup. A cópia exclui `node_modules`, `.git`, `.evershop`, `media`, `logs`, `.rollback`, `public/sitemap*.xml`, `dist/` de tema/extensão e o próprio diretório de instalação de origem.

`node_modules` compartilhado por junction/symlink é o modo padrão: os patches do `postinstall` ficam centralizados no template. `--install-deps` cria um `npm ci` independente na cópia.

---

## 9. Regras do template Git compartilhado

1. **Um template, N instalações.** Customização por empresa entra por manifesto, `tokens` CSS e conteúdo do DB; não por fork do core nem por renomear pastas do template.
2. A baseline `loja-exemplo` é o caso de validação: CI usa `COMPANY_SLUG=loja-exemplo`, `DB_NAME=loja-exemplo`, `PORT=3001` e `EVERSHOP_HOME_URL=http://localhost:3001` somente para teste.
3. Versionar: manifestos e schema, scripts, tema, extensões, traduções, config, docs, CI e `.env.example`.
4. **Não versionar:** `.env`, senhas, `provision.json`, `node_modules/`, `dist/`, `.evershop/`, `media/`, `logs/`, `server.pid`, `public/sitemap*.xml`, `public/robots.txt` gerado e `pb-draft-1`.
5. `scripts/render-company-sitemap.mjs` gera XML localmente e registra explicitamente: não executar `git add`/`commit` nesses artefatos.
6. Artefatos determinísticos de `company:render` podem aparecer no template para auditoria, mas a fonte da verdade é o manifesto: nunca editá-los manualmente e sempre revisar o diff gerado.
7. Nenhuma loja deve publicar `localhost`, domínio de outra empresa ou texto de exemplo como domínio canônico.
8. Nesta Fase 0, agentes não fazem `commit`, `push`, `checkout`, `clean` nem `reset`; alterações ficam na árvore de trabalho para revisão do dono da sessão.

---

## 10. O que NÃO renomear na Fase 0

Itens que fazem parte da compatibilidade da baseline e devem manter seus nomes exatos:

- slug `loja-exemplo`, arquivo `companies/loja-exemplo.json` e `"default": true`;
- diretório `themes/loja-exemplo`, valor `theme: "loja-exemplo"` e fallback em `config/default.json`;
- diretório `extensions/loja-exemplo-home`, valor `extension: "loja-exemplo-home"` e `resolve: "extensions/loja-exemplo-home"`;
- tipos de widget `hc_menu`, `hc_hero`, `hc_departments`, `hc_featured_products`, `hc_differentials`, `hc_cta`, `hc_location`;
- UUIDs fixos de instâncias/placements usados quando `COMPANY_SLUG === 'loja-exemplo'`;
- `translations/pt/zz-loja-exemplo.csv` (ver §5.3);
- nome do pacote `evershop-seu-ecommerce-facil` em `package.json`;
- slugs CMS `empresa`, `contato`, `departamentos` e rotas ativas (`/`, `/products`, `/blog`, `/admin`, `/departamentos`, `/empresa`, `/contato`);
- diretório de idioma `pt` e os nomes dos CSVs genéricos;
- variáveis de ambiente e os mapeamentos `HOME_URL`, `THEME`, `EVERSHOP_HOME_URL`, `COMPANY_SLUG`, `DB_*`, `ADMIN_*`, `COMPANY_ADMIN_PASSWORD`;
- database/role legados `loja-exemplo` e a porta `3001` da baseline;
- nomes de arquivos `public/sitemap*.xml` e o diretório `public/` da instalação;
- API compatível de `site.ts`: `SITE`, `NAV`, `quoteHref(productName?)` e `waLink({ ... })`;
- arquivos e diretórios gerados/gerenciados pelo core: `node_modules/`, `dist/`, `.evershop/`, `media/`;
- `pb-draft-1` e o changeset 2 do page builder;
- bloco `AGENT_CONTRACT` em `AGENTS.md`, reescrito pelo `next dev`;
- dados ausentes que devem permanecer `null` (`publicEmail`, `placeId`, `rating.sourceUrl`, `seo.robotsTxt`), bem como nomes inventados de CNPJ, razão social ou coordenadas.

Renomear qualquer item dessa lista exigiria sair da Fase 0, coordenar o dono do arquivo e provar que a saída renderizada permanece idêntica.

---

## 11. Dependências de outros donos

Este documento não edita os arquivos abaixo; apenas registra a convenção que eles precisam respeitar:

- `companies/*`, `.env.example`, `package.json`, `scripts/render-company-config.mjs` e `config/generated/company.json` — config/manifesto;
- `scripts/patch-verify.mjs` e `scripts/patch-ptbr-core.mjs` — patches pt-BR, inclusive a decisão futura sobre `zz-<slug>.csv`;
- `extensions/loja-exemplo-home/src/bootstrap.js` e `scripts/seed-homepage-widgets.mjs` — page builder e UUIDs;
- `scripts/company-create.mjs` — derivação de DB/role, `.env` e diretório `companies/<slug>/`;
- `config/default.json`, `config/custom-environment-variables.json` e `extensions/company-config/**` — `THEME`, `HOME_URL` e extensões;
- `scripts/render-company-sitemap.mjs`, `StructuredData.tsx` e `Base.tsx` — domínio canônico e sitemap;
- `.github/workflows/template-ci.yml` — validação da baseline.

---

## 12. Riscos registrados

- A convenção `zz-<slug>.csv` ainda não está aplicada: o arquivo legado `zz-loja-exemplo.csv` continua sendo o verificado por `scripts/patch-verify.mjs`.
- Criar `zz-loja-exemplo.csv` sem coordenar a remoção/renomeação do legado não produz a precedência esperada por causa da ordem lexicográfica das chaves `zz-`.
- `extensions/loja-exemplo-home/src/bootstrap.js` resolve o tema por caminho fixo; a troca de tema por manifesto não é totalmente genérica até o dono do arquivo ajustar.
- `.env.example` e `scripts/company-create.mjs` tratam `HOME_URL` de formas diferentes (ausente no exemplo, escrito junto com `EVERSHOP_HOME_URL` na provisão); divergência de valores gera risco de canonical/sitemap errado.
- `package.json` observado não continha o script `company:create`, embora `scripts/company-create.mjs` exista e o contrato/preflight o referencie; depende do dono de config/manifesto.
- Nenhum deploy, build, migração, seed, teste de HTTP ou verificação de patches foi executado para produzir este documento.
