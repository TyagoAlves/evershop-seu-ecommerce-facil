# Fluxos obrigatórios — integração Mercado Livre e Shopee BR (Fase 3)

- Versão: 1.0 (2026-11-23)
- Base absoluta: a raiz do repositório da instalação, conforme `docs/AGENT_CONTRACT_MARKETPLACES.md`.
- Natureza: documento complementar de arquitetura e comportamento. **Não altera assinaturas**, tabelas nem a `docs/ESPECIFICACAO_MARKETPLACES.md`, que continua sendo o contrato de interfaces.
- Contratos de origem: `docs/AGENT_CONTRACT_MARKETPLACES.md` e `docs/ESPECIFICACAO_MARKETPLACES.md`.
- Idioma: português do Brasil. Identificadores técnicos (`sku`, `listing_type_id`, `item_status`, rotas, nomes de tabelas e funções) permanecem como na API/documentação oficial.
- Escopo: descreve o comportamento esperado dos seis fluxos obrigatórios (anúncio, pedido, estoque, reconciliação, renovação de token e recuperação por `missed_feeds`). Nenhum fluxo aqui autoriza criar anúncio, pedido, autorizar aplicativo, chamar API real, migrar banco ou publicar algo.

## Convenção sobre os exemplos

Os exemplos deste documento usam somente marcadores genéricos (`<sku>`, `<id>`, `<dominio-da-empresa>`, `<app_id>`). Não há preço de exemplo, dado de empresa, domínio, telefone ou credencial real. Quando o texto diz "preço", ele se refere exclusivamente a `product.price` do EverShop, validado por `assertPublishablePrice`.

---

## 0. Premissas, estados e regras transversais

### 0.1 Premissas de segurança (falha fechada)

Todo fluxo começa com as mesmas quatro guardas. Se qualquer uma falhar, o fluxo **para**, registra um evento de bloqueio com `last_error` semanticamente seguro e **não chama nenhuma API** de marketplace:

1. A extensão `marketplace-bridge` está habilitada em `config/default.json` (hoje: `false`).
2. Existe config da empresa (`COMPANY_SLUG` -> `companies/<slug>.marketplaces.json`), com `schema: 1` e `enabled: true` no bloco da marketplace (hoje: `false`).
3. `requireSecrets(marketplace)` encontrou todas as variáveis de ambiente necessárias, sem valores no Git.
4. A conta está conectada, com token válido e `site_id` compatível (MLB para Mercado Livre; `region: BR` para Shopee).

Regras adicionais de falha fechada:

- `publishAllowed: false` **ou** `publishSkus` vazio => nenhum anúncio é criado ou atualizado. Lista vazia **nunca** significa "todos os SKUs".
- `product.price` nulo, `0` ou negativo => `PriceNotAvailableError`. Produtos "sob consulta" da loja própria permanecem fora dos marketplaces; nenhum preço é inferido, arredondado para cima ou inventado.
- `categoryMap` sem `categoryId`/`listingTypeId` configurado para o SKU => bloqueio antes de montar o payload.
- Shopee `item_status` permanece `UNLIST` até autorização humana explícita; o código nunca ativa um anúncio por conta própria.
- Nenhuma rotina deste documento faz `DELETE` ou apaga registro local, remoto, evento, outbox ou cursor.

### 0.2 Chaves determinísticas (idempotência)

| Finalidade | Chave | Onde é aplicada |
|---|---|---|
| Anúncio | `marketplace + seller_id + sku` | `marketplace_listing` e `getListing` |
| Pedido | `marketplace + seller_id + external_order_id` | `marketplace_order` via `insertOrderIfAbsent` |
| Evento de webhook / recuperação | `marketplace + dedupe_key` | `marketplace_event` via `insertEventIfAbsent` |
| Operação na fila | `marketplace + operation + sku + externalId` | `makeIdempotencyKey` / `insertOutboxIfAbsent` |
| OAuth | `state` imprevisível, gravado antes do redirecionamento | `saveOAuthState` / `consumeOAuthState`, uso único |

A chave é calculada sempre a partir de dados normalizados (`normalizeSku`: `trim` + maiúsculas). A mesma chave deve ser reutilizada em todas as tentativas; **nunca** gerar uma chave nova para reenviar a mesma operação.

### 0.3 Estados lógicos

Os nomes abaixo são os valores canônicos sugeridos para as colunas `status` das tabelas da extensão. Se a implementação adotar nomes diferentes, a equivalência deve ser registrada em `docs/MARKETPLACE_DB.md` (dono do banco) para que logs, admin e este documento continuem alinhados.

