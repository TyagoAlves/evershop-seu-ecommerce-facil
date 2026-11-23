# Segurança e isolamento — modelo multi-instalação (Fase 0)

## Status e escopo

Este documento registra **práticas de segurança e isolamento** para a decisão aprovada em
`docs/ARQUITETURA_MULTI_INSTALACAO.md`: **uma empresa = uma instalação EverShop 2.4.0 + um
banco PostgreSQL + um domínio**, com template compartilhado versionado. Não altera código,
tema, textos, visual, dados nem a saída renderizada da Loja Exemplo. Não valida
deploy, build, migração, SEO publicado nem conteúdo do page builder.

Base de leitura (somente consulta): `docs/AGENT_CONTRACT.md`,
`docs/ARQUITETURA_MULTI_INSTALACAO.md`, `.env.example`, `.gitignore`, `package.json`,
`config/custom-environment-variables.json`, `README.md`, `scripts/company-create.mjs`,
`scripts/patch-ptbr-core.mjs`, `scripts/patch-build-env.mjs` e
`docs/PATCH_SPECS_AGENTS_2.md`.

Regra de ouro: **o manifesto `companies/<slug>.json` é público e versionado; tudo que
autoriza acesso (senha, token, chave, credencial de banco) pertence ao ambiente da
instalação ou a um cofre, nunca ao repositório.**

---

## 1. Isolamento por instalação

| Recurso | Prática obrigatória | Evidência / observação |
|---|---|---|
| Banco | Um database por empresa, exclusivo. Nenhuma loja aponta para o DB de outra. O provisionador deriva `db_<slug>` (`scripts/company-create.mjs:640`); a instalação atual usa `DB_NAME=loja-exemplo` (`.env.example:4`). | `docs/ARQUITETURA_MULTI_INSTALACAO.md:13,82` |
| Role do banco | Uma role PostgreSQL por empresa (`role_<slug>`, `scripts/company-create.mjs:641`), `LOGIN`, owner apenas do seu DB. Sem `SUPERUSER`, `CREATEDB`, `CREATEROLE` e sem `GRANT` em outros databases. A credencial administrativa usada pelo provisionador (`PGADMIN_PASSWORD` / `POSTGRES_PASSWORD`, `scripts/company-create.mjs:230`) fica só no ambiente de provisionamento, nunca no `.env` da loja. | `scripts/company-create.mjs:383-408` |
| TLS do banco | Em produção, exigir conexão criptografada (`DB_SSLMODE=require` ou `verify-full`). O exemplo local e o provisionador usam `disable` (`.env.example:7`; `scripts/company-create.mjs:440,694`) — adequado para localhost, **não** para produção. | Ajuste depende do dono da CLI de provisão; não foi editado aqui. |
| `.env` | Um arquivo por instalação, com `DB_*`, `PORT`, `HOME_URL`/`EVERSHOP_HOME_URL`, `COMPANY_SLUG` e, apenas no setup, `ADMIN_*`. Nunca versionar, nunca compartilhar entre empresas, nunca anexar em ticket/log. `.gitignore:3-5` ignora `.env` e `.env.*`, com exceção de `.env.example`. | `.env.example:1-21`; `docs/ARQUITETURA_MULTI_INSTALACAO.md:133-143` |
| Porta | Uma porta/processo por instalação (`PORT=3001` na atual, `.env.example:8`). Conferir conflito antes de provisionar; expor somente o porta/domínio pretendido via reverse proxy/firewall. Não publicar `/admin` sem autenticação e restrição de rede. | `scripts/company-create.mjs:441,695`; `README.md:25-26` |
| Domínio e SEO | `COMPANY_SLUG`, `domain` do manifesto e `HOME_URL`/`EVERSHOP_HOME_URL` devem apontar para a **mesma** empresa. O provisionador escreve ambos (`scripts/company-create.mjs:432-443`); `config/custom-environment-variables.json:3` mapeia `homeUrl ← HOME_URL`. Canonical, `hreflang`, sitemap e `robots.txt` são gerados no contexto daquela instalação. | `docs/ARQUITETURA_MULTI_INSTALACAO.md:56-62` |
| Arquivos locais | `public/` (sitemap), `media/`, `.evershop/` e `pb-draft-1` são por instalação. Nunca copiar `sitemap*.xml`, uploads ou rascunho de uma empresa para outra. | `docs/ARQUITETURA_MULTI_INSTALACAO.md:45,133-143`; `docs/AGENT_CONTRACT.md:6,7` |
| Backup/restore | Backup, restore, smoke test e rollback executados **por loja**. Restaurar o backup da empresa A nunca deve sobrescrever o DB, o `.env`, o `media/` ou o `public/` da empresa B. | `docs/ARQUITETURA_MULTI_INSTALACAO.md:76,85` |

