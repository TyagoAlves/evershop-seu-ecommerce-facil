# Especificação técnica — integração Mercado Livre e Shopee BR (Fase 3)

- Versão: 1.0 (2026-11-23)
- Este documento é o contrato de interfaces entre os 20 agentes. Se algo aqui conflitar com a documentação oficial, **a documentação oficial prevalece**: registre a divergência na resposta final e implemente a versão oficial com comentário citando a data da consulta.
- Fontes consultadas em 2026-11-23: `developers.mercadolivre.com.br/pt_br/desenvolvimento-in-house`, `.../user-products`, `.../itens-e-buscas`, `open.shopee.com/developer-guide/20`, `.../OpenAPI 2.0 Overview`, APIs `v2.product.*` e `Push Mechanism`.

## 1. Modelo de instalação e limites

- Uma empresa = uma instalação EverShop 2.4 + PostgreSQL próprio + domínio próprio. O código da extensão é compartilhado via template Git; cada instalação tem seu `.env`.
- A extensão `marketplace-bridge` é **comum ao template** e entra com `"enabled": false` em `config/default.json`. Nenhuma empresa é publicada sem config própria preenchida e autorização explícita.
- Config não secreta: `companies/<slug>.marketplaces.json`. Defaults em `companies/_template.marketplaces.json`; validação em `companies/schema.marketplaces.json`.
- `COMPANY_SLUG` (default `loja-exemplo`) seleciona o arquivo. Se o arquivo não existir, `readMarketplaceConfig()` retorna `null` e todas as integrações ficam desativadas.
- Nunca usar um mesmo par de credenciais, seller id, shop id ou token entre empresas.

## 2. Estrutura de pastas

```
extensions/marketplace-bridge/src/
  bootstrap.js
  lib/
    config.js  secrets.js  crypto.js  errors.js  http.js  rate-limit.js
    db.js  pricing.js  normalize.js  catalog.js
    idempotency.js  events.js  outbox.js
    adapters/
      mercadolivre/ oauth.js client.js mapper.js listings.js orders.js inventory.js webhook.js
      shopee/       oauth.js sign.js  client.js mapper.js listings.js orders.js inventory.js webhook.js
  services/ sync-listings.js sync-orders.js sync-inventory.js reconcile.js
  api/  mp-oauth-start/ mp-oauth-callback/ mp-webhook-mel/ mp-webhook-shopee/
  crons/ sync-listings.js sync-orders.js sync-inventory.js reconcile.js
  migration/ Version-1.0.0.js
  graphql/types/MarketplaceStatus/...
  pages/admin/all/...
tests/ pricing.test.mjs normalize.test.mjs
```

## 3. Config não secreta (`companies/<slug>.marketplaces.json`)

Formato exato (valores abaixo são **defaults de segurança**, não dados reais):

```json
{
  "schema": 1,
  "slug": "loja-exemplo",
  "enabled": false,
  "currency": "BRL",
  "marketplaces": {
    "mercadolivre": {
      "enabled": false,
      "siteId": "MLB",
      "currencyId": "BRL",
      "conditionDefault": "new",
      "buyingMode": "buy_it_now",
      "listingTypeDefault": "free",
      "webhookPath": "/api/marketplaces/mercadolivre/webhook",
      "categoryMap": [],
      "attributeMap": [],
      "publishAllowed": false,
      "publishSkus": []
    },
    "shopee": {
      "enabled": false,
      "region": "BR",
      "environment": "production",
      "itemStatusDefault": "UNLIST",
      "webhookPath": "/api/marketplaces/shopee/webhook",
      "categoryMap": [],
      "publishAllowed": false,
      "publishSkus": []
    }
  },
  "sync": {
    "listingsCron": "*/15 * * * *",
    "ordersCron": "*/5 * * * *",
    "inventoryCron": "*/10 * * * *",
    "reconcileCron": "17 3 * * *",
    "batchSize": 20
  },
  "inventory": {
    "reserveOnOrder": true,
    "deductOnShip": true,
    "restoreOnCancel": true
  }
}
```

- `categoryMap`: `[{ "skuPrefix": "HC", "categoryId": null, "listingTypeId": null }]`. Valores `null` significam "não configurado" e impedem publicação daquele SKU.
- `attributeMap`: `[{ "sku": "HC-0001", "attributes": [{ "id": "...", "value_name": "..." }] }]`.
- `publishAllowed: false` **ou** `publishSkus` vazio => nenhum anúncio é criado/atualizado. `publishSkus` é allowlist explícita; nunca interpretar vazio como "todos".
- O schema deve proibir chaves que pareçam segredo (`clientSecret`, `partnerKey`, `accessToken`, `refreshToken`, `password`, `apiKey`) e exigir `siteId: "MLB"` para ML e `region: "BR"` para Shopee.

