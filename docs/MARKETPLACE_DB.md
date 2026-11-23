# Banco de dados — integração Mercado Livre e Shopee BR

- Versão: 1.0 (2026-11-23)
- Escopo: modelo de dados, índices, retenção e invariantes da extensão
  `marketplace-bridge`.
- Implementação: `extensions/marketplace-bridge/src/migration/Version-1.0.0.js`
  e `extensions/marketplace-bridge/src/lib/db.js`.
- Referência de interfaces: `docs/ESPECIFICACAO_MARKETPLACES.md`, seções 5 e 6.

Este documento descreve código entregue, **não** uma migração executada. A
migration não foi aplicada a nenhum banco como parte desta fase.

## 1. Convenções gerais

| Item | Convenção |
| --- | --- |
| Esquema | O mesmoPostgreSQL da instalação EverShop; nenhum schema separado. |
| Nomes | Tabelas e colunas em `snake_case`, identificadores entre aspas duplas. |
| Chaves primárias | `INT GENERATED ALWAYS AS IDENTITY`, exceto `marketplace_oauth_state.state` (PK natural). |
| Datas | `TIMESTAMPTZ` com `DEFAULT CURRENT_TIMESTAMP`. |
| Dinheiro | Centavos inteiros em `BIGINT` (`price_cents`, `total_cents`); `NULL` significa "não informado", nunca `0` inventado. |
| Payloads | `JSONB`, já redacionados antes da gravação. |
| Acesso | Somente SQL parametrizado (`$1`, `$2`, ...); nenhuma interpolação de valor recebido de usuário ou API. |
| Conexões | `getConnection()` do pacote `@evershop/evershop`, sempre liberadas em `finally` via `withConnection()`. |
| Idempotência | `INSERT ... ON CONFLICT ... DO NOTHING/DO UPDATE` nas chaves de negócio exatas da especificação. |

### 1.1 Observação sobre o import de `getConnection()`

A especificação cita o arquivo
`@evershop/evershop/lib/postgres/connection.js`. No pacote instalado
(`@evershop/evershop@2.4.0`, verificado em 2026-11-23), o campo `exports` do
`package.json` publica esse arquivo como `@evershop/evershop/lib/postgres`; o
subcaminho `.../connection.js` **não** é exportado e causa
`ERR_PACKAGE_PATH_NOT_EXPORTED` em ESM. `lib/db.js` importa
`@evershop/evershop/lib/postgres` e registra a divergência em comentário,
conforme a cláusula "documentação oficial prevalece" da especificação.

## 2. Modelo de dados

### 2.1 `marketplace_account`

Uma linha por par marketplace/vendedor conectado.

| Coluna | Tipo | Observação |
| --- | --- | --- |
| `marketplace_account_id` | `INT IDENTITY PK` | Chave técnica. |
| `marketplace` | `VARCHAR(32) NOT NULL` | `mercadolivre` ou `shopee`. |
| `seller_id` | `VARCHAR(128) NOT NULL` | ID do vendedor no marketplace. |
| `shop_id` | `VARCHAR(128)` | ID da loja Shopee; `NULL` no Mercado Livre. |
| `site_id` | `VARCHAR(16)` | `MLB` quando aplicável. |
| `status` | `VARCHAR(32) NOT NULL DEFAULT 'connected'` | `'connected'` é o valor usado por `listConnectedAccounts()`. |
| `created_at`, `updated_at` | `TIMESTAMPTZ NOT NULL` | Auditoria local. |

**Único exato:** `(marketplace, seller_id)` —
`CONSTRAINT "MARKETPLACE_ACCOUNT_UNIQUE"`.

### 2.2 `marketplace_token`

Um envelope cifrado por par conta/tipo de token.