Verificação rápida antes de subir uma instalação: `COMPANY_SLUG` correto → manifesto ativo
regerado → `.env` exclusivo → `DB_NAME`/role exclusivos → porta livre → domínio canônico
coerente → sitemap/robots do domínio → nenhum dado da empresa anterior nos artefatos gerados.

---

## 2. Segredos fora do manifesto e fora do Git

**Nunca colocar em `companies/<slug>.json`, `companies/_template.json` nem em qualquer
arquivo versionado:** `DB_PASSWORD`, `ADMIN_PASSWORD`, `PGADMIN_PASSWORD` /
`POSTGRES_PASSWORD`, tokens de API, chaves de integração, connection strings internas, IP
privado ou caminho de cofre já resolvido. O manifesto contém apenas dados públicos e
operacionais não sensíveis (slug, domínio, telefone, endereço, marca, SEO etc.).

Práticas:

1. **Cofre como origem.** Injete segredos no ambiente do processo no momento do deploy/setup.
   O provisionador já oferece esse padrão para a senha de admin:
   `--admin-password=NOME_DA_VARIAVEL` (padrão `COMPANY_ADMIN_PASSWORD`) ou
   `--admin-password-file=/caminho/secret`; a senha **não** vai na linha de comando
   (`scripts/company-create.mjs:184-199`). Quando `--admin-password-file` é usado, o
   `provision.json` registra apenas a origem (`file:<caminho>`), nunca o valor
   (`scripts/company-create.mjs:673-675`).
2. **Senha do DB.** É gerada aleatoriamente no provisionamento
   (`scripts/company-create.mjs:642`) e gravada no `.env` da instalação
   (`scripts/company-create.mjs:439`). Trate esse `.env` como segredo: permissão restrita
   em NTFS (o `mode: 0o600` de `scripts/company-create.mjs:448` não é garantia no Windows),
   backup criptografado e acesso apenas ao operador da loja.
3. **Placeholders não são segredos.** `.env.example:6,13` usa `troque-esta-senha-local`;
   `.env.example` é a única exceção permitida do padrão `.env.*` (`.gitignore:5`). Não
   substituir o placeholder por valor real em nenhum arquivo versionado.
4. **Não reaproveitar** a senha do banco como senha de admin, nem a mesma senha entre
   empresas.
5. **Rotação e resposta a incidente.** Se um segredo aparecer em log, commit, artifact de CI,
   screenshot ou ticket: revogar/rotacionar imediatamente, limpar o histórico onde for
   possível e registrar o incidente. Não basta apagar o arquivo — considere o valor exposto.
6. **Validação.** Usar `scripts/check-company-leaks.mjs --slug <slug> [--html <url>]` para
   detectar dados de outra empresa (dono: auditoria de vazamento) e secret scanning no CI
   (dono: CI). Nenhum dos dois foi editado ou executado por este agente.

> Atenção de inventário: diretórios de instalação criados pelo provisionador podem conter
> `provision.json`, `logs/`, `server.pid` e `media/`, que não aparecem explicitamente na
> lista atual de `.gitignore`. Mesmo sem segredos no `provision.json`, arquivos de
> instalação não devem ser adicionados ao Git de propósito. Ajuste de `.gitignore` depende
> dos donos de config/manifesto e CI.

---

## 3. Senha de admin via ambiente/cofre

- `ADMIN_PASSWORD` é usado **apenas na criação do primeiro administrador**
  (`npm run setup` → `scripts/install-headless.mjs`; `README.md:36`; `.env.example:10-13`).
  O provisionador não persiste `ADMIN_*` no `.env` da loja e injeta o valor somente no
  ambiente do processo filho (`scripts/company-create.mjs:449,686-702`).
