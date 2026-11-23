# Observabilidade — integração Mercado Livre e Shopee BR (Fase 3)

- Versão: 1.0 (2026-11-23)
- Escopo: somente leitura. Este documento descreve como **observar** a integração sem criar anúncios, pedidos, webhooks remotos, autorizações de app, changesets ou publicações.
- Implementação correspondente:
  - SDL: `extensions/marketplace-bridge/src/graphql/types/MarketplaceStatus/MarketplaceStatus.admin.graphql`
  - Resolver: `extensions/marketplace-bridge/src/graphql/types/MarketplaceStatus/MarketplaceStatus.admin.resolvers.js`
  - Painel: `extensions/marketplace-bridge/src/pages/admin/marketplaceStatus/` (rota `/admin/marketplaces/status` quando a extensão estiver habilitada). O componente é `MarketplaceStatusPage.js`, escrito com `React.createElement` e sem JSX: em modo compilado o EverShop 2.4 lê apenas arquivos `.js` de `<extensao>/dist`, sem transpilar `.tsx` da extensão.

## 1. Superfície de observação

A query GraphQL `marketplaceStatus` existe **apenas no schema administrativo**: o SDL usa o sufixo `.admin.graphql` e o resolver `.admin.resolvers.js`, convenção do EverShop 2.4 que os exclui do schema da loja. Além disso, o resolver exige usuário autenticado no painel (`context.user`).

A extensão `marketplace-bridge` entra com `"enabled": false` em `config/default.json` e a configuração não secreta da empresa entra com `"enabled": false`. O painel informa separadamente:

- `extensionEnabled`: extensão habilitada na instalação;
- `companyConfigAvailable`: arquivo `companies/<slug>.marketplaces.json` presente e legível;
- `companyEnabled`: integração habilitada para a empresa;
- `marketplaces[].enabled`: resultado de `isEnabled(marketplace)`;
- `marketplaces[].publishAllowed` e `publishSkus` / `publishSkuCount`: allowlist explícita. Lista vazia **nunca** significa “todos os SKUs”.

Nenhum preço aparece no painel. A única fonte de preço publicável continua sendo `product.price`, validada por `lib/pricing.js`; preço nulo ou `<= 0` bloqueia a operação e é contabilizado como erro, sem inventar valores.

## 2. Métricas expostas

Todas vêm de agregações (`COUNT`/`MAX`) sobre as oito tabelas da extensão. Nenhuma linha, payload, `idempotency_key`, `state` OAuth, cursor ou `encrypted_value` é devolvido.

| Métrica (`counts`) | Origem | Leitura |
|---|---|---|
| `accounts` | `marketplace_account` com `status = 'connected'` (`listConnectedAccounts`) | Contas efetivamente conectadas por marketplace |
| `tokens` | `marketplace_token` | Quantidade de registros; valores nunca são lidos |
| `listings` | `marketplace_listing` | Anúncios locais conhecidos |
| `listingsWithError` | `marketplace_listing.last_error` preenchido | Anúncios com falha registrada |
| `orders` | `marketplace_order` | Pedidos importados (não criam pedido no EverShop) |
| `events` | `marketplace_event` | Notificações registradas com dedupe |
| `eventsPending` | `processed_at` vazio e `status <> 'failed'` | Eventos aguardando processamento |
| `eventsWithError` | `status = 'failed'` ou `last_error` preenchido | Eventos com falha |
| `outbox` | `marketplace_outbox` | Operações enfileiradas |
| `outboxPending` | `status` em `pending` ou `processing` | Fila a processar; `processing` pode indicar trabalho em andamento ou travado |
| `outboxWithError` | `last_error` preenchido | Falha já registrada; a linha volta para `pending` com backoff |
| `oauthStatesPending` | `marketplace_oauth_state.used_at` vazio | Estados OAuth ainda consumíveis; o valor do `state` nunca é exibido |

Métricas derivadas, calculadas mentalmente ou pelo coletor a partir desses campos:

- **Lag de sincronização**: `agora - lastSyncAt`. `lastSyncAt` é o maior entre `marketplace_sync_state.updated_at`, `marketplace_listing.last_synced_at` e `marketplace_order.imported_at`.
- **Taxa de erro de eventos**: `eventsWithError / events` (quando `events > 0`).
- **Taxa de erro de anúncios**: `listingsWithError / listings` (quando `listings > 0`).
- **Backlog da fila**: `outboxPending` e `outboxWithError` em conjunto.
- **Saúde de token por conta**: `disponivel`, `ausente`, `expirado`, `em_uso` ou `indisponivel`, sempre por par conta/tipo (`access` ou `refresh`). O campo `generation` é apenas número de versão.

`warnings` traz mensagens genéricas em pt-BR quando configuração ou tabelas não puderam ser lidas. Erros do driver, mensagens do PostgreSQL e detalhes de conexão **nunca** são repassados ao navegador.

## 3. Logs e redação

Use o logger do EverShop (`@evershop/evershop/lib/log`: `info`, `warning`, `error`) nos pontos que já tratam a operação — adapters, serviços, fila e webhooks. O painel de status não precisa registrar linhas novas; ele apenas lê estado.

Linhas úteis (modelo, com campos permitidos):

- `sincronização concluída marketplace=mercadolivre kind=orders contas=1 processados=12 falhas=0 duracao_ms=430`
- `webhook recebido marketplace=shopee topic=orders dedupe=sim result=duplicata status_http=200`
- `outbox falhou marketplace=mercadolivre operation=update_stock tentativa=2 proxima_tentativa_min=2 request_id=<id da API>`

**Nunca registrar**, mesmo em nível `debug`:

