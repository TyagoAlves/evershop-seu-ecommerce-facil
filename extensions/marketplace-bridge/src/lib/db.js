/**
 * Acesso a dados da integração com marketplaces.
 *
 * Regras deste módulo:
 * - toda consulta usa SQL parametrizado ($1, $2, ...); nenhum valor de usuário
 *   é concatenado na string SQL;
 * - toda conexão obtida com getConnection() é liberada em `finally`;
 * - o valor gravado em `encrypted_value` já vem cifrado de lib/crypto.js —
 *   este módulo nunca recebe nem registra token em texto plano;
 * - `payload_redacted` e `payload` passam por remoção defensiva de campos de
 *   comprador antes de serem enviados ao PostgreSQL;
 * - mensagens de erro são em pt-BR e nunca incluem payload completo.
 *
 * Nota sobre o import (2026-11-23): o arquivo canônico é
 * `@evershop/evershop/lib/postgres/connection.js`, mas o `exports` do pacote
 * @evershop/evershop@2.4.0 publica esse arquivo como
 * `@evershop/evershop/lib/postgres`. O subcaminho `.../connection.js` não é
 * exportado e falharia com ERR_PACKAGE_PATH_NOT_EXPORTED em ESM, por isso a
 * importação abaixo usa o subpath oficial do pacote instalado.
 */
import { getConnection } from '@evershop/evershop/lib/postgres';

/** Executa `fn` com um client do pool e sempre devolve o client ao pool. */
export async function withConnection(fn) {
  if (typeof fn !== 'function') {
    throw new TypeError('withConnection exige uma função de callback.');
  }

  const client = await getConnection();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

function linhaUnica(resultado) {
  if (!resultado) return null;
  if (Array.isArray(resultado)) return resultado[0] ?? null;
  return resultado.rows?.[0] ?? null;
}

// Chaves que identificam uma pessoa. O prefixo cobre variações comuns das
// APIs (buyer_info, recipient_address, customer_data etc.).
const CHAVES_SENSIVEIS = new Set([
  'cpf',
  'cnpj',
  'tax_id',
  'tax_number',
  'document',
  'document_number',
  'email',
  'e_mail',
  'phone',
  'phone_number',
  'mobile',
  'telephone',
  'address',
  'postal_code',
  'zip',
  'zipcode',
  'contact',
  'nickname',
  'full_name',
  'first_name',
  'last_name',
  'personal_data'
]);

function ehChaveSensivel(chave) {
  const normalizada = String(chave).toLowerCase().replace(/[\s_-]+/g, '_');
  return (
    /^(buyer|customer|recipient|shipping_address|billing_address|personal_data)/.test(
      normalizada
    ) || CHAVES_SENSIVEIS.has(normalizada)
  );
}

function limparTexto(texto) {
  // Redação best-effort para PII em texto livre; a responsabilidade primária
  // de redacionar continua sendo de quem monta o payload.
  return texto
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL_REDACIONADO]')
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[CPF_REDACIONADO]');
}

function sanitizarPayload(valor, profundidade = 0) {
  if (valor === null || valor === undefined) return null;
  if (profundidade > 16) return null;

  if (Array.isArray(valor)) {
    return valor.map((item) => sanitizarPayload(item, profundidade + 1));
  }

  if (typeof valor === 'object') {
    if (valor instanceof Date) return valor.toISOString();
    const copia = {};
    for (const [chave, item] of Object.entries(valor)) {
      if (ehChaveSensivel(chave)) continue;
      copia[chave] = sanitizarPayload(item, profundidade + 1);
    }
    return copia;
  }

  if (typeof valor === 'string') return limparTexto(valor);
  if (typeof valor === 'boolean') return valor;
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  return null;
}

/** Converte para JSONB aplicando a redação defensiva; falha fechado. */
function paraJsonb(valor) {
  const bruto = valor === undefined || valor === null ? {} : valor;
  const objeto =
    typeof bruto === 'string'
      ? (() => {
          try {
            return JSON.parse(bruto);
          } catch {
            throw new TypeError(
              'Payload redacionado inválido: use um objeto ou uma string JSON.'
            );
          }
        })()
      : bruto;
  return sanitizarPayload(objeto);
}