| Entidade | Estados | Sentido |
|---|---|---|
| `marketplace_account` | `CONECTADA`, `DESAUTORIZADA`, `REAUTORIZAR`, `SUSPENSA` | `REAUTORIZAR` impede novas chamadas até novo OAuth. |
| `marketplace_oauth_state` | `PENDENTE`, `CONSUMIDO` | `consumeOAuthState` só aceita `PENDENTE`. |
| `marketplace_token` | `VALIDA`, `EM_RENOVACAO`, `INUTILIZADA` | `generation` aumenta a cada rotação; `used_at` marca uso único. |
| `marketplace_listing` | `VALIDADO`, `NA_FILA`, `EM_PROCESSAMENTO`, `PUBLICADO`, `PAUSADO`, `ERRO_PUBLICACAO`, `DIVERGENTE` | `PUBLICADO` significa "anúncio remoto reconhecido", não "loja autorizada a vender". |
| `marketplace_event` | `RECEBIDO`, `PROCESSANDO`, `PROCESSADO`, `FALHA` | Duplicata não gera novo registro: `insertEventIfAbsent` retorna o existente. |
| `marketplace_outbox` | `PENDENTE`, `EM_PROCESSAMENTO`, `CONCLUIDO`, `FALHOU` | `attempts` e `next_attempt_at` controlam retentativas. |

### 0.4 Retries

| Classe de erro | Comportamento |
|---|---|
| Guarda de configuração, preço, permissão ou category map | **Sem retry**. Falha fechada, estado de bloqueio. Só muda após configuração/catálogo ser corrigido. |
| `429`, `5xx`, timeout em `requestJson` | Retentativas com backoff (`retries = 2` por padrão) e respeito a `Retry-After`. Após esgotar, vai para `outbox.FALHOU` com `next_attempt_at`. |
| `4xx` que não seja `429` | Sem retry automático. Registrar `last_error`; `401/403` coloca a conta em `REAUTORIZAR`. |
| Refresh token já consumido | Sem retry com o mesmo token. Conta vai para `REAUTORIZAR`. |
| `IdempotencyConflictError` | Interpretar como "operação já registrada": confirmar estado local e encerrar sem duplicar efeito. |
| Falha transacional ao importar pedido | Rollback completo, evento volta para `FALHA` e será reprocessado; nunca ajustar estoque sem a confirmação da inserção do pedido. |

### 0.5 Registro em log — sem vazamento

**Permitido registrar:** `marketplace`, `operation`, `topic`, `sku` normalizado, `externalItemId`, `externalOrderId` opaco, `sellerId` opaco, `idempotencyKey` (ou seu hash), `correlationId`, `requestId` devolvido pela API, status HTTP, `attempts`, duração em milissegundos, `generation` do token, `expiresAt`, motivo do bloqueio e contadores agregados.

**Nunca registrar:** token de acesso ou refresh, `client_secret`, `partner_key`, chave de criptografia, `state` do OAuth, assinatura ou base string da Shopee, query string com segredos, payload bruto de notificação ou pedido, `request.data` devolvido pelo `missed_feeds`, e qualquer nome, CPF, e-mail, telefone ou endereço do comprador. Use `redact(value)` antes de qualquer interpolação e `payloadRedacted` no banco. Mensagens de erro devem ser curtas e sem dados sensíveis.

Exemplo de linha segura (marcadores, sem dados reais):

```
[mp] fluxo=anuncio marketplace=mercadolivre seller=<id> sku=<sku> etapa=preco resultado=bloqueio motivo=price_not_available correlation=<id>
[mp] fluxo=pedido marketplace=shopee evento=<id> tema=orders resultado=processado duracao_ms=<n> correlation=<id>
```

---

## 1. Fluxo de anúncio

**Objetivo:** transformar um produto elegível do catálogo em um registro local `marketplace_listing` e, somente após autorização, em um anúncio remoto — sem publicar preço inventado e sem duplicar anúncio.

### 1.1 Diagrama textual

```
[config da empresa]
        |
        v
[OAuth: state -> callback -> troca de código] --falha--> evento + log, sem API
        |
        v
[conta: getSellerIdentity -> upsertAccount] --site inválido--> bloqueio
        |
        v
[catálogo: getProductsForMarketplace / normalizeSku]
        |
        v
[assertPublishablePrice] --price <= 0/nulo--> PriceNotAvailableError (falha fechada)
        |
        v
[canPublish: publishAllowed && publishSkus && categoryMap] --falso--> bloqueio
        |
        v
[mapProductToPayload: payload completo, sem variations no modelo User Products]
        |
        v
[makeIdempotencyKey -> insertOutboxIfAbsent] --já existe--> reaproveitar chave
        |
        v
[processOutbox -> adapter createListing/updateListing]
        |
        +-- 429/5xx -> retry com backoff -> FALHOU com next_attempt_at
        +-- 4xx -> sem retry, last_error, REAUTORIZAR se 401/403
        |
        v
[upsertListing: externalItemId, status, priceCents, quantity, payloadHash] -> CONCLUIDO
```