| Coluna | Tipo | Observação |
| --- | --- | --- |
| `marketplace_token_id` | `INT IDENTITY PK` | Chave técnica. |
| `account_id` | `INT NOT NULL` | FK para `marketplace_account`, `ON DELETE CASCADE`. |
| `token_type` | `VARCHAR(16) NOT NULL` | `access` ou `refresh`. |
| `encrypted_value` | `TEXT NOT NULL` | Resultado de `encryptSecret()`: `v1:<iv>:<tag>:<cipher>`. Nunca token em texto plano. |
| `expires_at` | `TIMESTAMPTZ` | `NULL` = sem expiração conhecida. |
| `scope` | `TEXT` | Escopos concatenados. |
| `generation` | `INT NOT NULL DEFAULT 1` | Avança a cada gravação. |
| `used_at` | `TIMESTAMPTZ` | Preenchido no refresh de uso único. |
| `created_at`, `updated_at` | `TIMESTAMPTZ NOT NULL` | Auditoria local. |

**Único exato:** `(account_id, token_type)` —
`CONSTRAINT "MARKETPLACE_TOKEN_UNIQUE"`.

### 2.3 `marketplace_oauth_state`

Estado imprevisível do OAuth, de uso único.

| Coluna | Tipo | Observação |
| --- | --- | --- |
| `state` | `VARCHAR(255) NOT NULL` | **PK natural**. Gerado pelo chamador com fontes criptográficas. |
| `marketplace` | `VARCHAR(32) NOT NULL` | Evita cruzamento de estados entre integrações. |
| `admin_user_id` | `INT` | Usuário administrativo que iniciou o fluxo. |
| `created_at` | `TIMESTAMPTZ NOT NULL` | Base da janela de expiração de 15 minutos. |
| `used_at` | `TIMESTAMPTZ` | `NULL` enquanto não consumido. |

**Único:** a própria PK em `state`.

### 2.4 `marketplace_listing`

Espelho local dos anúncios, um por SKU por vendedor.

| Coluna | Tipo | Observação |
| --- | --- | --- |
| `marketplace_listing_id` | `INT IDENTITY PK` | Chave técnica. |
| `marketplace`, `seller_id`, `sku` | `VARCHAR NOT NULL` | SKU já normalizado pelo chamador. |
| `product_id` | `INT` | ID do produto EverShop; sem FK para não acoplar a ordem das migrations. |
| `external_item_id` | `VARCHAR(128)` | ID do anúncio no marketplace. |
| `status` | `VARCHAR(32) NOT NULL DEFAULT 'draft'` | Estado local do anúncio. |
| `price_cents` | `BIGINT` | **Somente** `product.price` validado; `NULL` até haver preço publicável. |
| `quantity` | `INT NOT NULL DEFAULT 0` | Quantidade conhecida no anúncio. |
| `payload_hash` | `VARCHAR(128)` | Hash do payload para detectar mudanças. |
| `last_synced_at` | `TIMESTAMPTZ` | Última sincronização bem-sucedida. |
| `last_error` | `TEXT` | Último erro redacionado. |
| `created_at`, `updated_at` | `TIMESTAMPTZ NOT NULL` | Auditoria local. |

**Único exato:** `(marketplace, seller_id, sku)` —
`CONSTRAINT "MARKETPLACE_LISTING_UNIQUE"`.

### 2.5 `marketplace_order`

Pedidos de marketplace, separados dos pedidos do EverShop.

| Coluna | Tipo | Observação |
| --- | --- | --- |
| `marketplace_order_id` | `INT IDENTITY PK` | Chave técnica. |
| `marketplace`, `seller_id`, `external_order_id` | `VARCHAR NOT NULL` | Identificação externa do pedido. |
| `sku`, `product_id`, `quantity` | — | Linha do pedido; `quantity` default `0` quando não informada. |
| `total_cents` | `BIGINT` | Valor informado pelo marketplace; `NULL` se ausente. |
| `status` | `VARCHAR(32)` | Estado informado pelo marketplace. |
| `payload_redacted` | `JSONB NOT NULL DEFAULT '{}'::jsonb` | Nunca contém nome, CPF, e-mail, telefone ou endereço do comprador. |
| `imported_at` | `TIMESTAMPTZ NOT NULL` | Chegada ao banco local. |

