# Contrato de implementação — Fase 3 (Mercado Livre e Shopee BR)

- Versão: 1.0 (2026-11-23)
- Base: `evershop-seu-ecommerce-facil` (relativo à raiz do repositório)
- Natureza: 20 agentes `general` editando código em paralelo, com donos de arquivo exclusivos.
- Especificação técnica compartilhada: `docs/ESPECIFICACAO_MARKETPLACES.md` (leia antes de escrever).
- Contrato anterior (Fase 0): `docs/AGENT_CONTRACT.md` — continua válido no que não conflitar.

## Regras globais — valem para TODOS os 20 agentes

1. Trabalhe **somente** nos arquivos do seu dono na tabela abaixo. Não edite nada fora deles. Se precisar de um arquivo de outro dono, **não edite**: descreva a dependência na resposta final.
2. Use agente `general` para edição. Agentes `explore` são somente leitura e não devem ser usados para editar.
3. **Não** rode `npm install`, `npm ci`, `postinstall`, `npm run build`, `npm run seed`, `npm start`, `npm run dev`, migrações, SQL ou qualquer chamada de rede para ML/Shopee.
4. É permitido somente: leitura de arquivos, `node --check <arquivo>` e parse local de JSON. Nada que modifique `.env`, banco, `.evershop/`, `dist/`, `node_modules/`, `media/` ou `public/sitemap*.xml`.
5. **Não** faça `git commit`, `git push`, `git checkout`, `git clean`, `git reset`, `git add`, changeset, publish, deploy nem abra PR.
6. **Não** toque no rascunho do page builder `pb-draft-1` (`changeset_id=2`). Nada foi publicado; nada deve ser publicado sem autorização explícita posterior.
7. **Nenhuma credencial, token, `partner_key`, `client_secret`, chave de criptografia, `.env` ou dado pessoal real em arquivos versionados.** Segredos ficam apenas em variáveis de ambiente/cofre da instalação. Em logs, use sempre redação.
8. **Nenhum preço inventado.** A única fonte de preço publicável é `product.price` do EverShop, validada por `lib/pricing.js`. `price <= 0` ou nulo => falhar fechado, sem criar/atualizar anúncio. Nunca preencher `price: 0` no catálogo.
9. **Nenhuma publicação real.** O código pode montar payloads e filas, mas `publishAllowed` e `publishSkus` começam desativados/vazios; não é para criar anúncio, pedido, webhook remoto nem autorizar app em ambiente real.
10. Todo conteúdo, comentário, mensagem de erro e documentação em **pt-BR**. Nomes de identificadores técnicos (SKU, `listing_type_id`, rotas) permanecem como na API oficial.
11. Preserve a saída da Loja Exemplo: nenhuma alteração visual, de texto, SEO, WhatsApp, domínio ou catálogo nesta fase. A extensão nova entra **desativada** em `config/default.json`.
12. Use SQL parametrizado (`$1`, `$2`, ...) em todo acesso a banco. Nunca interpole valor do usuário em SQL. Nunca registre token, segredo, CPF/e-mail de comprador ou payload bruto de pedido em log.
13. Idempotência é obrigatória: chaves determinísticas por `marketplace + seller_id + sku` (anúncio), `marketplace + seller_id + external_order_id` (pedido) e `marketplace + dedupe_key` (evento). Webhooks devem responder 2xx rápido e processar de forma assíncrona.
14. Ao terminar, responda exatamente com: (a) arquivos criados/editados, (b) o que mudou, (c) riscos/dependências de outros donos. **Não** diga "pronto para publicar".

## Convenções de código compartilhadas

- JavaScript ESM (`.js`), `type: module`. Extensão: `extensions/marketplace-bridge/`.
- Todo módulo de biblioteca exporta funções nomeadas; erro de domínio usa classes em `lib/errors.js` quando necessário.
- `src/` é a fonte; `dist/` é gerado por `npm run theme:compile` (o agente NÃO roda esse comando).
- Migration da extensão: `src/migration/Version-1.0.0.js`, com `export default async function (connection) { ... }`.
- Rotas de API seguem o padrão EverShop: pasta com `route.json` + handler `index.js` (ou nome equivalente). `access: "private"` para ações administrativas; `access: "public"` apenas para callbacks OAuth e webhooks, sempre com validação própria.
- Cron jobs são registrados no `bootstrap.js` via `registerJob` de `@evershop/evershop/lib/cronjob`, com `resolve: path.resolve(import.meta.dirname, 'crons', '<arquivo>.js')`.

## Donos de arquivo (20 agentes)