### 1.2 Passo a passo

1. **Configuração.** `readMarketplaceConfig()` + `getMarketplaceSettings(marketplace)` + `isEnabled(marketplace)`. Ausência de arquivo ou `enabled: false` encerra o fluxo como `NAO_CONFIGURADO`/`DESATIVADO`, sem log de erro (é estado normal).
2. **OAuth.** `saveOAuthState({ state, marketplace, adminUserId })` antes de `getAuthorizationUrl(state)`. No callback: `consumeOAuthState(state, marketplace)` (uso único) -> `exchangeCode(...)` -> `getSellerIdentity(accessToken)`. Redirect URI exatamente a cadastrada e HTTPS. Qualquer divergência de `state` invalida a tentativa.
3. **Conta.** Exigir `site_id === "MLB"` (ML) e `region: "BR"` (Shopee). Detectar tag `user_product_seller` no ML. `upsertAccount({ marketplace, sellerId, ... })` com `status: CONECTADA`. Tokens são gravados por `saveToken` já criptografados (`encryptSecret`). Nunca reutilizar credenciais, seller id ou shop id de outra empresa.
4. **Catálogo.** `getProductsForMarketplace({ limit, offset, skus })` (filtra `status = true AND visibility = true`) e `getProductBySku` quando necessário. `normalizeSku` remove variação de caixa/espaço. `product.price` é a única fonte de preço.
5. **`assertPublishablePrice(product)`.** Se `price` for nulo, `0` ou negativo, lança `PriceNotAvailableError`. Registrar bloqueio com `sku`, `marketplace` e motivo; **não** criar outbox e **não** chamar API. Isto preserva os itens "sob consulta" da loja própria.
6. **`canPublish(marketplace, sku)`.** Só retorna verdadeiro se `publishAllowed === true`, `publishSkus` contém o SKU e o mapeamento de categoria (`categoryMap`) está completo. `attributeMap`, quando necessário, completa os atributos; valores não configurados bloqueiam.
7. **Mapeamento.** `mapProductToPayload` usa `normalizeText`, `getProductImages` e `buildStoreUrl(urlKey)`. No ML: um item por SKU com `seller_custom_field`, sem array `variations` (modelo User Products); em atualização de preço, buscar o item completo e enviar o payload completo — enviar somente `price` resulta em HTTP 400 desde 18/03/2026. Na Shopee: `original_price > 0`, duas casas decimais e `item_status: UNLIST` por padrão.
8. **Fila.** `enqueue({ marketplace, operation, sku, externalId, payload })` -> `makeIdempotencyKey` -> `insertOutboxIfAbsent`. Se a chave já existir, não inserir de novo: a operação original é a fonte da verdade. `marketplace_listing` passa para `NA_FILA`.
9. **Adapter.** `processOutbox` -> `claimNextOutbox` -> `createListing` (quando não há `externalItemId`) ou `updateListing`. `requestJson` aplica timeout/backoff. `payloadHash` evita reenvio de payload idêntico.
10. **Registro final.** `upsertListing({ ..., externalItemId, status: PUBLICADO, priceCents, quantity, payloadHash })` e `markOutboxDone`. Em falha: `markOutboxFailed(outboxId, error)`, `upsertListing(..., lastError: motivo_seguro, status: ERRO_PUBLICACAO)` e `marketplace_event` de falha. Nunca apagar a linha nem a fila.

### 1.3 Estados e falhas fechadas

| Situação | Estado do listing | Ação |
|---|---|---|
| Config desativada | `VALIDADO` (ou inexistente) | Nenhuma chamada; sem erro. |
| OAuth inválido / conta `REAUTORIZAR` | bloqueado | Evento de bloqueio; nova autorização necessária. |
| `price <= 0` ou nulo | bloqueado | `PriceNotAvailableError`; nenhum payload, nenhuma fila. |
| `canPublish === false` | bloqueado | Nenhum payload; registrar sku e motivo. |
| Erro transitório esgotado | `ERRO_PUBLICACAO` | Outbox `FALHOU` com `next_attempt_at`; nova tentativa reusa a chave. |
| Anúncio removido remotamente | `DIVERGENTE` | Reconciliação registra; não apagar registro local. |

---

## 2. Fluxo de pedido

**Objetivo:** aceitar a notificação rapidamente, consultar o estado real do pedido na API, importá-lo uma única vez e ajustar o estoque do EverShop de forma transacional — sem criar pedido na loja própria e sem duplicar baixa.