**Único exato:** `(marketplace, seller_id, external_order_id)` —
`CONSTRAINT "MARKETPLACE_ORDER_UNIQUE"`.

### 2.6 `marketplace_event`

Eventos de webhook com dedupe e trilha de processamento.

| Coluna | Tipo | Observação |
| --- | --- | --- |
| `marketplace_event_id` | `INT IDENTITY PK` | Chave técnica. |
| `marketplace`, `dedupe_key` | `VARCHAR NOT NULL` | Chave determinística montada pelo chamador. |
| `topic`, `external_event_id` | `VARCHAR` | Metadados do fornecedor. |
| `payload_redacted` | `JSONB NOT NULL DEFAULT '{}'::jsonb` | Mesma regra de redação de `marketplace_order`. |
| `received_at` | `TIMESTAMPTZ NOT NULL` | Réplica do instante de recebimento. |
| `processed_at` | `TIMESTAMPTZ` | Preenchido apenas no sucesso. |
| `status` | `VARCHAR(32) NOT NULL DEFAULT 'pending'` | `pending`, `processed` ou `failed`. |
| `attempts` | `INT NOT NULL DEFAULT 0` | Incrementado por `markEventProcessed()`. |
| `last_error` | `TEXT` | Mensagem curta e redacionada. |

**Único exato:** `(marketplace, dedupe_key)` —
`CONSTRAINT "MARKETPLACE_EVENT_UNIQUE"`.

### 2.7 `marketplace_outbox`

Fila de operações pendentes de envio aos marketplaces.

| Coluna | Tipo | Observação |
| --- | --- | --- |
| `marketplace_outbox_id` | `INT IDENTITY PK` | Chave técnica. |
| `marketplace`, `operation`, `idempotency_key` | `VARCHAR NOT NULL` | A operação é o nome estável da ação (ex.: `update_stock`). |
| `payload` | `JSONB NOT NULL DEFAULT '{}'::jsonb` | Dados da operação, sem PII de comprador. |
| `status` | `VARCHAR(32) NOT NULL DEFAULT 'pending'` | `pending`, `processing`, `done`. |
| `attempts` | `INT NOT NULL DEFAULT 0` | Tentativas de envio. |
| `next_attempt_at` | `TIMESTAMPTZ NOT NULL` | Base do backoff. |
| `last_error` | `TEXT` | Mensagem curta e redacionada. |
| `created_at`, `updated_at` | `TIMESTAMPTZ NOT NULL` | Auditoria e recuperação de itens travados. |

**Único exato:** `(marketplace, idempotency_key)` —
`CONSTRAINT "MARKETPLACE_OUTBOX_UNIQUE"`.

### 2.8 `marketplace_sync_state`

Cursor de varreduras incrementais por conta.

| Coluna | Tipo | Observação |
| --- | --- | --- |
| `marketplace_sync_state_id` | `INT IDENTITY PK` | Chave técnica. |
| `marketplace`, `seller_id`, `kind` | `VARCHAR NOT NULL` | `kind` ex.: `orders`, `listings`, `inventory`. |
| `cursor` | `TEXT` | Valor opaco devolvido pela API; `NULL` = início. |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | Última atualização do cursor. |

**Único exato:** `(marketplace, seller_id, kind)` —
`CONSTRAINT "MARKETPLACE_SYNC_STATE_UNIQUE"`.

## 3. Índices

Todos criados com `CREATE INDEX IF NOT EXISTS`.

