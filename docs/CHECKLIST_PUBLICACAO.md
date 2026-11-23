# Checklist de publicação — instalação white-label (EverShop 2.4.0)

- Versão: 1.0 (2026-11-23)
- Dono: sessão `ses_df5c49ca1ffek1uh4y4adtiWZI` (checklist)
- Escopo: publicar **uma** instalação por empresa, com template compartilhado evidenciado em `docs/AGENT_CONTRACT.md` e `docs/ARQUITETURA_MULTI_INSTALACAO.md`.
- Natureza: roteiro de validação. **Nenhuma etapa abaixo foi executada por este agente**; nenhum comando foi rodado, nenhum código foi editado e nada foi publicado.
- Regras não negociáveis: saída renderizada da Loja Exemplo permanece idêntica; dado inexistente fica `null` e a seção é omitida; não editar `node_modules/`, `dist/`, `.evershop/`, `media/` nem `public/sitemap*.xml`; cumprir este checklist **não** substitui a autorização de publicação.

## Convenções

- `<slug>` = identificador da empresa no manifesto (padrão: `loja-exemplo`).
- `<dominio-canonical>` = domínio público da instalação, igual a `companies/<slug>.json` → `domain`.
- `EVERSHOP_HOME_URL` é a **fonte única** do domínio. Não definir `HOME_URL` (`.env.example:18-20`).
- Marcar `[x]` somente com evidência registrada na seção “Registro de execução”.

---

## 1. Pré-requisitos

- [ ] Repositório do template disponível e com Git funcional (`scripts/check-company-leaks.mjs` usa `git ls-files`).
- [ ] Manifesto `companies/<slug>.json` presente, válido contra `companies/schema.json`, com `slug` coerente ao nome do arquivo; default `companies/loja-exemplo.json` com `"default": true`.
- [ ] `.env` **próprio da instalação** com `DB_*`, `DB_NAME`, `PORT`, `COMPANY_SLUG`, `EVERSHOP_HOME_URL` e `ADMIN_*`; senhas de `.env.example` trocadas; `HOME_URL` ausente.
- [ ] Um database PostgreSQL, um processo/container e uma porta por empresa. Nenhum DB compartilhado com outra loja.
- [ ] DNS e TLS do domínio canonical já apontando para esta instalação; redirecionamento HTTP→HTTPS e www→canonical definidos no proxy.
- [ ] Backup recente e **testado para restore**: DB, `.env`, `public/`, `media/` e release anterior do template.
- [ ] `theme` e `extension` do manifesto refletidos em `config/default.json` (`system.theme`, `system.extensions`) e coerentes com `config/custom-environment-variables.json`.
- [ ] Mesma versão do template e os mesmos 7 patches centrais aplicados em todas as instalações; nenhum patch local não versionado.
- [ ] Responsável nomeado para smoke test e rollback; janela de deploy combinada com as demais lojas (subir uma de cada vez).

## 2. Render do manifesto

- [ ] Garantir `COMPANY_SLUG=<slug>` no `.env` da instalação (ou exportado no ambiente do comando).
- [ ] Executar `npm run company:render` (equivalente a `node ./scripts/render-company-config.mjs`).
- [ ] Conferir os três artefatos gerados, **sem editá-los manualmente**:
  - `themes/loja-exemplo/src/components/frontStore/generated/company.ts` (`COMPANY` + `export default`);
  - `extensions/loja-exemplo-home/generated/widgets.json` (7 defaults: `hc_menu`, `hc_hero`, `hc_departments`, `hc_featured_products`, `hc_differentials`, `hc_cta`, `hc_location`);
  - `config/generated/company.json` (cópia do manifesto).
- [ ] Confirmar que `slug`, `domain`, `theme` e `extension` são os do `<slug>` nos três artefatos e que `config/generated/company.json.slug` confere com o `COMPANY_SLUG`.
- [ ] Confirmar que campos `null` conhecidos (`publicEmail`, `placeId`, `rating.sourceUrl`, `seo.robotsTxt`) não viraram string vazia, `example.com` ou placeholder.
- [ ] Para `loja-exemplo`: comparar a saída renderizada com o baseline atual — nenhuma mudança visual ou de texto.