function mensagemSegura(erro) {
  // lib/events.js e lib/outbox.js já redacionam a mensagem e a repassam como
  // string; o tratamento abaixo é uma segunda camada, não a principal.
  const texto =
    typeof erro === 'string'
      ? erro
      : typeof erro?.message === 'string'
        ? erro.message
        : '';
  const bruto = texto.trim() === '' ? 'Falha não especificada.' : texto;
  return bruto
    .replace(/(bearer\s+)[^\s]+/gi, '$1[REDACIONADO]')
    .replace(
      /((?:client_secret|access_token|refresh_token|partner_key|password|secret|token|sign)\s*[=:]\s*)([^\s&,;]+)/gi,
      '$1[REDACIONADO]'
    )
    .slice(0, 1000);
}

/** Violação de unicidade do PostgreSQL; duplicidade não é erro fatal. */
function ehViolacaoUnica(erro) {
  if (!erro) return false;
  if (erro.code === '23505') return true;
  const mensagem = typeof erro.message === 'string' ? erro.message.toLowerCase() : '';
  return (
    mensagem.includes('duplicate key') ||
    mensagem.includes('unique constraint') ||
    mensagem.includes('violates unique')
  );
}

// lib/events.js e lib/outbox.js consomem `row.event_id`/`row.id` e
// `row.outbox_id`/`row.id`. As tabelas usam nomes prefixados, então os aliases
// são acrescentados somente no retorno, sem alterar o esquema.
function linhaEvento(row) {
  if (!row) return null;
  return {
    ...row,
    id: row.marketplace_event_id,
    event_id: row.marketplace_event_id
  };
}

function linhaOutbox(row) {
  if (!row) return null;
  return {
    ...row,
    id: row.marketplace_outbox_id,
    outbox_id: row.marketplace_outbox_id
  };
}

/* ------------------------------------------------------------------------- */
/* Contas e tokens                                                            */
/* ------------------------------------------------------------------------- */

export async function getAccount(marketplace, sellerId) {
  return withConnection(async (client) => {
    const resultado = await client.query(
      `SELECT * FROM "marketplace_account"
       WHERE "marketplace" = $1::text AND "seller_id" = $2::text
       LIMIT 1`,
      [marketplace ?? null, sellerId ?? null]
    );
    return linhaUnica(resultado);
  });
}

export async function upsertAccount({
  marketplace,
  sellerId,
  shopId,
  siteId,
  status
} = {}) {
  return withConnection(async (client) => {
    const resultado = await client.query(
      `INSERT INTO "marketplace_account"
        ("marketplace", "seller_id", "shop_id", "site_id", "status")
       VALUES ($1::text, $2::text, $3::text, $4::text, COALESCE($5::text, 'connected'))
       ON CONFLICT ("marketplace", "seller_id") DO UPDATE SET
         "shop_id" = COALESCE($3::text, "marketplace_account"."shop_id"),
         "site_id" = COALESCE($4::text, "marketplace_account"."site_id"),
         "status" = COALESCE($5::text, "marketplace_account"."status"),
         "updated_at" = CURRENT_TIMESTAMP
       RETURNING *`,
      [marketplace ?? null, sellerId ?? null, shopId ?? null, siteId ?? null, status ?? null]
    );
    return linhaUnica(resultado);
  });
}

export async function listConnectedAccounts(marketplace) {
  return withConnection(async (client) => {
    const resultado = await client.query(
      `SELECT * FROM "marketplace_account"
       WHERE "marketplace" = $1::text AND "status" = 'connected'
       ORDER BY "marketplace_account_id" ASC`,
      [marketplace ?? null]
    );
    return resultado.rows ?? [];
  });
}

/**
 * Salva o envelope cifrado do token. `value` DEVE ser o retorno de
 * encryptSecret(). A cada gravação a geração avança: se `generation` não for
 * informado, usa a geração atual + 1 (ou 1, na primeira gravação).
 */