| Tabela | Índice | Colunas | Finalidade |
| --- | --- | --- | --- |
| `marketplace_account` | `MARKETPLACE_ACCOUNT_STATUS_IDX` | `marketplace, status` | Listar contas conectadas. |
| `marketplace_account` | `MARKETPLACE_ACCOUNT_SHOP_IDX` | `marketplace, shop_id` | Busca por loja Shopee. |
| `marketplace_token` | `MARKETPLACE_TOKEN_EXPIRES_IDX` | `expires_at` | Renovação/auditoria de expiração. |
| `marketplace_oauth_state` | `MARKETPLACE_OAUTH_STATE_CREATED_IDX` | `created_at` | Limpeza por idade. |
| `marketplace_oauth_state` | `MARKETPLACE_OAUTH_STATE_MARKETPLACE_IDX` | `marketplace` | Inspeção por integração. |
| `marketplace_listing` | `MARKETPLACE_LISTING_SELLER_STATUS_IDX` | `marketplace, seller_id, status` | Varredura de anúncios por conta. |
| `marketplace_listing` | `MARKETPLACE_LISTING_EXTERNAL_ITEM_IDX` | `external_item_id` | Reconciliação por ID externo. |
| `marketplace_listing` | `MARKETPLACE_LISTING_PRODUCT_IDX` | `product_id` | Busca inversa por produto EverShop. |
| `marketplace_listing` | `MARKETPLACE_LISTING_SYNCED_IDX` | `last_synced_at` | Seleção de itens defasados. |
| `marketplace_order` | `MARKETPLACE_ORDER_IMPORTED_IDX` | `marketplace, seller_id, imported_at` | Varredura temporal de pedidos. |
| `marketplace_order` | `MARKETPLACE_ORDER_SKU_IDX` | `sku` | Relação pedido ↔ SKU. |
| `marketplace_order` | `MARKETPLACE_ORDER_STATUS_IDX` | `status` | Conciliação de estados. |
| `marketplace_event` | `MARKETPLACE_EVENT_STATUS_RECEIVED_IDX` | `marketplace, status, received_at` | Fila de eventos pendentes. |
| `marketplace_event` | `MARKETPLACE_EVENT_EXTERNAL_ID_IDX` | `external_event_id` | Rastreio do evento externo. |
| `marketplace_outbox` | `MARKETPLACE_OUTBOX_CLAIM_IDX` | `marketplace, status, next_attempt_at, created_at` | `claimNextOutbox()` com SKIP LOCKED. |
| `marketplace_outbox` | `MARKETPLACE_OUTBOX_CREATED_IDX` | `created_at` | Limpeza por idade. |
| `marketplace_sync_state` | `MARKETPLACE_SYNC_STATE_KIND_IDX` | `marketplace, kind` | Inspeção de cursores. |

Os índices dos pares únicos já existem implicitamente por meio das
constraints `UNIQUE`/PK correspondentes.

## 4. Invariantes

1. **Idempotência.** Anúncio por `(marketplace, seller_id, sku)`, pedido por
   `(marketplace, seller_id, external_order_id)`, evento por
   `(marketplace, dedupe_key)` e outbox por `(marketplace, idempotency_key)`.
   Inserções duplicadas não geram linha nova nem erro: eventos e outbox devolvem
   `{ inserted: false, duplicate: true, row: <linha existente> }`, mantendo a
   linha para a conferência de conflito feita por `lib/events.js` e
   `lib/outbox.js`. Um erro PG `23505` também é interpretado como duplicidade.
   `insertOrderIfAbsent()` mantém o formato antigo: retorna a linha inserida ou
   `null` quando o pedido já existe.
2. **Preço.** `price_cents`/`total_cents` começam `NULL`; o código nunca
   preenche `0` automaticamente. A única fonte é `product.price` validada por
   `lib/pricing.js`. `price <= 0` ou nulo bloqueia a publicação.
3. **Tokens.** Nenhum segredo em texto plano. `encrypted_value` recebe o
   envelope cifrado; `getActiveToken()` ignora tokens usados ou expirados;
   `markTokenUsed()` + `saveToken()` implementam refresh de uso único com
   `generation + 1`.
4. **OAuth.** `consumeOAuthState()` é uma atualização condicional atômica:
   state correto, marketplace correto, não usado e com menos de 15 minutos.