### 2.1 Diagrama textual

```
[webhook POST]
   |
   v
[verifyWebhook] --inválido--> 4xx curto + evento de rejeição (sem escrita de pedido)
   |
   v
[dedupeKey -> insertEventIfAbsent] --já existe--> 200 imediato, sem reprocessar
   |
   v
[gravar marketplace_event RECEBIDO (payloadRedacted)] --> HTTP 200/2xx em < 500 ms (ML)
   |
   v  (assíncrono: processador de eventos)
[parseNotification -> getOrderDetail]  <-- sempre consulta o recurso, não confia no push
   |
   v
[transação: insertOrderIfAbsent -> (se inseriu) adjustEverShopStock(delta negativo, reason)]
   |        \-- rollback em qualquer falha; evento volta a FALHA
   v
[markEventProcessed(eventId)] -> PROCESSADO
```

### 2.2 Passo a passo

1. **Validação.** `verifyWebhook` do adaptador (dono de ML: agente 13; dono da Shopee: agente 16) confere a autenticidade da chamada com o segredo configurado. Se falhar, responder erro curto, registrar `WebhookVerificationError` com redação e **não** gravar pedido.
2. **Dedupe.** Montar `dedupe_key` determinística a partir da marketplace e do identificador externo do evento/tópico (ML `_id` ou equivalente; Shopee `ordersn` + tipo de push). `insertEventIfAbsent({ marketplace, dedupeKey, topic, externalEventId, payloadRedacted })`. Se o registro já existir, responder 2xx e encerrar: duplicata não é erro.
3. **Resposta rápida.** Persistir o evento como `RECEBIDO` e responder HTTP 200 em até **500 ms** no Mercado Livre (e 2xx no push da Shopee). Regras oficiais: novas tentativas durante cerca de 1 hora e, após a oitava tentativa sem 200, a mensagem entra no `missed_feeds`. Nada de consulta à API, cálculo de preço ou ajuste de estoque neste trecho.
4. **Processamento assíncrono.** O processador de eventos marca `PROCESSANDO`, usa `parseNotification` apenas para descobrir `topic`/`resource`, e chama `getOrderDetail` para obter o estado **atual** do pedido. Isto tolera eventos repetidos e fora de ordem.
5. **Importação.** `insertOrderIfAbsent({ marketplace, sellerId, externalOrderId, sku, productId, quantity, totalCents, status, payloadRedacted })`. A função informa se a linha foi realmente inserida; `totalCents` vem do pedido remoto, nunca de cálculo local de preço.
6. **Estoque transacional.** **Somente se o pedido foi inserido agora**, chamar `adjustEverShopStock({ productId, delta: -quantity, reason })`. Inserção e ajuste devem pertencer à mesma transação (via `withConnection` do `lib/db.js`; a composição exata é responsabilidade do dono do banco). `adjustEverShopStock` respeita `manage_stock`, nunca deixa quantidade negativa e atualiza `product_inventory.qty` e `product.qty`. Se o pedido já existia, **não** ajustar estoque outra vez.
7. **Fechamento.** `markEventProcessed(eventId)` com `PROCESSADO`. Em qualquer falha, `markEventProcessed(eventId, erro_seguro)` -> `FALHA`, com `attempts` e `next_attempt_at`; a retentativa refaz a consulta ao detalhe e a dedupe, sem duplicar efeito.
8. **Cancelamentos e devoluções.** Eventos de cancelamento seguem o mesmo caminho, com `delta` positivo quando `inventory.restoreOnCancel === true`. `reserveOnOrder` e `deductOnShip` definem o momento da baixa; se ambos estiverem ativos para o mesmo pedido, a dedupe por `externalOrderId` impede duas baixas.
9. **Preservação da loja.** O pedido de marketplace fica apenas em `marketplace_order`. Não criar pedido no EverShop, não alterar `product.price`, visibilidade, SEO, WhatsApp ou o modo "sob consulta" da loja própria. `payload_redacted` nunca contém dados do comprador.

### 2.3 Estados

| Entidade | Estados | Observação |
|---|---|---|
| Evento | `RECEBIDO` -> `PROCESSANDO` -> `PROCESSADO` / `FALHA` | Duplicata não gera segundo evento. |
| Pedido | importado, estoque ajustado, cancelado/restaurado | Regido por `status` e `insertOrderIfAbsent`; nunca reimportado. |

---

## 3. Fluxo de estoque

**Objetivo:** propagar a quantidade do EverShop para os anúncios conectados com `update_stock` idempotente, sem estoque negativo e sem recriar anúncio.