## 4. Variáveis de ambiente (nomes apenas — nunca valores no Git)

```
MARKETPLACE_TOKEN_ENCRYPTION_KEY=   # base64 de 32 bytes (AES-256-GCM)
ML_APP_ID=
ML_CLIENT_SECRET=
ML_REDIRECT_URI=https://<dominio>/api/marketplaces/mercadolivre/oauth/callback
ML_WEBHOOK_SECRET=
SHOPEE_PARTNER_ID=
SHOPEE_PARTNER_KEY=
SHOPEE_REDIRECT_URI=https://<dominio>/api/marketplaces/shopee/oauth/callback
SHOPEE_WEBHOOK_SECRET=
SHOPEE_ENV=production                # production | sandbox
```

Redirect URIs devem ser HTTPS e cadastrados exatamente no DevCenter/Open Platform. `state` é imprevisível, gravado no banco e de uso único.

## 5. Interfaces compartilhadas (ASSINATURAS OBRIGATÓRIAS)

### `lib/config.js`
```js
export function readMarketplaceConfig();              // object | null
export function getMarketplaceSettings(marketplace);  // object | null
export function isEnabled(marketplace);               // boolean
export function canPublish(marketplace, sku);         // boolean
```

### `lib/secrets.js`
```js
export function getSecret(name);                      // string | null
export function requireSecrets(marketplace);          // object; lança SecretsMissingError
export function redact(value);                        // string segura para log
```

### `lib/crypto.js`
```js
export function encryptSecret(plaintext);             // "v1:<iv>:<tag>:<cipher>" em base64
export function decryptSecret(payload);               // string
export function hmacSha256Hex(key, data);             // hex minúsculo
export function safeEqual(a, b);                      // boolean, tempo constante
```

### `lib/errors.js`
```js
export class MarketplaceError extends Error            // .code, .marketplace?
export class SecretsMissingError extends MarketplaceError
export class PriceNotAvailableError extends MarketplaceError
export class ConfigError extends MarketplaceError
export class MarketplaceHttpError extends MarketplaceError // .status, .requestId
export class WebhookVerificationError extends MarketplaceError
export class IdempotencyConflictError extends MarketplaceError
```
Mensagens de erro nunca contêm segredos, tokens ou payload completo de pedido.

### `lib/http.js`
```js
export async function requestJson({ method, url, headers, body, timeoutMs = 10000, retries = 2 });
// => { status, body, headers }. Respeita 429/5xx com backoff; erros sem vazar query secrets.
export function sleep(ms);
```

### `lib/pricing.js`
```js
export function toCents(value);                       // number -> inteiro
export function fromCents(cents);                     // inteiro -> number
export function assertPublishablePrice(product);      // lança PriceNotAvailableError se price <= 0
```

### `lib/catalog.js` / `lib/normalize.js`
```js
export async function getProductsForMarketplace({ limit = 20, offset = 0, skus = [] });
// => [{ productId, sku, name, description, shortDescription, price, qty,
//       manageStock, stockAvailability, urlKey, imageUrl, weight }]
export async function getProductBySku(sku);
export async function getProductImages(productId);
export function buildStoreUrl(urlKey);                // EVERSHOP_HOME_URL ou shop.homeUrl
export function normalizeSku(sku);                    // trim + uppercase, removendo caracteres de controle/invisíveis; preservar hífens e demais caracteres visíveis
export function normalizeText(value, maxLength);
```
SQL: `product p JOIN product_description pd ON pd.product_description_product_id = p.product_id LEFT JOIN product_inventory pi ON ...`, filtrar `p.status = true AND p.visibility = true`. `product.price` é a **única** fonte de preço.

### `lib/db.js`
Todas as funções usam `getConnection()` de `@evershop/evershop/lib/postgres/connection.js` e liberam o client em `finally`.
```js
export async function withConnection(fn);
export async function getAccount(marketplace, sellerId);
export async function upsertAccount({ marketplace, sellerId, shopId, siteId, status });
export async function listConnectedAccounts(marketplace);
export async function saveToken({ accountId, type, value, expiresAt, scope, generation });
export async function getActiveToken({ accountId, type });
export async function markTokenUsed(tokenId);
export async function getListing(marketplace, sellerId, sku);
export async function upsertListing({ marketplace, sellerId, sku, productId, externalItemId, status, priceCents, quantity, payloadHash, lastError });
export async function insertOrderIfAbsent({ marketplace, sellerId, externalOrderId, sku, productId, quantity, totalCents, status, payloadRedacted });
export async function insertEventIfAbsent({ marketplace, dedupeKey, topic, externalEventId, payloadRedacted });
export async function markEventProcessed(eventId, error);
export async function insertOutboxIfAbsent({ marketplace, operation, idempotencyKey, payload });
export async function claimNextOutbox({ marketplace, limit });
export async function markOutboxDone(outboxId);
export async function markOutboxFailed(outboxId, error);
export async function getSyncCursor(marketplace, sellerId, kind);
export async function setSyncCursor(marketplace, sellerId, kind, cursor);
export async function saveOAuthState({ state, marketplace, adminUserId });
export async function consumeOAuthState(state, marketplace);
export async function adjustEverShopStock({ productId, delta, reason });
```
`adjustEverShopStock` atualiza `product_inventory.qty` e `product.qty`, respeita `manage_stock`, nunca deixa quantidade negativa e usa transação. Não cria pedido no EverShop (pedido de marketplace fica na tabela própria).