5. **Webhooks.** `insertEventIfAbsent()` grava antes de responder 2xx; o
   processamento é assíncrono; `markEventProcessed()` registra sucesso ou
   falha sem mensagens que contenham segredos.
6. **Redação.** `payload_redacted` e `payload` passam por remoção defensiva de
   chaves `buyer*`, `customer*`, `recipient*`, `shipping_address*`,
   `billing_address*`, além de `cpf`, `cnpj`, `email`, `phone`, `address` e
   afins, e por redação de e-mails/CPFs formatados em texto livre. Quem monta
   o payload continua responsável por não incluir PII em campos de texto.
7. **Estoque.** `adjustEverShopStock()` usa `BEGIN`/`COMMIT`/`ROLLBACK`, trava
   `product_inventory` e depois `product`, só altera quantidade quando
   `product_inventory.manage_stock = true` **e** `product.manage_stock !== false`,
   espelha o novo valor nas duas tabelas e nunca deixa quantidade negativa
   (`GREATEST` lógico em JavaScript). Não cria pedido no EverShop e não mexe
   em `stock_availability` nem no modo "sob consulta".
8. **Outbox.** `claimNextOutbox()` usa `FOR UPDATE SKIP LOCKED` e reserva no
   máximo 100 itens por chamada (padrão 20); itens `processing` há mais de 10
   minutos voltam a ser elegíveis, cobrindo workers que morreram sem limpar.
   `markOutboxFailed()` mantém o item em `pending` com backoff linear de 1 a
   10 minutos — não existe dead-letter automática nesta versão.
9. **Concorrência.** Nenhuma constraint `CHECK` foi adicionada a campos de
   status: os valores são contrato entre os adaptadores e os serviços, e uma
   restrição rígida poderia rejeitar estados legítimos de outro marketplace.

## 5. Contrato das funções de `lib/db.js`

Regra geral: funções de leitura/escrita de uma única linha retornam a linha
(`object`) ou `null`. Exceções estão marcadas abaixo. `getSyncCursor()` retorna
a **linha** com o campo `.cursor` (ou `null`), não o valor do cursor solto.

| Função | Retorno / comportamento |
| --- | --- |
| `withConnection(fn)` | Obtém o client, executa `fn(client)` e chama `release()` em `finally`. |
| `getAccount(marketplace, sellerId)` | Conta ou `null`. |
| `upsertAccount({...})` | Insere/atualiza; campos omitidos preservam o valor anterior. |
| `listConnectedAccounts(marketplace)` | `array` de contas com `status = 'connected'`. |
| `saveToken({...})` | Grava token cifrado; avança `generation`; limpa `used_at`. |
| `getActiveToken({ accountId, type })` | Token não usado e não expirado, de maior geração. |
| `markTokenUsed(tokenId)` | Preenche `used_at` uma vez. |
| `getListing(marketplace, sellerId, sku)` | Anúncio ou `null`. |
| `upsertListing({...})` | Insere/atualiza; `lastError` só muda se a chave foi informada. |
| `insertOrderIfAbsent({...})` | Linha inserida ou `null` se o pedido já existir. |
| `insertEventIfAbsent({...})` | `{ inserted, duplicate, row }`; em duplicidade, `row` é a linha existente. |
| `markEventProcessed(eventId, error)` | `processed`/`failed`, incrementa `attempts`; aceita `Error` ou mensagem em string. |
| `insertOutboxIfAbsent({...})` | `{ inserted, duplicate, row }`; em duplicidade, `row` é a linha existente. |
| `claimNextOutbox({ marketplace, limit })` | `array` de `{ id, operation, marketplace, idempotency_key, payload, attempts, status, next_attempt_at }`; `marketplace` opcional. |
| `markOutboxDone(outboxId)` | Marca `done` e limpa `last_error`. |
| `markOutboxFailed(outboxId, error)` | Registra erro e reagenda com backoff; aceita `Error` ou string. |
| `getSyncCursor(marketplace, sellerId, kind)` | Linha com `.cursor` ou `null`. |
| `setSyncCursor(marketplace, sellerId, kind, cursor)` | Grava cursor opaco; `NULL` permitido. |
| `saveOAuthState({ state, marketplace, adminUserId })` | Grava/recria estado não usado. |
| `consumeOAuthState(state, marketplace)` | Consumo atômico e janela de 15 min. |
| `adjustEverShopStock({ productId, delta, reason })` | Ajuste transacional; devolve `{ productId, changed, previousQty, qty, appliedDelta, clamped, reason }`. |