## 3. Patches / verify

- [ ] `postinstall` executado na instalação (`package.json:7`: 7 patches centrais). Nunca editar arquivos dentro de `node_modules/`.
- [ ] Executar `node scripts/patch-verify.mjs` — verificação **somente leitura** dos marcadores; `exit 0` para seguir, `exit 1` = bloqueio.
- [ ] Confirmar que `scripts/patch-ptbr-core.mjs` manteve as strings legadas (ou as do manifesto, quando fornecidas) para blog/listing/cart; nenhuma description alterada nesta fase.
- [ ] Tradução pt-BR presente como `translations/pt/zz-<slug>.csv` quando aplicável, com conteúdo genérico reaproveitado e sem dado da Exemplo vazando.
- [ ] Nenhum patch aplicado “à mão” no servidor fora do template versionado.

## 4. Build

- [ ] Executar `npm run build` — já encadeia `company:render` → `compile-theme` → `compile-extension` → `evershop build`.
- [ ] Confirmar no log que o render usou o `COMPANY_SLUG` correto e que `compile-extension` sincronizou `extensions/company-config` **e** `extensions/loja-exemplo-home` para `dist/`.
- [ ] Confirmar que artefatos gerados não foram editados manualmente e que `dist/`, `.evershop/` e `public/sitemap*.xml` não entram no commit de release.
- [ ] Build com erro = parar. Não publicar build parcial nem reaproveitar bundle de outra empresa.

## 5. Seed

- [ ] Confirmar que o DB de destino é o da empresa correta (`DB_NAME` do `.env`). Seed nunca em DB de outra instalação.
- [ ] `npm run seed` — `evershop seed` + `scripts/seed-metadata-cms.mjs` (metadados globais e `url_rewrite` dos `cmsSlugs`).
- [ ] `node scripts/seed-company.mjs --slug <slug>` — valida `schemas/catalog.schema.json`, prefixos SKU/URL do slug, `priceMode: "quote"` → preço 0 + `quoteOnly`, e nunca cria `Women`/`Men`/`Kids`.
- [ ] `npm run seed:home` — 7 widgets padrão; conferir UUIDs e `placements` sem duplicação (`ON CONFLICT DO NOTHING`).
- [ ] Para a Exemplo, manter prefixo `LE-`, os 9 departamentos, 7 produtos, 3 páginas CMS e 6 posts do baseline. Para outra empresa, usar exclusivamente o prefixo do manifesto.
- [ ] Revisar contagens e URLs impressas pelo seed; qualquer falha = parar e seguir o rollback (seção 12).
- [ ] Migrations aplicadas no start, uma instância por vez, com backup prévio.

## 6. Sitemap / robots

- [ ] Executar o gerador de SEO/domínio `scripts/render-company-sitemap.mjs` (confirmar a assinatura de CLI com o dono de SEO/domínio antes de usar flags).
- [ ] Sitemap gravado no `public/` **da instalação**, sem sobrescrever arquivos de outra loja.
- [ ] Todas as `<loc>`, canonicals e `hreflang` usam `EVERSHOP_HOME_URL`; **zero** ocorrência de `localhost`, porta local ou domínio de outra empresa.
- [ ] `robots.txt` com a linha `Sitemap: <EVERSHOP_HOME_URL>/sitemap.xml`.
- [ ] **Nenhuma URL com prefixo `/pt-br`** em sitemap, `robots.txt`, canonicals ou links internos da homepage (pt-BR é tradução, não prefixo de idioma nesta instalação).
- [ ] `public/sitemap*.xml` tratados como artefatos: não editar manualmente.

## 7. WhatsApp