### 3.1 Diagrama textual

```
[mudança em product_inventory OU cron sync-inventory]
        |
        v
[getProductsForMarketplace -> qty atual, manage_stock]
        |
        v
[comparar com marketplace_listing.quantity + externalItemId]
        |
        +-- convergido -> sem operação (sucesso sem chamada)
        |
        v
[guardas: manage_stock, qty >= 0, listing publicado, flags de inventory]
        |
        v
[enqueue operação update_stock -> chave marketplace+operation+sku+externalId]
        |
        v
[adapter updateStock] --429/5xx--> backoff / FALHOU com next_attempt_at
        |
        v
[upsertListing(quantity nova) -> markOutboxDone] -> CONCLUIDO
```

### 3.2 Passo a passo

1. **Gatilho.** Uma mudança detectada em `product_inventory` ou o cron `sync-inventory` (`inventoryCron`). O cron usa `getSyncCursor`/`setSyncCursor` para não reprocessar tudo a cada execução.
2. **Leitura.** `getProductsForMarketplace({ skus })` fornece `qty`, `manage_stock` e `stock_availability`. Produtos com `manage_stock = false` não têm estoque gerenciado: registrar "sem operação", não inventar quantidade.
3. **Comparação.** Para cada `(marketplace, seller_id, sku)`, comparar `qty` com `marketplace_listing.quantity`. Se forem iguais e houver `externalItemId`, encerrar sem chamar a API — isto é idempotência por convergência.
4. **Guardas.** Nunca enviar quantidade negativa; nunca criar anúncio neste fluxo; exigir `externalItemId`. Respeitar `inventory.reserveOnOrder`, `deductOnShip` e `restoreOnCancel` para não competir com o fluxo de pedido.
5. **Fila.** `enqueue({ marketplace, operation: "update_stock", sku, externalId, payload: { quantity } })`. A chave é determinística; reenviar a mesma quantidade reaproveita a chave. Se a quantidade mudou antes do consumo, recalcular e atualizar o payload sem trocar a chave (última quantidade conhecida vence).
6. **Adapter.** `updateStock` por marketplace. Retentativas de `429/5xx` usam o mesmo `idempotency_key`. `4xx` sem retry; `401/403` -> conta `REAUTORIZAR`.
7. **Confirmação.** `upsertListing` com a nova `quantity` e `last_synced_at`, depois `markOutboxDone`. Falha -> `markOutboxFailed`, listing `DIVERGENTE` e evento de divergência para a reconciliação.
8. **Corrida com pedidos.** Se o fluxo de pedido e o cron ajustarem o mesmo SKU ao mesmo tempo, a chave por SKU mais a comparação no momento do consumo evitam dupla baixa; a reconciliação detecta qualquer resíduo sem apagar nada.

### 3.3 Estados e log

- Listing: `PUBLICADO` -> `DIVERGENTE` -> `PUBLICADO` após convergência; `ERRO_PUBLICACAO` permanece até intervenção.
- Outbox: `PENDENTE` -> `EM_PROCESSAMENTO` -> `CONCLUIDO` / `FALHOU`.
- Log: `sku`, `marketplace`, `externalItemId`, quantidade anterior e nova, `idempotencyKey`, resultado e duração. Sem dados de comprador e sem payload bruto.

---

## 4. Reconciliação sem apagar nada

**Objetivo:** detectar divergência entre o estado remoto e as tabelas locais, registrar e, quando seguro, enfileirar correção. **Nenhuma remoção automática.**

### 4.1 Diagrama textual

```
[cron reconcile / execução manual: run({ marketplace, limit })]
        |
        v
[listConnectedAccounts(marketplace)] -> para cada conta conectada
        |
        +-- anúncios remotos (findListingBySku / leitura paginada) vs marketplace_listing
        +-- pedidos remotos (fetchRecentOrders / getOrderDetail) vs marketplace_order
        |
        v
[classificar divergência] -> marketplace_event + log agregado
        |
        +-- AUSENTE_REMOTO / AUSENTE_LOCAL -> somente registrar
        +-- PRECO / QUANTIDADE -> revalidar guardas -> enfileirar correção
        |
        v
[setSyncCursor(..., kind = 'reconcile')] -> fim (sem DELETE)
```

### 4.2 Regras

1. Iterar somente contas `CONECTADA`. Contas `REAUTORIZAR` são ignoradas e sinalizadas.
2. Usar `getSyncCursor`/`setSyncCursor` por `(marketplace, sellerId, kind)` e paginar com `limit` de `config.sync.batchSize`.
3. Classificação e ação:

| Divergência | Ação |
|---|---|
| `SEM_DIVERGENCIA` | Nenhuma. |
| `PRECO_DIVERGENTE` | Reler `product.price`, executar `assertPublishablePrice`, exigir `canPublish`. Se passar, enfileirar `update_price` com payload **completo** (ML exige payload completo desde 18/03/2026). Se falhar, bloquear e registrar. |
| `QUANTIDADE_DIVERGENTE` | Reler `qty` do EverShop e enfileirar `update_stock`, respeitando o fluxo 3. |
| `LISTING_AUSENTE_LOCAL` | Registrar; criar somente se `canPublish` permitir e houver autorização. Nunca assumir "criar tudo". |
| `LISTING_AUSENTE_REMOTO` | Registrar `DIVERGENTE`; **não** apagar `marketplace_listing` e **não** recriar anúncio automaticamente. |
| `PEDIDO_AUSENTE_LOCAL` | Enfileirar importação via `getOrderDetail` -> fluxo 2. |
| `PEDIDO_AUSENTE_REMOTO` | Somente registrar; não apagar `marketplace_order`. |

4. Correções passam pelas mesmas guardas do fluxo de anúncio e pela mesma chave de idempotência; reconciliar nunca é atalho para burlar `publishAllowed`/`publishSkus`.
5. O modo padrão é **somente leitura + registro** enquanto a extensão estiver desativada. Não há "consertar tudo" automático.
6. Log: contagem por classe de divergência, `marketplace`, `sellerId` opaco, intervalo do cursor e duração. Nunca listar payloads nem dados de comprador.

### 4.3 Estados

`DIVERGENTE_DETECTADO` -> `CORRECAO_NA_FILA` -> `CONCORDA` / `SEM_ACAO` / `PENDENTE_AUTORIZACAO`. O estado `SEM_ACAO` é terminal legítimo: ausência remota não autoriza remoção local.

---

## 5. Renovação de token de uso único

**Objetivo:** renovar tokens antes do vencimento sem reutilizar refresh token, sem corrida entre processos e sem vazar segredos.

### 5.1 Diagrama textual

```
[detecção: expiresAt próximo ou 401/403]
        |
        v
[marca token VALIDA -> EM_RENOVACAO (reserva atômica por accountId+type+generation)]
        |
        +-- outro processo já renovou -> usar token da generation mais nova, sem nova chamada
        |
        v
[refresh: ML POST /oauth/token | Shopee POST /api/v2/auth/access_token/get]
        |
        +-- 429/5xx -> backoff na chamada HTTP; renovação permanece EM_RENOVACAO
        +-- refresh já usado / 4xx -> conta REAUTORIZAR; sem reenvio do mesmo token
        |
        v
[saveToken(generation+1) + markTokenUsed(token antigo)]  <- par atômico
        |
        v
[liberar reserva -> token novo VALIDA; requisições em voo usam a generation vigente]
```

### 5.2 Regras por marketplace

- **Mercado Livre:** `refreshAccessToken(refreshToken)` chama `POST /oauth/token` com `grant_type=refresh_token`, `client_id`, `client_secret` e `redirect_uri`. Access token cerca de 6 horas; refresh token é **de uso único**.
- **Shopee BR:** `refreshAccessToken({ shopId, refreshToken })` chama `POST /api/v2/auth/access_token/get` com `shop_id` e `refresh_token`; assinatura HMAC-SHA256 em minúsculas. Access token cerca de 4 horas; refresh token de uso único com validade de 30 dias; autorização máxima de 365 dias. `partner_key` nunca vai para o cliente nem para log.
- Ambos: `getActiveToken({ accountId, type })` só devolve token não usado e não expirado; valores em repouso passam por `decryptSecret`.

### 5.3 Concorrência, falhas e recuperação

1. **Reserva atômica.** Somente um processo pode renovar por `(accountId, token_type)` por vez, usando `generation` como condição. Quem chega depois lê a `generation` mais nova e a reutiliza; não dispara segunda troca.
2. **Uso único.** `markTokenUsed(oldTokenId)` e `saveToken(..., generation + 1)` devem ser gravados juntos. Se o provedor aceitar a troca mas a gravação local falhar, não tentar adivinhar o novo valor: marcar a conta `REAUTORIZAR` e exigir novo OAuth. A semântica exata de recuperação depende de `lib/db.js` (dono do banco).
3. **Retry.** Backoff só para `429/5xx/timeout`. Nunca repetir chamada de refresh com o mesmo refresh token após resposta de sucesso ou de "já usado"; nesse caso, parar e reautorizar.
4. **OAuth state.** `saveOAuthState`/`consumeOAuthState` também são de uso único: um `state` não pode autorizar duas contas nem duas empresas.
5. **Isolamento.** Nunca compartilhar token, refresh token, seller id ou shop id entre empresas; `COMPANY_SLUG` delimita config e credenciais.
6. **Log.** `marketplace`, `accountId` opaco, `generation` anterior e nova, `expiresAt`, resultado e `requestId`. Nunca token, segredo, base string ou `state`.