- Em produção, **não manter** `ADMIN_PASSWORD` fixo no `.env`: injetá-lo do cofre somente
  durante o setup. Após criar a conta, trocar a senha no admin e remover a variável
  temporária do ambiente, conforme a política de rotação.
- Uma conta de admin (e um e-mail `ADMIN_EMAIL`) por empresa. Nunca usar a conta da
  Loja Exemplo para administrar outra loja.
- O provisionador exige no mínimo 8 caracteres (`scripts/company-create.mjs:198`); adotar
  política mais forte (senha longa e gerada, idealmente 24+ caracteres) e, se a versão do
  EverShop oferecer, MFA para contas de admin.
- Revisar periodicamente `admin_user`: remover contas de setup/temporárias, confirmar que
  cada e-mail pertence à empresa correta e que não há usuário herdado de outra instalação.
- Não imprimir a senha em logs de setup, `--dry-run`, `provision.json` ou mensagens de
  erro. O comando correto informa a **origem** da senha, não seu valor.

---

## 4. Patches idempotentes no `postinstall` compartilhado

- `package.json:7` aplica sete patches no `postinstall`; `README.md:28-30` e
  `docs/AGENT_CONTRACT.md:3,7` proíbem editar `node_modules/` manualmente. A versão do core
  fica fixada em `@evershop/evershop@2.4.0` com `package-lock.json` (`package.json:26`).
- Todo patch deve morar em `scripts/patch-*.mjs` e ser **idempotente**: detectar que já foi
  aplicado e não duplicar alteração. Exemplos: `scripts/patch-ptbr-core.mjs:62-81` registra
  "já aplicado", e `scripts/patch-build-env.mjs:22-30` só reordena o import quando necessário.
- Como o template é compartilhado, alterar um patch afeta **todas** as instalações no
  próximo `npm install`/`npm ci`. Propagar uma versão de cada vez, com backup do DB e smoke
  test por loja; não atualizar todas ao mesmo tempo.
- `scripts/patch-verify.mjs` está previsto no contrato mas ausente em `scripts/` no momento
  da leitura (`docs/ARQUITETURA_MULTI_INSTALACAO.md:191`): é dependência do dono de patches
  pt-BR. Até existir, a conferência é manual (log "já aplicado" + diff do core patchado).
- **Risco concreto de vazamento por patch:** `scripts/patch-ptbr-core.mjs:24-29` lê
  `config/generated/company.json` e, se o arquivo não existir ou não trouxer
  `seo.patchDescriptions`, usa textos fixos da Loja Exemplo como fallback
  (blog, listing, cart). Como o `postinstall` roda na instalação e a geração de artefatos
  (`company:render`) faz parte de `build` (`package.json:11`), é possível o patch injetar
  textos da Exemplo no core compartilhado antes de o manifesto ativo ser gerado — ou reaproveitar
  um `config/generated/company.json` desatualizado de outra empresa. Recomendação (sem editar
  código): garantir a geração do `company.json` antes do patch ou tornar o fallback neutro/
  fail-closed, e conferir o resultado com a auditoria de vazamento.
- Artefatos gerados (`themes/.../generated/company.ts`,
  `extensions/loja-exemplo-home/generated/widgets.json`, `config/generated/company.json`)
  não devem ser editados à mão; devem ser regerados com o `COMPANY_SLUG` correto
  (`docs/AGENT_CONTRACT.md:82-88`; `docs/ARQUITETURA_MULTI_INSTALACAO.md:78`).

---

## 5. Risco de `junction` do `node_modules` no Windows

O provisionador, quando não recebe `--install-deps`, cria no Windows um **junction** de
`companies/<slug>/node_modules` para o `node_modules` da base; em outros sistemas, um
symlink de diretório (`scripts/company-create.mjs:453-462`). A intenção é compartilhar os
patches. Isso tem implicações diretas de segurança e isolamento:

1. **Não é isolamento de código.** Todas as lojas ligadas ao mesmo alvo enxergam exatamente
   a mesma árvore de dependências. Um `npm install`/`npm ci` ou um `postinstall` rodado para
   uma loja reescreve arquivos usados pelas outras. Se duas instalações forem atualizadas ao
   mesmo tempo, o core patchado pode ficar em estado intermediário.