`row` devolvido por `insertEventIfAbsent()` contém os aliases `id` e `event_id`
para `marketplace_event_id`; `row` de `insertOutboxIfAbsent()` contém `id` e
`outbox_id` para `marketplace_outbox_id`. As colunas reais do banco não foram
renomeadas. `id` em `claimNextOutbox()` é o mesmo `marketplace_outbox_id` e
deve ser passado a `markOutboxDone()`/`markOutboxFailed()`.

## 6. Retenção

As regras abaixo são **política sugerida**, não rotina implementada nesta
migration. Nenhuma exclusão automática é feita por `lib/db.js`; a limpeza deve
ser implementada por job explícito, com aprovação da empresa e registro em
`docs/OBSERVABILIDADE_MARKETPLACES.md`.

| Tabela |critério| Sugestão |
| --- | --- | --- |
| `marketplace_oauth_state` | `used_at IS NOT NULL` ou `created_at` antigo | 24 horas |
| `marketplace_token` | Conta desconectada/revogada | 30 dias após revogação; nunca apagar token ativo |
| `marketplace_event` | `status IN ('processed','failed')` | 90 dias |
| `marketplace_outbox` | `status = 'done'` | 30 dias; itens `pending` antigos exigem investigação |
| `marketplace_listing` | Anúncio encerrado | Manter enquanto necessário à reconciliação; reavaliar após 180 dias |
| `marketplace_order` | Pedidos importados | Conforme política fiscal/contábil da empresa; não excluir por padrão |
| `marketplace_sync_state` | Cursor | Manter; reiniciar explicitamente quando necessário |
| `marketplace_account` | Conta | Manter enquanto a integração existir |

Antes de qualquer limpeza, conferir a política de LGPD da instalação
(`docs/LGPD_MARKETPLACES.md`, de responsabilidade de outro agente).

## 7. Dependências e pontos de atenção

- A migration depende apenas do runner de migrations do EverShop; não depende
  de tabelas da extensão criadas por outros agentes. A FK de
  `marketplace_token` referencia `marketplace_account`, criada no mesmo arquivo
  e antes dela.
- `adjustEverShopStock()` depende das tabelas core `product` e
  `product_inventory` (presentes no EverShop 2.4) e lê `manage_stock` das duas.
- `listConnectedAccounts()` considera `status = 'connected'`; adaptadores que
  gravarem outro valor devem alinhar a convenção.
- `saveToken()` espera o envelope já cifrado. A criptografia e o carregamento
  da chave são de responsabilidade de `lib/crypto.js` e `lib/secrets.js`.
- `insertEventIfAbsent()`, `insertOrderIfAbsent()` e `insertOutboxIfAbsent()`
  recebem payloads já redacionados; a remoção defensiva descrita em §4 é
  camada adicional, não substituto da redação na origem.
- Os formatos de retorno de `insertEventIfAbsent()`, `insertOutboxIfAbsent()`,
  `claimNextOutbox()`, `markEventProcessed()`, `markOutboxDone()` e
  `markOutboxFailed()` foram alinhados aos consumidores
  `src/lib/events.js` e `src/lib/outbox.js` (agente 10). Nenhum arquivo de
  outro dono foi alterado para esse alinhamento.
- `markOutboxFailed()` não gera dead-letter;监控 de `attempts` elevados deve
  ser feito pela observabilidade (agente responsável por
  `docs/OBSERVABILIDADE_MARKETPLACES.md`).