### `lib/idempotency.js` / `lib/events.js` / `lib/outbox.js`
```js
export function makeIdempotencyKey({ marketplace, operation, sku, externalId });
export async function recordEvent({ marketplace, topic, externalEventId, payload });
export async function enqueue({ marketplace, operation, sku, externalId, payload });
export async function processOutbox({ marketplace, limit });
```

### Adaptadores (todos)
```js
// mercadolivre/oauth.js
export function getAuthorizationUrl(state);
export async function exchangeCode(code);
export async function refreshAccessToken(refreshToken);
export async function getSellerIdentity(accessToken);

// shopee/oauth.js + sign.js
export function getAuthorizationUrl(state);
export async function exchangeCode(code, shopId);
export async function refreshAccessToken({ shopId, refreshToken });
export function sign({ path, timestamp, partnerId, partnerKey, accessToken = '', shopId = 0 });
```

`client.js`, `mapper.js`, `listings.js`, `orders.js`, `inventory.js`, `webhook.js` de cada marketplace devem exportar funções com nomes óbvios e consistentes entre ML e Shopee: `request`, `mapProductToPayload`, `createListing`, `updateListing`, `pauseListing`, `findListingBySku`, `fetchRecentOrders`, `getOrderDetail`, `updatePrice`, `updateStock`, `verifyWebhook`, `parseNotification`, `handleNotification`.

### Serviços
```js
export async function run({ marketplace, limit } = {});   // sync-listings, sync-orders, sync-inventory, reconcile
```

## 6. Tabelas da extensão (migration `Version-1.0.0.js`)

- `marketplace_account` — `marketplace`, `seller_id`, `shop_id`, `site_id`, `status`, timestamps; único por `(marketplace, seller_id)`.
- `marketplace_token` — `account_id`, `token_type` (`access`/`refresh`), `encrypted_value`, `expires_at`, `generation`, `used_at`; único por `(account_id, token_type)`. Refresh de uso único: marcar `used_at` e gravar novo com `generation+1`.
- `marketplace_oauth_state` — `state` (PK), `marketplace`, `admin_user_id`, `created_at`, `used_at`.
- `marketplace_listing` — `marketplace`, `seller_id`, `sku`, `product_id`, `external_item_id`, `status`, `price_cents`, `quantity`, `payload_hash`, `last_synced_at`, `last_error`; único por `(marketplace, seller_id, sku)`.
- `marketplace_order` — `marketplace`, `seller_id`, `external_order_id`, `sku`, `product_id`, `quantity`, `total_cents`, `status`, `payload_redacted`, `imported_at`; único por `(marketplace, seller_id, external_order_id)`.
- `marketplace_event` — `marketplace`, `dedupe_key`, `topic`, `external_event_id`, `payload_redacted`, `received_at`, `processed_at`, `status`, `attempts`, `last_error`; único por `(marketplace, dedupe_key)`.
- `marketplace_outbox` — `marketplace`, `operation`, `idempotency_key`, `payload`, `status`, `attempts`, `next_attempt_at`, `last_error`, `created_at`; único por `(marketplace, idempotency_key)`.
- `marketplace_sync_state` — `marketplace`, `seller_id`, `kind`, `cursor`, `updated_at`; único por `(marketplace, seller_id, kind)`.

Use `CREATE TABLE IF NOT EXISTS`, índices `IF NOT EXISTS` e `TIMESTAMPTZ`. `payload_redacted` nunca contém nome/CPF/e-mail/telefone do comprador.

## 7. Endpoints oficiais e regras por marketplace