export async function saveToken({
  accountId,
  type,
  value,
  expiresAt,
  scope,
  generation
} = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('O token cifrado é obrigatório para salvar credenciais.');
  }

  const escopoNormalizado = Array.isArray(scope) ? scope.join(' ') : scope;

  return withConnection(async (client) => {
    const resultado = await client.query(
      `INSERT INTO "marketplace_token"
        ("account_id", "token_type", "encrypted_value", "expires_at", "scope", "generation")
       VALUES ($1::int, $2::text, $3::text, $4::timestamptz, $5::text, COALESCE($6::int, 1))
       ON CONFLICT ("account_id", "token_type") DO UPDATE SET
         "encrypted_value" = EXCLUDED."encrypted_value",
         "expires_at" = COALESCE($4::timestamptz, "marketplace_token"."expires_at"),
         "scope" = COALESCE($5::text, "marketplace_token"."scope"),
         "generation" = COALESCE($6::int, "marketplace_token"."generation" + 1),
         "used_at" = NULL,
         "updated_at" = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        accountId ?? null,
        type ?? null,
        value,
        expiresAt ?? null,
        escopoNormalizado ?? null,
        generation ?? null
      ]
    );
    return linhaUnica(resultado);
  });
}

/** Retorna o token utilizável mais recente ou `null`. */
export async function getActiveToken({ accountId, type } = {}) {
  return withConnection(async (client) => {
    const resultado = await client.query(
      `SELECT * FROM "marketplace_token"
       WHERE "account_id" = $1::int
         AND "token_type" = $2::text
         AND "used_at" IS NULL
         AND ("expires_at" IS NULL OR "expires_at" > CURRENT_TIMESTAMP)
       ORDER BY "generation" DESC, "marketplace_token_id" DESC
       LIMIT 1`,
      [accountId ?? null, type ?? null]
    );
    return linhaUnica(resultado);
  });
}

/** Marca o refresh token como usado (uso único). Idempotente por id. */
export async function markTokenUsed(tokenId) {
  return withConnection(async (client) => {
    const resultado = await client.query(
      `UPDATE "marketplace_token"
       SET "used_at" = COALESCE("used_at", CURRENT_TIMESTAMP),
           "updated_at" = CURRENT_TIMESTAMP
       WHERE "marketplace_token_id" = $1::int
       RETURNING *`,
      [tokenId ?? null]
    );
    return linhaUnica(resultado);
  });
}

/* ------------------------------------------------------------------------- */
/* Anúncios                                                                   */
/* ------------------------------------------------------------------------- */

export async function getListing(marketplace, sellerId, sku) {
  return withConnection(async (client) => {
    const resultado = await client.query(
      `SELECT * FROM "marketplace_listing"
       WHERE "marketplace" = $1::text
         AND "seller_id" = $2::text
         AND "sku" = $3::text
       LIMIT 1`,
      [marketplace ?? null, sellerId ?? null, sku ?? null]
    );
    return linhaUnica(resultado);
  });
}

/**
 * Insere ou atualiza o anúncio local. Campos omitidos preservam o valor
 * anterior na atualização; `lastError` só é substituído quando a chave
 * `lastError` existe no objeto recebido (assim `null` pode limpar o erro).
 * `priceCents` nunca recebe 0 automático: ausência permanece NULL.
 */
export async function upsertListing({
  marketplace,
  sellerId,
  sku,
  productId,
  externalItemId,
  status,
  priceCents,
  quantity,
  payloadHash,
  lastSyncedAt,
  lastError
} = {}) {
  const erroInformado = lastError !== undefined;

  return withConnection(async (client) => {
    const resultado = await client.query(
      `INSERT INTO "marketplace_listing"
        ("marketplace", "seller_id", "sku", "product_id", "external_item_id",
         "status", "price_cents", "quantity", "payload_hash",
         "last_synced_at", "last_error")
       VALUES ($1::text, $2::text, $3::text, $4::int, $5::text,
         COALESCE($6::text, 'draft'), $7::bigint, COALESCE($8::int, 0),
         $9::text, COALESCE($10::timestamptz, CURRENT_TIMESTAMP), $11::text)
       ON CONFLICT ("marketplace", "seller_id", "sku") DO UPDATE SET
         "product_id" = COALESCE($4::int, "marketplace_listing"."product_id"),
         "external_item_id" = COALESCE($5::text, "marketplace_listing"."external_item_id"),
         "status" = COALESCE($6::text, "marketplace_listing"."status"),
         "price_cents" = COALESCE($7::bigint, "marketplace_listing"."price_cents"),
         "quantity" = COALESCE($8::int, "marketplace_listing"."quantity"),
         "payload_hash" = COALESCE($9::text, "marketplace_listing"."payload_hash"),
         "last_synced_at" = COALESCE($10::timestamptz, CURRENT_TIMESTAMP),
         "last_error" = CASE
           WHEN $12::boolean THEN $11::text
           ELSE "marketplace_listing"."last_error"
         END,
         "updated_at" = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        marketplace ?? null,
        sellerId ?? null,
        sku ?? null,
        productId ?? null,
        externalItemId ?? null,
        status ?? null,
        priceCents ?? null,
        quantity ?? null,
        payloadHash ?? null,
        lastSyncedAt ?? null,
        lastError ?? null,
        erroInformado
      ]
    );
    return linhaUnica(resultado);
  });
}