2. **Deployment coordenado.** Antes de atualizar a base compartilhada, pare os processos das
   lojas que apontam para ela, aplique os patches em uma janela controlada e valide uma loja
   de cada vez. Registre explicitamente qual instalação aponta para qual alvo de `node_modules`.
3. **Impossibilidade de divergência controlada.** Se uma empresa precisar de versão ou patch
   diferente, a junction atrapalha. Nesse caso usar `npm ci` próprio na cópia
   (`--install-deps`, `scripts/company-create.mjs:53,454-457`), aceitando o custo de disco e
   de aplicar os patches por instalação.
4. **Cópia, backup e restore.** Reparse points podem ser tratados de forma diferente por
   ferramentas de cópia/backup/zip: alguns seguem o alvo, outros copiam apenas o link. Após
   mover ou restaurar a base, confirmar que a junction não ficou quebrada e que aponta para a
   versão pretendida. O Git ignora `node_modules` (`.gitignore:1`), então o conteúdo real não
   viaja no repositório — apenas o estado da base local.
5. **Ambiente local do Windows.** Caminhos longos, sincronização automática de pastas como
   `Downloads`, antivírus e políticas de criação de links podem tornar o alvo instável.
   Preferir base em caminho curto, estável e controlado; tratar falha na criação do link como
   bloqueio de provisionamento, não como aviso a ignorar.
6. **Permissões.** Restringir escrita no `node_modules` da base a quem aplica patches. Qualquer
   usuário com escrita nesse diretório pode alterar o código executado por todas as lojas
   ligadas à junction — equivalente a um deploy não autorizado em várias empresas ao mesmo tempo.

---

## 6. Permissões do page builder

- Cada instalação tem seu DB, logo widgets, posições (`widget_placement`), rascunhos e
  mídia ficam isolados por empresa (`docs/ARQUITETURA_MULTI_INSTALACAO.md:26,66-68`). Isso
  **só vale** se nenhum DB for compartilhado: `widget_placement` não tem coluna
  `store_id`/`site_id` (`docs/ARQUITETURA_MULTI_INSTALACAO.md:44`), e `url_rewrite` e
  `metafield_shop` também são globais na instalação (`:42-43`).
- Limitar o acesso a `/admin/page-builder/edit/homepage` (`README.md:51`) a editores
  designados daquela empresa, com conta individual e senha do cofre. Não compartilhar conta
  de admin entre empresas nem emprestar a conta da Exemplo para "ajustar" outra loja.
- Usar o menor privilégio disponível no EverShop: editores devem poder editar conteúdo, não
  instalar extensões, trocar tema, criar usuários, alterar configuração do sistema ou executar
  migrações. Se o core não oferecer granularidade suficiente, compensar com processo de
  revisão e registro de quem publicou cada alteração (dependência do core, não alterado aqui).
- Os defaults `hc_menu`, `hc_hero`, `hc_departments`, `hc_featured_products`,
  `hc_differentials`, `hc_cta` e `hc_location` são **tipos/schemas** versionados no template;
  o conteúdo preenchido fica no DB da loja. Não copiar dump de `widget_instance`/
  `widget_placement` entre empresas sem sanitizar nomes, telefones, WhatsApp, endereço e
  textos.
- `pb-draft-1` e `.evershop/` são estado local, fora do Git
  (`docs/AGENT_CONTRACT.md:6,9`; `docs/ARQUITETURA_MULTI_INSTALACAO.md:69,140`). Rascunho
  revisado antes de publicar; nunca publicar rascunho procedente de outra empresa.
- Uploads em `media/` são por instalação: restringir quem pode escrever, validar tipo e
  tamanho de arquivo e tratar SVG/HTML com cuidado (conteúdo ativo pode executar script).
  Nunca servir mídia de uma loja a partir do diretório de outra.

---

## 7. Proteção contra vazamento entre empresas

Checklist de saída (antes de publicar qualquer loja que não seja a Exemplo):

1. `COMPANY_SLUG` no `.env` aponta para o manifesto correto e os três artefatos gerados
   foram regerados com esse slug.
2. `domain`, `HOME_URL`/`EVERSHOP_HOME_URL`, canonical, sitemap e `robots.txt` pertencem ao
   domínio daquela empresa.