| # | Tema | Arquivos que pode editar (somente estes) |
|---|---|---|
| 1 | Contrato e segurança | `docs/AGENT_CONTRACT_MARKETPLACES.md`, `docs/SEGURANCA_MARKETPLACES.md`, `docs/LGPD_MARKETPLACES.md` |
| 2 | Especificação e arquitetura | `docs/ESPECIFICACAO_MARKETPLACES.md`, `docs/FLUXOS_MARKETPLACES.md` |
| 3 | Config por empresa | `companies/schema.marketplaces.json`, `companies/_template.marketplaces.json`, `companies/loja-exemplo.marketplaces.json`, `scripts/validate-marketplaces-config.mjs` |
| 4 | Segredos e config runner | `.env.example`, `config/default.json`, `extensions/marketplace-bridge/src/lib/config.js`, `extensions/marketplace-bridge/src/lib/secrets.js` |
| 5 | Cripto e erros | `extensions/marketplace-bridge/src/lib/crypto.js`, `extensions/marketplace-bridge/src/lib/errors.js` |
| 6 | Banco e migration | `extensions/marketplace-bridge/src/migration/Version-1.0.0.js`, `extensions/marketplace-bridge/src/lib/db.js`, `docs/MARKETPLACE_DB.md` |
| 7 | HTTP e retentativas | `extensions/marketplace-bridge/src/lib/http.js`, `extensions/marketplace-bridge/src/lib/rate-limit.js` |
| 8 | Preço e validação | `extensions/marketplace-bridge/src/lib/pricing.js`, `extensions/marketplace-bridge/tests/pricing.test.mjs`, `extensions/marketplace-bridge/tests/normalize.test.mjs` |
| 9 | Catálogo EverShop | `extensions/marketplace-bridge/src/lib/catalog.js`, `extensions/marketplace-bridge/src/lib/normalize.js` |
| 10 | Idempotência e eventos | `extensions/marketplace-bridge/src/lib/idempotency.js`, `extensions/marketplace-bridge/src/lib/events.js`, `extensions/marketplace-bridge/src/lib/outbox.js` |
| 11 | OAuth Mercado Livre | `extensions/marketplace-bridge/src/lib/adapters/mercadolivre/oauth.js` |
| 12 | ML anúncios | `extensions/marketplace-bridge/src/lib/adapters/mercadolivre/client.js`, `.../mapper.js`, `.../listings.js` |
| 13 | ML pedidos/estoque/webhook | `extensions/marketplace-bridge/src/lib/adapters/mercadolivre/orders.js`, `.../inventory.js`, `.../webhook.js` |
| 14 | OAuth Shopee | `extensions/marketplace-bridge/src/lib/adapters/shopee/oauth.js`, `.../sign.js` |
| 15 | Shopee anúncios | `extensions/marketplace-bridge/src/lib/adapters/shopee/client.js`, `.../mapper.js`, `.../listings.js` |
| 16 | Shopee pedidos/estoque/webhook | `extensions/marketplace-bridge/src/lib/adapters/shopee/orders.js`, `.../inventory.js`, `.../webhook.js` |
| 17 | Serviços de sincronização | `extensions/marketplace-bridge/src/services/sync-listings.js`, `.../sync-orders.js`, `.../sync-inventory.js`, `.../reconcile.js` |
| 18 | Bootstrap, rotas e crons | `extensions/marketplace-bridge/src/bootstrap.js`, `extensions/marketplace-bridge/src/api/**`, `extensions/marketplace-bridge/src/crons/**` |
| 19 | Admin e observabilidade | `extensions/marketplace-bridge/src/graphql/**`, `extensions/marketplace-bridge/src/pages/admin/**`, `docs/OBSERVABILIDADE_MARKETPLACES.md` |
| 20 | CI, scripts e checklist | `package.json` (somente adicionar scripts), `.github/workflows/template-ci.yml`, `scripts/check-marketplace-secrets.mjs`, `docs/CHECKLIST_MARKETPLACES.md` |

Os caminhos `.../mercadolivre/...` e `.../shopee/...` são relativos a `extensions/marketplace-bridge/src/lib/adapters/`.

## Ordem de dependência lógica (sem bloquear quem escreve primeiro)

1. Especificação/contrato (agentes 1 e 2) — já entregue como base desta distribuição.
2. Fundação: 3, 4, 5, 6, 7, 8, 9, 10.
3. Adaptadores: 11, 12, 13 (ML) e 14, 15, 16 (Shopee).
4. Orquestração: 17, 18, 19.
5. Verificação: 20 e, ao final, validações locais feitas pelo coordenador (sem build, seed, rede ou publicação).

## Critérios de saída da Fase 3 (código entregue, não publicado)

1. Extensão `marketplace-bridge` existe, compila como código-fonte e está **desativada** por padrão.
2. Config não secreta por empresa existe; segredos apenas em `.env.example` como nomes de variáveis, sem valores reais.
3. `price <= 0` bloqueia publicação e atualização de preço; nenhum preço é inferido ou inventado.
4. OAuth ML e Shopee BR usa `state`, redirect exato, refresh de uso único e tokens criptografados em repouso.
5. Webhooks assinados/validados, com dedupe, resposta rápida e processamento assíncrono.
6. Pedidos e estoque usam idempotência e não alteram o modo "sob consulta" da loja própria.
7. Nenhum anúncio, pedido, autorização de app ou changeset foi criado/publicado; nada foi comitado.