/* ------------------------------------------------------------------------- */
/* Pedidos, eventos e fila                                                    */
/* ------------------------------------------------------------------------- */

/** Insere o pedido apenas se a chave ainda não existir; não atualiza. */
export async function insertOrderIfAbsent({
  marketplace,
  sellerId,
  externalOrderId,
  sku,
  productId,
  quantity,
  totalCents,
  status,
  payloadRedacted
} = {}) {
  return withConnection(async (client) => {
    const resultado = await client.query(
      `INSERT INTO "marketplace_order"
        ("marketplace", "seller_id", "external_order_id", "sku", "product_id",
         "quantity", "total_cents", "status", "payload_redacted")
       VALUES ($1::text, $2::text, $3::text, $4::text, $5::int,
         COALESCE($6::int, 0), $7::bigint, $8::text, $9::jsonb)
       ON CONFLICT ("marketplace", "seller_id", "external_order_id") DO NOTHING
       RETURNING *`,
      [
        marketplace ?? null,
        sellerId ?? null,
        externalOrderId ?? null,
        sku ?? null,
        productId ?? null,
        quantity ?? null,
        totalCents ?? null,
        status ?? null,
        paraJsonb(payloadRedacted)
      ]
    );
    return linhaUnica(resultado);
  });
}

/**
 * Registra o webhook uma única vez por (marketplace, dedupe_key).
 * Retorno: { inserted, duplicate, row }; em caso de duplicidade a linha já
 * existente é devolvida para permitir a conferência de conflito feita por
 * lib/events.js. Uma violação 23505 é tratada como duplicidade, não como erro.
 */
export async function insertEventIfAbsent({
  marketplace,
  dedupeKey,
  topic,
  externalEventId,
  payloadRedacted
} = {}) {
  const parametros = [
    marketplace ?? null,
    dedupeKey ?? null,
    topic ?? null,
    externalEventId ?? null,
    paraJsonb(payloadRedacted)
  ];

  return withConnection(async (client) => {
    let inserida = null;
    try {
      const resultado = await client.query(
        `INSERT INTO "marketplace_event"
          ("marketplace", "dedupe_key", "topic", "external_event_id", "payload_redacted")
         VALUES ($1::text, $2::text, $3::text, $4::text, $5::jsonb)
         ON CONFLICT ("marketplace", "dedupe_key") DO NOTHING
         RETURNING *`,
        parametros
      );
      inserida = linhaUnica(resultado);
    } catch (erro) {
      if (!ehViolacaoUnica(erro)) throw erro;
    }

    if (inserida) {
      return { inserted: true, duplicate: false, row: linhaEvento(inserida) };
    }

    const existente = await client.query(
      `SELECT * FROM "marketplace_event"
       WHERE "marketplace" = $1::text AND "dedupe_key" = $2::text
       LIMIT 1`,
      [marketplace ?? null, dedupeKey ?? null]
    );
    return {
      inserted: false,
      duplicate: true,
      row: linhaEvento(linhaUnica(existente))
    };
  });
}