### 5.4 Estados do token

`VALIDA` -> `EM_RENOVACAO` -> `VALIDA` (generation+1) / `INUTILIZADA` / conta `REAUTORIZAR`.

---

## 6. Recuperação por `missed_feeds` do Mercado Livre

**Objetivo:** recuperar notificações que não receberam HTTP 200 e reintroduzi-las no mesmo pipeline de dedupe do fluxo 2, sem duplicar pedido nem baixa de estoque.

### 6.1 Fonte oficial e detalhes operacionais

Documentação oficial "Notificações" (`developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes`), última atualização em 03/11/2026, consultada em 2026-11-23:

- Endpoint: `GET https://api.mercadolibre.com/missed_feeds?app_id=<app_id>` com header `Authorization: Bearer <access_token>`.
- Filtros: `topic`, `offset` e `limit` (padrão 10). Para o tópico `items`, `site_id` é **obrigatório** (aqui, `MLB`); sem ele a API responde HTTP 400. Para outros tópicos, `site_id` não é exigido.
- Janela: até cerca de **2 dias**. Após a oitava tentativa (cerca de 1 hora) sem HTTP 200, a mensagem é considerada perdida e entra no histórico.
- Resposta: mensagens com `_id`, `resource`, `user_id`, `topic`, `application_id`, `attempts`, `sent`, `received`, `request`, `response` e `http_code`.
- Aviso operacional: desde 15/06/2026, notificações de aplicações com mais de 80% de erro ou alta intermitência podem ser desativadas; a reinscrição de tópicos é ação administrativa, não automática.

Estes detalhes **complementam** o item 7 da especificação (que já cita `missed_feeds` e a janela de ~2 dias). Não há conflito a registrar.

### 6.2 Diagrama textual

```
[cron/manual: recuperar feeds perdidos]
        |
        v
[para cada conta ML CONECTADA: requireSecrets -> getActiveToken]
        |
        v
[GET /missed_feeds?app_id=<app_id>&topic=<topic>&site_id=MLB&offset=<n>&limit=<n>]
        |   (site_id obrigatório apenas para topic=items; paginar até esgotar)
        |
        v
[para cada mensagem: dedupe_key = marketplace + _id/topico]
        |
        +-- insertEventIfAbsent já existe -> ignorar (dedupe)
        |
        v
[mesmo processamento do fluxo 2: getOrderDetail / leitura do recurso -> importação -> estoque]
        |
        v
[setSyncCursor(kind = 'missed_feeds') + log agregado]
```

### 6.3 Passo a passo

1. **Escopo.** Executar por conta conectada do Mercado Livre, usando `ML_APP_ID` e token ativos daquela empresa. Nunca usar `app_id` de outra instalação; o valor vem de `requireSecrets`, nunca literal no código versionado.
2. **Consulta.** Paginar com `offset`/`limit` (padrão 10). Para `topic=items`, enviar `site_id=MLB`. Para `topic=orders`, não é necessário `site_id`. `requestJson` aplica backoff em `429/5xx`.
3. **Dedupe.** Cada mensagem vira um `marketplace_event` com `dedupe_key` determinística baseada em `_id` e `topic`. `insertEventIfAbsent` garante que a mesma mensagem recuperada duas vezes não gere dois pedidos nem duas baixas de estoque.
4. **Reprocessamento.** Usar `resource`/`topic` apenas para localizar o recurso; consultar sempre a API (`getOrderDetail` ou leitura equivalente) para obter o estado atual. Eventos podem chegar fora de ordem; o estado remoto prevalece sobre o payload antigo.
5. **Cursor.** Registrar em `marketplace_sync_state` com `kind: "missed_feeds"`. Usar uma **sobreposição** da janela (por exemplo, reconsultar os últimos minutos) em vez de avançar o cursor até o segundo exato: a dedupe absorve mensagens repetidas e evita perder mensagens na fronteira.
6. **Falhas.** Erro de paginação não invalida páginas já processadas; cada mensagem é independente e entra no mesmo mecanismo de `attempts`/`next_attempt_at` do fluxo 2. Se a API devolver HTTP 400 por falta de `site_id`, corrigir a chamada — não registrar como divergência de negócio.
7. **Log.** `marketplace`, `sellerId` opaco, `topic`, intervalo consultado, quantidade de mensagens vistas/novas/duplicadas/processadas, `offset`, duração e `requestId`. **Nunca** registrar `request`, `request.data`, headers, `response.body`, `user_id` em claro nem qualquer payload completo.
8. **Limites.** Não criar usuário, anúncio ou transação de teste. Não reinscrever webhooks automaticamente; apenas sinalizar a necessidade quando houver indício de desativação por erro.