- `access_token`, `refresh_token`, `client_secret`, `partner_key`, `APP_ID`, chave de criptografia, `sign`, base string de assinatura ou query completa de chamadas assinadas;
- `encrypted_value`, `state` OAuth, `idempotency_key` com payload, `payload`, `payload_redacted` bruto;
- CPF, CNPJ, e-mail, telefone, endereço, nome ou apelido de comprador;
- corpo completo de pedido de marketplace;
- preço inventado ou valores de catálogo fora da validação de preço.

Regras de redação:

1. Para segredos, usar `redact()` de `lib/secrets.js` (devolve apenas marcador seguro).
2. Para mensagens de erro de domínio, usar as classes de `lib/errors.js`; elas já evitam segredos na mensagem.
3. Para mensagens vindas de API/outbox, usar a redação defensiva já aplicada em `lib/db.js`/`lib/outbox.js`; não reintroduzir o erro bruto em `console.log`.
4. Identificadores técnicos de API (`listing_type_id`, `ordersn`, `sku`) podem aparecer **sem** dados pessoais associados; suspecte de qualquer payload que os acompanhe.
5. Em caso de dúvida, registrar apenas `marketplace`, `operation`/`kind`, contadores, duração, `status` HTTP e `requestId`.

Nível recomendado em produção: `info` para marcos de sincronização, `warning` para falhas recuperáveis e backoff, `error` para falha fechada (configuração inválida, preço indisponível, assinatura inválida). Evite `debug` com payloads em ambiente compartilhado.

## 4. Alertas sugeridos (sem ação automática)

Os limites abaixo são **sugestões de investigação**, não gatilhos de mutação. Nenhum alerta deve habilitar publicação, reenviar mensagens, autorizar app ou alterar `publishAllowed`/`publishSkus` automaticamente.

| Sinal | Condição sugerida | Interpretação |
|---|---|---|
| Extensão inesperadamente ativa | `extensionEnabled = true` sem autorização registrada | Revisar `config/default.json` e o processo de mudança |
| Tabelas indisponíveis | `tablesAvailable = false` ou aviso equivalente | Migration não aplicada, banco indisponível ou leitura negada |
| Fila parada | `outboxPending > 0` e `lastSyncAt` parado por mais de 2× o cron configurado | Worker/cron parado ou preso em `processing` |
| Falhas na fila | `outboxWithError > 0` por mais de 15 minutos | Erro recorrente de API ou payload inválido |
| Eventos falhando | `eventsWithError` crescendo ou taxa acima de 5% em 1 hora | Webhook duplicado, assinatura/tópico diverso ou falha no processamento |
| Anúncios com erro | `listingsWithError` crescendo | Validação de preço/categoria ou divergência remota |
| Token inválido | `expirado`, `em_uso` ou `ausente` em conta conectada | OAuth precisa de renovação/autorização humana |
| Estado OAuth pendente | `oauthStatesPending` crescendo sem conclusão | Tentativas de autorização abandonadas; não reutilizar `state` |

Ao disparar um alerta, anexar apenas o recorte do painel (contadores/estados) e o `requestId` correspondente. Nunca anexar token, segredo ou payload de pedido.

## 5. Investigar sem tocar em produção

1. Abra `/admin/marketplaces/status` com um usuário administrativo e registre `extensionEnabled`, `companyEnabled`, `tablesAvailable`, contadores, `lastSyncAt` e avisos. A página é somente leitura: não há botões de sincronização, publicação ou edição.
2. Confira a configuração não secreta da empresa (`companies/<slug>.marketplaces.json`) **por leitura**: `enabled`, `marketplaces.<slug>.enabled`, `publishAllowed` e `publishSkus`. Não altere esses valores para “testar” publicação.
3. Confira se a migration `Version-1.0.0.js` foi aplicada na instalação. Se `tablesAvailable = false`, trate como ausência de leitura/esquema: não crie tabelas nem execute DDL manual em produção.
4. Consulte os logs do período, filtrando por `marketplace`, `operation`/`kind`, `requestId`, `status` HTTP e contadores. Aplique as regras de redação da seção 3 antes de compartilhar qualquer recorte.
5. Para reproduzir, use ambiente de desenvolvimento/sandbox com dados fictícios e credenciais próprias, nunca as de produção. Os ambientes não podem compartilhar seller id, shop id, par de credenciais ou token.
6. Se precisar de uma consulta ao banco, use uma **réplica** e apenas `SELECT` agregado sobre as tabelas da extensão, com SQL parametrizado e sem selecionar `encrypted_value`, `state`, `cursor`, `payload` ou `payload_redacted`. Não execute `UPDATE`, `DELETE`, `INSERT`, migrações ou `VACUUM` em produção sem autorização explícita.
7. Para validar código local, use somente as verificações permitidas pelo contrato (`node --check` e parse local de JSON). Não rode `npm install`, build, seed, servidor, chamadas de rede para ML/Shopee, changeset, publish, commit ou deploy.
8. Registre a conclusão com os contadores observados e o encaminhamento ao dono do arquivo correspondente (por exemplo: falha de API → adaptadores; fila → `lib/outbox.js`; config → arquivos de configuração da empresa). Não faça correção direta em arquivo de outro dono.

## 6. Limites de segurança e privacidade

- O painel expõe identificadores de conta/seller e estados operacionais; não expõe dados de comprador nem segredos.
- `publishSkus` é uma allowlist de produtos, não dado pessoal; ainda assim, preencha-a somente com autorização explícita.
- O modo “sob consulta” da loja própria e a saída visual da Loja Exemplo não são alterados por esta fase.
- Nenhuma observação desta seção autoriza criar anúncio, pedido, webhook remoto, autorização de aplicativo, changeset ou publicação.