/** Fecha o evento como processado ou falho; incrementa `attempts`. */
export async function markEventProcessed(eventId, error) {
  const houveErro = Boolean(error);
  const mensagem = houveErro ? mensagemSegura(error) : null;

  return withConnection(async (client) => {
    const resultado = await client.query(
      `UPDATE "marketplace_event"
       SET "attempts" = "attempts" + 1,
           "status" = CASE WHEN $2::boolean THEN 'failed' ELSE 'processed' END,
           "processed_at" = CASE
             WHEN $2::boolean THEN NULL ELSE CURRENT_TIMESTAMP
           END,
           "last_error" = CASE
             WHEN $2::boolean THEN $3::text ELSE NULL
           END
       WHERE "marketplace_event_id" = $1::int
       RETURNING *`,
      [eventId ?? null, houveErro, mensagem]
    );
    return linhaUnica(resultado);
  });
}

/**
 * Enfileira uma operação uma única vez por (marketplace, idempotency_key).
 * Retorno: { inserted, duplicate, row }; a linha existente é devolvida quando
 * a chave já está na fila, para a conferência de conflito de lib/outbox.js.
 */
export async function insertOutboxIfAbsent({
  marketplace,
  operation,
  idempotencyKey,
  payload
} = {}) {
  const parametros = [
    marketplace ?? null,
    operation ?? null,
    idempotencyKey ?? null,
    paraJsonb(payload)
  ];

  return withConnection(async (client) => {
    let inserida = null;
    try {
      const resultado = await client.query(
        `INSERT INTO "marketplace_outbox"
          ("marketplace", "operation", "idempotency_key", "payload")
         VALUES ($1::text, $2::text, $3::text, $4::jsonb)
         ON CONFLICT ("marketplace", "idempotency_key") DO NOTHING
         RETURNING *`,
        parametros
      );
      inserida = linhaUnica(resultado);
    } catch (erro) {
      if (!ehViolacaoUnica(erro)) throw erro;
    }

    if (inserida) {
      return { inserted: true, duplicate: false, row: linhaOutbox(inserida) };
    }

    const existente = await client.query(
      `SELECT * FROM "marketplace_outbox"
       WHERE "marketplace" = $1::text AND "idempotency_key" = $2::text
       LIMIT 1`,
      [marketplace ?? null, idempotencyKey ?? null]
    );
    return {
      inserted: false,
      duplicate: true,
      row: linhaOutbox(linhaUnica(existente))
    };
  });
}

/**
 * Reserva até `limit` itens pendentes (ou travados por mais de 10 minutos),
 * em transação e com SKIP LOCKED, para que dois workers não processem o mesmo
 * item. Os itens reservados voltam com status 'processing'.
 *
 * Retorno: lista de itens `{ id, operation, marketplace, idempotency_key,
 * payload, attempts, status, next_attempt_at }`, no formato consumido por
 * lib/outbox.js. `id` é o valor de `marketplace_outbox_id`.
 */
export async function claimNextOutbox({ marketplace, limit } = {}) {
  const tamanho =
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;

  return withConnection(async (client) => {
    const resultado = await client.query(
      `WITH candidatos AS (
         SELECT o."marketplace_outbox_id"
         FROM "marketplace_outbox" o
         WHERE ($1::text IS NULL OR o."marketplace" = $1::text)
           AND (
             o."status" = 'pending'
             OR (
               o."status" = 'processing'
               AND o."updated_at" < CURRENT_TIMESTAMP - INTERVAL '10 minutes'
             )
           )
           AND o."next_attempt_at" <= CURRENT_TIMESTAMP
         ORDER BY o."created_at" ASC, o."marketplace_outbox_id" ASC
         LIMIT $2::int
         FOR UPDATE SKIP LOCKED
       )
       UPDATE "marketplace_outbox" AS o
       SET "status" = 'processing', "updated_at" = CURRENT_TIMESTAMP
       FROM candidatos c
       WHERE o."marketplace_outbox_id" = c."marketplace_outbox_id"
       RETURNING o.*`,
      [marketplace ?? null, tamanho]
    );
    return (resultado.rows ?? []).map((linha) => ({
      id: linha.marketplace_outbox_id,
      operation: linha.operation,
      marketplace: linha.marketplace,
      idempotency_key: linha.idempotency_key,
      payload: linha.payload ?? {},
      attempts: Number(linha.attempts ?? 0),
      status: linha.status,
      next_attempt_at: linha.next_attempt_at
    }));
  });
}