### Mercado Livre (site `MLB`, moeda `BRL`)
- Autorização: `https://auth.mercadolibre.com.br/authorization?response_type=code&client_id=...&redirect_uri=...&state=...`. Redirect exato e HTTPS; `state` imprevisível; validar presença.
- Troca: `POST https://api.mercadolibre.com/oauth/token` (body: `grant_type`, `client_id`, `client_secret`, `code`/`refresh_token`, `redirect_uri`). Access token ~6h; refresh token **de uso único**.
- Identidade: `GET /users/me` e `GET /users/{id}`; exigir `site_id === 'MLB'`. Detectar tag `user_product_seller`.
- Anúncio: `POST /items`; leitura `GET /items/{id}`, busca `GET /users/{seller_id}/items/search?sku=...`; multiget **`GET /items/bulk?ids=`** (o antigo `/items?ids=` foi descontinuado em 25/10/2026).
- Novos anúncios de sellers no modelo User Products não aceitam o array antigo `variations`; usar um item por SKU com `seller_custom_field` e sem `variations`.
- **Desde 18/03/2026, `PUT /items` que envia somente `price` retorna 400.** Atualização de preço deve buscar o item completo e enviar payload completo (title, category_id, price, available_quantity, condition, listing_type_id, pictures, attributes etc.).
- Pedidos: `GET /orders/search?seller=...&sort=date_desc`, `GET /orders/{id}`; filtrar por `site_id: MLB`. Notificações: tópicos `items`, `orders`, `claims` etc.; responder HTTP 200 em até 500 ms; consultar o recurso depois; usar `missed_feeds` (até ~2 dias) para recuperar perdas; tratar duplicidade e ordem arbitrária.
- Nunca criar usuário de teste, anúncio de teste ou transação real a partir do código.

### Shopee Brasil
- Autorização (método atual): `https://open.shopee.com.br/auth` com `partner_id`, `auth_type=seller`, `response_type=code`, `redirect_uri`, `state`. Sandbox: `https://open.sandbox.test-stable.shopee.com.br/auth`.
- Ambiente: produção `https://openplatform.shopee.com.br`, sandbox `https://openplatform.sandbox.test-stable.shopee.com.br` (confirmar host conforme `SHOPEE_ENV`).
- Troca: `POST /api/v2/auth/token/get` (pública) com `code`, `partner_id`, `shop_id: 1`; assinatura `partner_id + path + timestamp`, HMAC-SHA256 com `partner_key`. Renovação: `POST /api/v2/auth/access_token/get` com `refresh_token` de uso único (30 dias). Access token ~4h; autorização máxima 365 dias.
- Assinatura Shop API: `partner_id + path + timestamp + access_token + shop_id`, HMAC-SHA256 lowercase hex; `timestamp` válido por 5 minutos. Parâmetros `partner_id`, `timestamp`, `sign` vão na query; `access_token` e `shop_id` também.
- Produtos: `v2.product.add_item` (ou `v2.product.batch_add_item` para volume, com `v2.product.get_batch_task_result`), `v2.product.update_item`, `v2.product.update_price`, `v2.product.update_stock`, `v2.product.get_item_base_info`, `v2.product.get_model_list`. `original_price` deve ser > 0; BR aceita 2 casas decimais. `item_status` default `UNLIST` — nunca publicar sem autorização.
- Pedidos: `v2.order.get_order_list`, `v2.order.get_order_detail`, `v2.cancel_order`. Push Mechanism (webhook): validar callback, exigir resposta 2xx; após o push, consultar a API para obter o estado real; idempotência por `ordersn`/`item_id`/`model_id`.
- `partner_key` é segredo: nunca assinar no cliente, nunca logar base string com token.

## 8. Fluxos obrigatórios

1. **Anúncio**: configurar empresa -> OAuth -> sincronizar conta -> `getProductsForMarketplace` -> `assertPublishablePrice` -> `canPublish(marketplace, sku)` -> mapear payload -> enfileirar outbox -> criar/atualizar via adapter -> gravar `marketplace_listing`. Se qualquer guarda falhar, registrar evento e não chamar API.
2. **Pedido**: webhook -> validar -> gravar `marketplace_event` com dedupe -> 200 rápido -> worker consulta detalhe -> `insertOrderIfAbsent` -> `adjustEverShopStock` transacional -> marcar evento processado.
3. **Estoque**: mudança em `product_inventory` (ou cron) -> comparar com `marketplace_listing.quantity` -> enfileirar `update_stock` -> atualizar com idempotência. Nunca vender abaixo de zero; respeitar `manage_stock`.
4. **Reconciliação**: consultar anúncios/pedidos remotos, comparar com tabelas locais, registrar divergências; não apagar nada automaticamente.

## 9. Testes e validação (sem build/seed/rede)

- `tests/pricing.test.mjs`: preço 0, negativo, nulo, decimal, centavos.
- `tests/normalize.test.mjs`: SKU, texto, URL.
- `scripts/check-marketplace-secrets.mjs`: falha se `.env.example` tiver valores reais ou se arquivos versionados contiverem nomes de variáveis com valor preenchido; nunca imprime segredos.
- Coordenador executará `node --check` nos `.js` e `node --test` nos testes; nenhum `npm run build`, seed ou chamada externa.