3. `DB_NAME`, role, `.env`, porta, `public/`, `media/`, rascunho e backup são exclusivos.
4. Nenhum dado da Loja Exemplo aparece na saída: nome com/sem acento, WhatsApp
   `00000-00000`, telefone `0000-0000`, `Bairro Exemplo`, `Cidade Exemplo`, CEP `00000-000`, domínio
   `loja.exemplo.com.br`, ID do Facebook, prefixo `XX-`, marca curta `MARCA`.
5. Rodar `scripts/check-company-leaks.mjs --slug <slug> [--html <url>]`; as regras conhecidas
   ignoram `node_modules/`, `dist/`, `.evershop/`, `public/sitemap*.xml`, o manifesto padrão
   e documentação legada (`docs/PATCH_SPECS_AGENTS_2.md:817-843`). A auditoria cobre o
   código/HTML versionado, **não** substitui a conferência de DB, `.env` e mídia.
6. Conferir o log dos patches (`já aplicado`/`aplicado`) e o conteúdo injetado no core,
   especialmente os fallbacks descritos na seção 4.

Se houver suspeita de vazamento: parar o deploy afetado, isolar a instalação, preservar
evidência (sem publicar segredos), corrigir a origem, regerar artefatos, repetir a auditoria,
rotacionar credenciais eventualmente expostas e acionar o dono de LGPD/dados
(`docs/AGENT_CONTRACT.md:118`).

---

## 8. Dependências de outros donos (não editadas)

- `scripts/company-create.mjs` — CLI de provisão: `DB_SSLMODE`, `mode: 0o600`, junction do
  `node_modules`, geração do `.env` e injeção de `ADMIN_*`.
- `scripts/patch-*.mjs` (em especial `patch-ptbr-core.mjs`) e `scripts/patch-verify.mjs` —
  fallbacks pt-BR, idempotência e verificação dos patches.
- `scripts/check-company-leaks.mjs` — auditoria de vazamento e cobertura das regras.
- `companies/*`, `scripts/render-company-config.mjs`, `.env.example` e `.gitignore` —
  manifestos, geração de artefatos, placeholders e arquivos de instalação ignorados.
- `extensions/loja-exemplo-home/src/bootstrap.js` — caminho fixo do tema
  (`docs/ARQUITETURA_MULTI_INSTALACAO.md:70`) pode fazer outra loja carregar o tema errado
  enquanto não for generalizado.
- CI, checklist de publicação e LGPD/dados — secret scanning, validação automatizada e
  comunicação de incidentes.

---

## 9. Riscos registrados nesta Fase 0

- `scripts/patch-ptbr-core.mjs:25-29` usa fallbacks fixos da Loja Exemplo quando
  `config/generated/company.json` não existe ou não traz `seo.patchDescriptions`; combinado
  com a ordem `postinstall` → `build`, há risco de texto da Exemplo entrar no core de outra loja.
- Provisionador grava `DB_SSLMODE="disable"` e `.env` com a senha do DB gravada em texto
  (`scripts/company-create.mjs:439-440,694`); produção precisa de TLS e cofre/ACL reforçada.
- A junction do `node_modules` no Windows compartilha código patchado entre lojas: escrita ou
  reinstall em uma afeta todas; restores e cópias podem deixar links quebrados ou apontando
  para versão errada.
- `provision.json`, `logs/`, `server.pid` e `media/` não aparecem explicitamente em
  `.gitignore`; são dados de instalação que não devem entrar no Git acidentalmente.
- `scripts/patch-verify.mjs` previsto no contrato ainda não estava presente em `scripts/`;
  verificação dos patches depende desse dono.
- O caminho fixo do tema em `extensions/loja-exemplo-home/src/bootstrap.js:8-16` limita a
  troca de tema por empresa e pode causar carregamento do tema incorreto.
- A auditoria de vazamento cobre arquivos/HTML, mas não inspeciona bancos, `.env`, mídia nem
  tokens de acesso ao admin; a conferência desses itens permanece operacional.
- Este documento não executou comandos, não rodou auditoria, não alterou código e não validou
  deploy, build, migração, SEO publicado nem o rascunho `pb-draft-1`.