export async function markOutboxDone(outboxId) {
  return withConnection(async (client) => {
    const resultado = await client.query(
      `UPDATE "marketplace_outbox"
       SET "status" = 'done',
           "last_error" = NULL,
           "updated_at" = CURRENT_TIMESTAMP
       WHERE "marketplace_outbox_id" = $1::int
       RETURNING *`,
      [outboxId ?? null]
    );
    return linhaUnica(resultado);
  });
}

/** Registra a falha e devolve o item à fila com backoff linear (até 10 min). */
export async function markOutboxFailed(outboxId, error) {
  return withConnection(async (client) => {
    const resultado = await client.query(
      `UPDATE "marketplace_outbox"
       SET "attempts" = "attempts" + 1,
           "status" = 'pending',
           "next_attempt_at" = CURRENT_TIMESTAMP
             + (LEAST("attempts" + 1, 10) * INTERVAL '1 minute'),
           "last_error" = $2::text,
           "updated_at" = CURRENT_TIMESTAMP
       WHERE "marketplace_outbox_id" = $1::int
       RETURNING *`,
      [outboxId ?? null, mensagemSegura(error)]
    );
    return linhaUnica(resultado);
  });
}

/* ------------------------------------------------------------------------- */
/* Cursores de sincronização                                                  */
/* ------------------------------------------------------------------------- */

/** Retorna a linha de sincronização (com `.cursor`) ou `null`. */
export async function getSyncCursor(marketplace, sellerId, kind) {
  return withConnection(async (client) => {
    const resultado = await client.query(
      `SELECT * FROM "marketplace_sync_state"
       WHERE "marketplace" = $1::text
         AND "seller_id" = $2::text
         AND "kind" = $3::text
       LIMIT 1`,
      [marketplace ?? null, sellerId ?? null, kind ?? null]
    );
    return linhaUnica(resultado);
  });
}

export async function setSyncCursor(marketplace, sellerId, kind, cursor) {
  return withConnection(async (client) => {
    const resultado = await client.query(
      `INSERT INTO "marketplace_sync_state"
        ("marketplace", "seller_id", "kind", "cursor")
       VALUES ($1::text, $2::text, $3::text, $4::text)
       ON CONFLICT ("marketplace", "seller_id", "kind") DO UPDATE SET
         "cursor" = EXCLUDED."cursor",
         "updated_at" = CURRENT_TIMESTAMP
       RETURNING *`,
      [marketplace ?? null, sellerId ?? null, kind ?? null, cursor ?? null]
    );
    return linhaUnica(resultado);
  });
}

/* ------------------------------------------------------------------------- */
/* OAuth state                                                                */
/* ------------------------------------------------------------------------- */

export async function saveOAuthState({
  state,
  marketplace,
  adminUserId
} = {}) {
  if (typeof state !== 'string' || state.trim() === '') {
    throw new TypeError('O state OAuth é obrigatório.');
  }

  return withConnection(async (client) => {
    const resultado = await client.query(
      `INSERT INTO "marketplace_oauth_state"
        ("state", "marketplace", "admin_user_id")
       VALUES ($1::text, $2::text, $3::int)
       ON CONFLICT ("state") DO UPDATE SET
         "marketplace" = EXCLUDED."marketplace",
         "admin_user_id" = EXCLUDED."admin_user_id",
         "used_at" = NULL,
         "created_at" = CURRENT_TIMESTAMP
       RETURNING *`,
      [state, marketplace ?? null, adminUserId ?? null]
    );
    return linhaUnica(resultado);
  });
}