- [ ] `SITE.whatsapp`, `SITE.whatsappHref`, `SITE.phoneHref`, `quoteHref()` e `waLink()` derivam de `companies/<slug>.json` via `COMPANY` (`site.ts` mantém as assinaturas antigas).
- [ ] `whatsapp.number` sem `+` e sem espaços (Exemplo: `5500000000000`); link `https://wa.me/<numero>?text=<mensagem codificada>`.
- [ ] CTAs de header, menu mobile, footer, hero, CTA final, ficha de produto, carrinho e login usam o número da empresa ativa; `utm_source`/`utm_medium=whatsapp` presentes quando `waLink()` é usado.
- [ ] Telefone, endereço, horário e Maps no rodapé/HUD coerentes com o manifesto; `publicEmail` permanece ausente se `null`.
- [ ] Para `loja-exemplo`: número, textos e links idênticos ao baseline — inclusive a mensagem legada de `quoteHref()`, que não deve ser trocada nesta fase.

## 8. Page builder

- [ ] `extensions/loja-exemplo-home/generated/widgets.json` contém exatamente os 7 defaults versionados, com dados preenchidos pelo manifesto ativo.
- [ ] `extensions/loja-exemplo-home/src/bootstrap.js` lê `generated/widgets.json` com fallback para `widgets.json`.
- [ ] Tipos, schemas e componentes dos blocos versionados no template; conteúdo editado no admin permanece no DB da instalação.
- [ ] `.evershop/`, `pb-draft-1` e qualquer rascunho local ficam fora do Git e fora do pacote de deploy.
- [ ] Conferido que a home renderiza os widgets esperados para a empresa (ou exatamente o baseline da Exemplo).

> [!WARNING]
> **NÃO publicar o changeset 2 do page builder (`pb-draft-1`) sem autorização explícita.** O rascunho permanece intocável e fora do Git conforme `AGENT_CONTRACT.md` (regra 9) e `docs/ARQUITETURA_MULTI_INSTALACAO.md`. Qualquer publicação depende de autorização formal e revisão do conteúdo pelo dono do page builder; este checklist **não** autoriza esse changeset.

## 9. Domínio único via `EVERSHOP_HOME_URL`

- [ ] `.env` contém `EVERSHOP_HOME_URL=https://<dominio-canonical>` (https, sem barra final).
- [ ] `HOME_URL` **não** está definido em `.env`, export do processo nem no ambiente do deploy — `config/custom-environment-variables.json` mapeia `shop.homeUrl` para `HOME_URL`, que pode sobrescrever a URL canônica.
- [ ] Valor idêntico a `companies/<slug>.json` → `domain` e a `config/generated/company.json` → `domain`; coerente com `config/default.json` → `shop.homeUrl`.
- [ ] Um domínio canônico por instalação: conferir que nenhuma outra loja usa o mesmo domínio, o mesmo `DB_NAME` ou a mesma `PORT`.
- [ ] HTML renderizado de `/` e `/products` contém apenas esse domínio em canonical, `og:url`, links absolutos, StructuredData e `<loc>`; `localhost` ou domínio de outra empresa = bloqueio imediato.
- [ ] Certificado TLS válido e redirecionamentos testados no domínio final.

## 10. Smoke test (após subir a instalação)

- [ ] `GET /` → 200; conteúdo em pt-BR; widgets da home corretos; nenhum link interno com `/pt-br`; nenhum dado da Exemplo vazando em outra empresa.
- [ ] `GET /admin` → 200 ou redirect para login; login com a credencial local; tema/loja corretos no admin.
- [ ] `GET /products` → 200; produtos do slug; quando `priceMode: "quote"`, exibir “Sob consulta”/CTA de WhatsApp; ausência de `Women`/`Men`/`Kids`.
- [ ] `GET /sitemap.xml` e todos os `sitemap-*.xml` → 200; `<loc>` sem `/pt-br`, sem `localhost` e sem domínio alheio.
- [ ] `GET /robots.txt` → 200; linha `Sitemap:` apontando para o domínio canônico desta instalação.
- [ ] Logs sem 500, stack traces de seed/compile ou avisos de tema/extensão desativada.
- [ ] Preencher a tabela de registro abaixo; qualquer item falho → rollback (seção 12).

## 11. Auditoria de vazamento