### 6.4 Estados

Cursor: `SEM_CURSOR` -> `EM_VARREDURA` -> `ATUALIZADO` / `FALHOU_PARCIAL` (com retomada pela sobreposição). Eventos resultantes seguem `RECEBIDO` -> `PROCESSANDO` -> `PROCESSADO` / `FALHA`.

---

## 7. Matriz consolidada de idempotência e retentativas

| Fluxo | Chave | Efeito repetido | Retentativa segura? |
|---|---|---|---|
| Anúncio | `marketplace + seller_id + sku` | Reaproveita `marketplace_listing`; não cria segundo anúncio | Sim, com a mesma `idempotency_key` e payload recalculado |
| Pedido | `marketplace + seller_id + external_order_id` | `insertOrderIfAbsent` não insere; estoque não é ajustado de novo | Sim, refazendo `getOrderDetail` |
| Evento | `marketplace + dedupe_key` | `insertEventIfAbsent` retorna o existente | Sim, sem duplicar efeito |
| Estoque | `marketplace + operation + sku + externalId` | `update_stock` com quantidade convergida não produz efeito adicional | Sim, com a mesma chave |
| Reconciliação | cursor `(marketplace, sellerId, kind)` | Sobreposição + dedupe absorvem repetição | Sim, somente leitura/correções guardadas |
| Token | `(accountId, token_type, generation)` | Renovação concorrente reusa a generation nova | Não com refresh token já consumido |
| `missed_feeds` | `marketplace + _id/topic` | Igual ao fluxo de pedido | Sim, com sobreposição de janela |

---

## 8. Dependências de implementação (por dono de arquivo)

Este documento não altera nenhum dos arquivos abaixo; apenas registra o que cada dono precisa garantir para que os fluxos sejam respeitados:

- **Config/runner (agente 4):** `ML_APP_ID`, `SHOPEE_PARTNER_ID` etc. apenas por ambiente; `publishAllowed` e `publishSkus` começando desativados.
- **Banco (agente 6):** atomicidade de `insertOrderIfAbsent` + `adjustEverShopStock`, par `saveToken` + `markTokenUsed`, reserva de renovação por `generation`, e equivalência dos estados lógicos da seção 0.3 em `docs/MARKETPLACE_DB.md`.
- **HTTP (agente 7):** backoff, `Retry-After`, timeout e erros sem vazar query/token.
- **Preço/catálogo (agentes 8 e 9):** `assertPublishablePrice` rigoroso e `product.price` como única fonte.
- **Idempotência (agente 10):** estabilidade das chaves em `makeIdempotencyKey`, `insertEventIfAbsent` e `insertOutboxIfAbsent`.
- **Adaptadores (agentes 11 a 16):** `verifyWebhook`, `parseNotification`, `getOrderDetail`, `updateStock`, refresh de uso único e assinatura Shopee sem logs sensíveis.
- **Serviços/crons/rotas (agentes 17 e 18):** execução assíncrona fora do caminho do 200 rápido, paginação e agendamento do `missed_feeds`.
- **Observabilidade (agente 19):** painéis e alertas usando somente os campos liberados na seção 0.5.

---

## 9. Fontes e divergências

- `docs/AGENT_CONTRACT_MARKETPLACES.md` (v1.0, 2026-11-23) e `docs/ESPECIFICACAO_MARKETPLACES.md` (v1.0, 2026-11-23) — contratos internos.
- Documentação oficial Mercado Livre, "Notificações" (atualizada em 03/11/2026, consultada em 2026-11-23): HTTP 200 em até 500 ms, retries por ~1 hora, `missed_feeds` com até ~2 dias, `site_id` obrigatório para `topic=items`, `limit`/`offset` com padrão 10.
- Documentação oficial Mercado Livre, "Desenvolvimento in-house Quick Start" (atualizada em 06/10/2026, consultada em 2026-11-23): uso de fila, tolerância a duplicidade e ordem arbitrária, aviso de desativação por taxa de erro elevada desde 15/06/2026.
- Shopee Open Platform e APIs `v2.product.*`/Push Mechanism, conforme já registradas na especificação (consulta original em 2026-11-23).

**Divergências encontradas:** nenhuma. Os detalhes operacionais do `missed_feeds` (parâmetros `site_id`, `topic`, `limit`, `offset` e janela) complementam a especificação sem contradizê-la.