/**
 * Consome o state em uma única atualização condicional: só succeede se o
 * state existir, pertencer ao marketplace informado, não ter sido usado e
 * ter sido criado nos últimos 15 minutos.
 */
export async function consumeOAuthState(state, marketplace) {
  return withConnection(async (client) => {
    const resultado = await client.query(
      `UPDATE "marketplace_oauth_state"
       SET "used_at" = CURRENT_TIMESTAMP
       WHERE "state" = $1::text
         AND "marketplace" = $2::text
         AND "used_at" IS NULL
         AND "created_at" > CURRENT_TIMESTAMP - INTERVAL '15 minutes'
       RETURNING *`,
      [state ?? null, marketplace ?? null]
    );
    return linhaUnica(resultado);
  });
}

/* ------------------------------------------------------------------------- */
/* Estoque                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Ajusta o estoque do EverShop em transação, espelhando a quantidade em
 * `product_inventory.qty` e `product.qty`. Não cria pedido no EverShop, não
 * mexe em `manage_stock`, `stock_availability` nem no modo "sob consulta".
 * Quando o produto não gerencia estoque, a operação é um no-op.
 *
 * @returns {Promise<{productId:number, changed:boolean, previousQty:number,
 *   qty:number, appliedDelta:number, clamped:boolean, reason:string}>}
 */
export async function adjustEverShopStock({ productId, delta, reason } = {}) {
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new TypeError('productId inválido para ajuste de estoque.');
  }
  if (!Number.isInteger(delta)) {
    throw new TypeError('O delta de estoque deve ser um número inteiro.');
  }

  const motivo =
    typeof reason === 'string' && reason.trim() !== ''
      ? reason.trim().slice(0, 120)
      : 'marketplace';

  return withConnection(async (client) => {
    await client.query('BEGIN');
    try {
      // Ordem fixa de travamento (inventory -> product) para reduzir deadlock.
      const inventario = await client.query(
        `SELECT "qty", "manage_stock" FROM "product_inventory"
         WHERE "product_inventory_product_id" = $1::int
         FOR UPDATE`,
        [productId]
      );
      if (linhaUnica(inventario) === null) {
        throw new Error(`Estoque do produto ${productId} não encontrado.`);
      }

      const produto = await client.query(
        `SELECT "qty", "manage_stock" FROM "product"
         WHERE "product_id" = $1::int
         FOR UPDATE`,
        [productId]
      );
      const linhaProduto = linhaUnica(produto);
      if (linhaProduto === null) {
        throw new Error(`Produto ${productId} não encontrado.`);
      }

      const linhaInventario = linhaUnica(inventario);
      const quantidadeAtual = Number(linhaInventario.qty ?? 0);
      const gerenciaEstoque =
        linhaInventario.manage_stock === true && linhaProduto.manage_stock !== false;

      if (!gerenciaEstoque || delta === 0) {
        await client.query('COMMIT');
        return {
          productId,
          changed: false,
          previousQty: quantidadeAtual,
          qty: quantidadeAtual,
          appliedDelta: 0,
          clamped: false,
          reason: motivo
        };
      }

      const quantidadeDesejada = quantidadeAtual + delta;
      const quantidadeFinal = Math.max(0, quantidadeDesejada);
      const deltaAplicado = quantidadeFinal - quantidadeAtual;

      if (deltaAplicado !== 0) {
        await client.query(
          `UPDATE "product_inventory"
           SET "qty" = $2::int
           WHERE "product_inventory_product_id" = $1::int`,
          [productId, quantidadeFinal]
        );
        await client.query(
          `UPDATE "product"
           SET "qty" = $2::int
           WHERE "product_id" = $1::int`,
          [productId, quantidadeFinal]
        );
      }

      await client.query('COMMIT');
      return {
        productId,
        changed: deltaAplicado !== 0,
        previousQty: quantidadeAtual,
        qty: quantidadeFinal,
        appliedDelta: deltaAplicado,
        clamped: quantidadeDesejada < 0,
        reason: motivo
      };
    } catch (erro) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Não sobrescreve o erro original se o rollback também falhar.
      }
      throw erro;
    }
  });
}