- [ ] Executar `node scripts/check-company-leaks.mjs --slug <slug> --html <EVERSHOP_HOME_URL>/` — somente leitura; esperado: `Nenhum vazamento detectado.` e `exit 0`.
- [ ] Repetir a varredura de HTML em `/products` e em pelo menos uma página CMS (o script aceita uma URL por vez).
- [ ] Para empresas que não sejam a Exemplo: nenhuma ocorrência de nome/nome sem acento, sufixo de WhatsApp, fragmento de telefone, endereço real, cidade real, CEP real, domínio da empresa-base, ID de página do Facebook, prefixo de SKU da empresa-base ou marca curta em SVG inline.
- [ ] Revisar manualmente o que o auditor ignora (`node_modules/`, `dist/`, `.evershop/`, `public/sitemap*.xml`, docs legados e fixtures): conferir no HTML renderizado e nos artefatos gerados listados na seção 2.
- [ ] Atenção: o auditor depende de `git ls-files`; sem repo Git, arquivos não versionados podem gerar falsos negativos.
- [ ] Qualquer finding = parar e corrigir na origem (manifesto/gerador/seed). Não maquiar relatório nem adicionar exceções ad hoc ao auditor.

## 12. Rollback

- [ ] Antes do deploy: snapshot do DB + cópia de `.env`, `public/`, `media/` e do release anterior do template, com local e data registrados.
- [ ] Falha **antes** de subir: descartar artefatos gerados desta tentativa e manter o release anterior; reverter `.env` se foi alterado.
- [ ] Falha **depois** de subir, nesta ordem: (1) restaurar o release anterior; (2) restaurar o DB do snapshot; (3) restaurar o `.env` anterior; (4) restaurar `public/` (sitemap/robots) e `media/`; (5) rebuild/restart; (6) repetir smoke test e auditoria.
- [ ] Migrations: avaliar reversibilidade com o dono de schema DB antes de qualquer restore; não assumir que todas são reversíveis.
- [ ] Seeds são idempotentes (`ON CONFLICT DO NOTHING`), mas restore de DB sobrescreve dados — confirmar janela e aprovação antes de restaurar.
- [ ] Registrar motivo, executor e resultado do rollback; comunicar às demais lojas se a falha indicar problema no template compartilhado.

---

## Registro de execução (preencher no momento da publicação)

| Etapa | Data | Executor | Evidência / resultado |
|---|---|---|---|
| Pré-requisitos e backup |  |  |  |
| Render do manifesto |  |  |  |
| Patches / verify |  |  |  |
| Build |  |  |  |
| Seed |  |  |  |
| Sitemap / robots |  |  |  |
| WhatsApp |  |  |  |
| Page builder (sem changeset 2) |  |  |  |
| Domínio único (`EVERSHOP_HOME_URL`) |  |  |  |
| Smoke test (`/`, `/admin`, `/products`, sitemap) |  |  |  |
| Auditoria de vazamento |  |  |  |
| Rollback (se executado) |  |  |  |

## Dependências de outros donos (não validadas por este agente)

- `companies/*`, `scripts/render-company-config.mjs`, `.env.example` e `package.json`: dono config/manifesto.
- `scripts/render-company-sitemap.mjs`, `StructuredData.tsx`, `Base.tsx`: dono SEO/domínio — confirmar a CLI do gerador de sitemap.
- `scripts/patch-ptbr-core.mjs` e `scripts/patch-verify.mjs`: dono patches pt-BR — `patch-verify.mjs` pode ainda não existir no momento da leitura.
- `scripts/seed-homepage-widgets.mjs` e `extensions/loja-exemplo-home/src/bootstrap.js`: dono page builder — autorização do changeset 2 é externa a este checklist.
- `scripts/seed-company.mjs` e `schemas/catalog.schema.json`: dono seeds catálogo.
- `themes/.../site.ts`: dono WhatsApp.
- `scripts/check-company-leaks.mjs`: dono auditoria de vazamento.
- CI (`.github/workflows/template-ci.yml`): dono CI — integrar estes gates quando o workflow estiver disponível.

Este documento é apenas o checklist. Ele não valida deploy, conteúdo publicado nem autoriza publicação.
