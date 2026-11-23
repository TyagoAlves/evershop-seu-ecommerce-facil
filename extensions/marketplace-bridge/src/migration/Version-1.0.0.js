/**
 * Migration 1.0.0 da extensão marketplace-bridge.
 *
 * Cria as oito tabelas privadas da integração com Mercado Livre e Shopee BR.
 * Todas as instruções são idempotentes: a migration pode ser reaplicada sem
 * duplicar tabelas, índices ou registros. Nenhum dado de catálogo da loja é
 * alterado e nenhuma credencial é gravada em texto plano (o campo de token
 * guarda apenas o envelope cifrado produzido por lib/crypto.js).
 *
 * Convenções adotadas (ver docs/MARKETPLACE_DB.md):
 * - identificadores em snake_case, entre aspas duplas;
 * - timestamps em TIMESTAMPTZ (UTC no servidor, convertido pelo driver);
 * - valores monetários em centavos inteiros (BIGINT), nunca em ponto flutuante;
 * - payloads em JSONB já redacionados antes de chegar ao banco.
 */

const DDL = [
  // 1. Contas conectadas. Chave de negócio: (marketplace, seller_id).
  `CREATE TABLE IF NOT EXISTS "marketplace_account" (
    "marketplace_account_id" INT GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1) PRIMARY KEY,
    "marketplace" VARCHAR(32) NOT NULL,
    "seller_id" VARCHAR(128) NOT NULL,
    "shop_id" VARCHAR(128) DEFAULT NULL,
    "site_id" VARCHAR(16) DEFAULT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'connected',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MARKETPLACE_ACCOUNT_UNIQUE" UNIQUE ("marketplace", "seller_id")
  )`,

  // 2. Tokens cifrados. Um par (conta, tipo); refresh é de uso único.
  `CREATE TABLE IF NOT EXISTS "marketplace_token" (
    "marketplace_token_id" INT GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1) PRIMARY KEY,
    "account_id" INT NOT NULL,
    "token_type" VARCHAR(16) NOT NULL,
    "encrypted_value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ DEFAULT NULL,
    "scope" TEXT DEFAULT NULL,
    "generation" INT NOT NULL DEFAULT 1,
    "used_at" TIMESTAMPTZ DEFAULT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MARKETPLACE_TOKEN_UNIQUE" UNIQUE ("account_id", "token_type"),
    CONSTRAINT "MARKETPLACE_TOKEN_ACCOUNT_FK" FOREIGN KEY ("account_id")
      REFERENCES "marketplace_account" ("marketplace_account_id") ON DELETE CASCADE
  )`,

  // 3. Estado OAuth de uso único, gravado no banco (não em cookie/sessão).
  `CREATE TABLE IF NOT EXISTS "marketplace_oauth_state" (
    "state" VARCHAR(255) NOT NULL,
    "marketplace" VARCHAR(32) NOT NULL,
    "admin_user_id" INT DEFAULT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMPTZ DEFAULT NULL,
    CONSTRAINT "MARKETPLACE_OAUTH_STATE_PKEY" PRIMARY KEY ("state")
  )`,

  // 4. Anúncios locais: uma linha por SKU por vendedor.
  `CREATE TABLE IF NOT EXISTS "marketplace_listing" (
    "marketplace_listing_id" INT GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1) PRIMARY KEY,
    "marketplace" VARCHAR(32) NOT NULL,
    "seller_id" VARCHAR(128) NOT NULL,
    "sku" VARCHAR(128) NOT NULL,
    "product_id" INT DEFAULT NULL,
    "external_item_id" VARCHAR(128) DEFAULT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'draft',
    "price_cents" BIGINT DEFAULT NULL,
    "quantity" INT NOT NULL DEFAULT 0,
    "payload_hash" VARCHAR(128) DEFAULT NULL,
    "last_synced_at" TIMESTAMPTZ DEFAULT NULL,
    "last_error" TEXT DEFAULT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MARKETPLACE_LISTING_UNIQUE" UNIQUE ("marketplace", "seller_id", "sku")
  )`,

  // 5. Pedidos importados. Não existe pedido no EverShop para marketplace.
  `CREATE TABLE IF NOT EXISTS "marketplace_order" (
    "marketplace_order_id" INT GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1) PRIMARY KEY,
    "marketplace" VARCHAR(32) NOT NULL,
    "seller_id" VARCHAR(128) NOT NULL,
    "external_order_id" VARCHAR(128) NOT NULL,
    "sku" VARCHAR(128) DEFAULT NULL,
    "product_id" INT DEFAULT NULL,
    "quantity" INT NOT NULL DEFAULT 0,
    "total_cents" BIGINT DEFAULT NULL,
    "status" VARCHAR(32) DEFAULT NULL,
    "payload_redacted" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "imported_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MARKETPLACE_ORDER_UNIQUE" UNIQUE ("marketplace", "seller_id", "external_order_id")
  )`,

  // 6. Eventos de webhook com dedupe por (marketplace, dedupe_key).
  `CREATE TABLE IF NOT EXISTS "marketplace_event" (
    "marketplace_event_id" INT GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1) PRIMARY KEY,
    "marketplace" VARCHAR(32) NOT NULL,
    "dedupe_key" VARCHAR(255) NOT NULL,
    "topic" VARCHAR(128) DEFAULT NULL,
    "external_event_id" VARCHAR(128) DEFAULT NULL,
    "payload_redacted" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ DEFAULT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "attempts" INT NOT NULL DEFAULT 0,
    "last_error" TEXT DEFAULT NULL,
    CONSTRAINT "MARKETPLACE_EVENT_UNIQUE" UNIQUE ("marketplace", "dedupe_key")
  )`,

  // 7. Fila de operações a enviar aos marketplaces (outbox transacional).
  `CREATE TABLE IF NOT EXISTS "marketplace_outbox" (
    "marketplace_outbox_id" INT GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1) PRIMARY KEY,
    "marketplace" VARCHAR(32) NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "attempts" INT NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT DEFAULT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MARKETPLACE_OUTBOX_UNIQUE" UNIQUE ("marketplace", "idempotency_key")
  )`,

  // 8. Cursores de sincronização por conta e tipo de varredura.
  `CREATE TABLE IF NOT EXISTS "marketplace_sync_state" (
    "marketplace_sync_state_id" INT GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1) PRIMARY KEY,
    "marketplace" VARCHAR(32) NOT NULL,
    "seller_id" VARCHAR(128) NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "cursor" TEXT DEFAULT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MARKETPLACE_SYNC_STATE_UNIQUE" UNIQUE ("marketplace", "seller_id", "kind")
  )`,

  // Índices de apoio às consultas de rotina e à limpeza por retenção.
  `CREATE INDEX IF NOT EXISTS "MARKETPLACE_ACCOUNT_STATUS_IDX"
    ON "marketplace_account" ("marketplace", "status")`,
  `CREATE INDEX IF NOT EXISTS "MARKETPLACE_ACCOUNT_SHOP_IDX"
    ON "marketplace_account" ("marketplace", "shop_id")`,
  `CREATE INDEX IF NOT EXISTS "MARKETPLACE_TOKEN_EXPIRES_IDX"
    ON "marketplace_token" ("expires_at")`,
  `CREATE INDEX IF NOT EXISTS "MARKETPLACE_OAUTH_STATE_CREATED_IDX"
    ON "marketplace_oauth_state" ("created_at")`,
  `CREATE INDEX IF NOT EXISTS "MARKETPLACE_OAUTH_STATE_MARKETPLACE_IDX"
    ON "marketplace_oauth_state" ("marketplace")`,
  `CREATE INDEX IF NOT EXISTS "MARKETPLACE_LISTING_SELLER_STATUS_IDX"
    ON "marketplace_listing" ("marketplace", "seller_id", "status")`,
  `CREATE INDEX IF NOT EXISTS "MARKETPLACE_LISTING_EXTERNAL_ITEM_IDX"
    ON "marketplace_listing" ("external_item_id")`,
  `CREATE INDEX IF NOT EXISTS "MARKETPLACE_LISTING_PRODUCT_IDX"
    ON "marketplace_listing" ("product_id")`,
  `CREATE INDEX IF NOT EXISTS "MARKETPLACE_LISTING_SYNCED_IDX"
    ON "marketplace_listing" ("last_synced_at")`,
  `CREATE INDEX IF NOT EXISTS "MARKETPLACE_ORDER_IMPORTED_IDX"
    ON "marketplace_order" ("marketplace", "seller_id", "imported_at")`,
  `CREATE INDEX IF NOT EXISTS "MARKETPLACE_ORDER_SKU_IDX"
    ON "marketplace_order" ("sku")`,
  `CREATE INDEX IF NOT EXISTS "MARKETPLACE_ORDER_STATUS_IDX"
    ON "marketplace_order" ("status")`,
  `CREATE INDEX IF NOT EXISTS "MARKETPLACE_EVENT_STATUS_RECEIVED_IDX"
    ON "marketplace_event" ("marketplace", "status", "received_at")`,
  `CREATE INDEX IF NOT EXISTS "MARKETPLACE_EVENT_EXTERNAL_ID_IDX"
    ON "marketplace_event" ("external_event_id")`,
  `CREATE INDEX IF NOT EXISTS "MARKETPLACE_OUTBOX_CLAIM_IDX"
    ON "marketplace_outbox" ("marketplace", "status", "next_attempt_at", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "MARKETPLACE_OUTBOX_CREATED_IDX"
    ON "marketplace_outbox" ("created_at")`,
  `CREATE INDEX IF NOT EXISTS "MARKETPLACE_SYNC_STATE_KIND_IDX"
    ON "marketplace_sync_state" ("marketplace", "kind")`
];

/**
 * @param {import('pg').PoolClient} connection Client fornecido pelo runner de
 *   migrações do EverShop. Esta função não abre nem libera a conexão.
 */
export default async function (connection) {
  if (!connection || typeof connection.query !== 'function') {
    throw new TypeError('A migration requer uma conexão PostgreSQL válida.');
  }

  for (const sql of DDL) {
    await connection.query(sql);
  }
}
