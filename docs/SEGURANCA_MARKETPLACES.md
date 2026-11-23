# Segurança — integração Mercado Livre e Shopee BR (Fase 3)

- Versão: 1.0 (2026-11-23)
- Base: `evershop-seu-ecommerce-facil` (relativo à raiz do repositório)
- Dono: agente 1 — contrato e segurança (Fase 3)
- Natureza: guia técnico de práticas obrigatórias. Não é parecer jurídico; bases legais e prazos são tratados em `docs/LGPD_MARKETPLACES.md` e dependem de validação do jurídico/DPO.
- Referências: `docs/AGENT_CONTRACT_MARKETPLACES.md`, `docs/ESPECIFICACAO_MARKETPLACES.md`, `docs/SEGURANCA_ISOLAMENTO.md`, `docs/DADOS_E_LGPD.md`.
- Estado desta entrega: **somente documentação**. Nenhuma credencial, chave, token, preço ou dado pessoal real foi escrito; nenhum build, seed, migração, SQL, chamada de API, `git`, changeset ou publicação foi executado. A extensão `marketplace-bridge` permanece com `enabled: false`, `publishAllowed: false` e `publishSkus: []`.

---

## 1. Premissas de segurança

1. **Uma empresa = uma instalação** (EverShop + PostgreSQL + domínio próprios). O template de código é compartilhado; o ambiente, não. `COMPANY_SLUG` escolhe a configuração não secreta da empresa ativa.
2. **Credenciais nunca atravessam empresas.** Não reutilizar `client_id`/`client_secret`, `partner_id`/`partner_key`, `seller_id`, `shop_id`, tokens, chave de criptografia nem webhook secret entre instalações.
3. **Falha fechada.** Se faltar segredo, config, preço publicável ou validação de webhook, a operação falha sem criar/atualizar anúncio, sem importar pedido e sem chamar API remota.
4. **Preço:** a única fonte publicável é `product.price` do EverShop, validada por `lib/pricing.js`. `price <= 0` ou nulo bloqueia a operação. Nenhum preço é inferido, arredondado para "zero" ou inventado nesta documentação.
5. **Nada é publicado nesta fase:** não há autorização real de app, criação de anúncio/pedido, registro remoto de webhook nem publicação de rascunho — inclusive o `pb-draft-1` (`changeset_id=2`).

## 2. Segredos: onde ficam e como chegam ao processo

### 2.1 Inventário de variáveis (nomes apenas)

| Variável | Natureza | Uso | Onde deve existir |
|---|---|---|---|
| `MARKETPLACE_TOKEN_ENCRYPTION_KEY` | **Segredo** — chave AES-256-GCM, base64 de 32 bytes | Cifrar/decifrar tokens em repouso | `.env` da instalação ou cofre |
| `ML_APP_ID` | Identificador de aplicação (configuração sensível) | OAuth e chamadas ML | `.env`/cofre; nunca no manifesto |
| `ML_CLIENT_SECRET` | **Segredo** | Troca e renovação de token ML | `.env`/cofre |
| `ML_REDIRECT_URI` | Configuração de segurança | Callback OAuth exato do ML | `.env`/cofre; deve corresponder ao DevCenter |
| `ML_WEBHOOK_SECRET` | **Segredo** | Validação das notificações ML | `.env`/cofre |
| `SHOPEE_PARTNER_ID` | Identificador de parceiro | Auth e assinatura Shopee | `.env`/cofre; nunca no manifesto |
| `SHOPEE_PARTNER_KEY` | **Segredo** | HMAC-SHA256 da Shop API | `.env`/cofre; nunca no cliente |
| `SHOPEE_REDIRECT_URI` | Configuração de segurança | Callback OAuth exato da Shopee | `.env`/cofre; deve igualar o cadastro |
| `SHOPEE_WEBHOOK_SECRET` | **Segredo** | Validação do push da Shopee | `.env`/cofre |
| `SHOPEE_ENV` | Configuração não secreta | `production` ou `sandbox` | `.env` da instalação |

Os valores de redirect devem **corresponder exatamente** ao cadastro no provedor; ver §5.

### 2.2 Regras de armazenamento

- A origem autoritativa é o **cofre da instalação**, com injeção no ambiente do processo na inicialização/configuração. `.env` local é aceito somente como mecanismo de entrega do segredo ao processo, com permissão restrita em NTFS e backup criptografado; não é "cópia de segurança" do valor.
- `.env.example` contém **apenas nomes e placeholders**. É a única exceção versionada ao padrão `.env.*`; substituir placeholder por valor real em qualquer arquivo versionado é incidente.
- `companies/<slug>.marketplaces.json`, `companies/_template.marketplaces.json`, `config/default.json`, seeds, testes, GraphQL, admin e logs **nunca** contêm segredos. O schema deve rejeitar chaves com aparência de segredo (`clientSecret`, `partnerKey`, `accessToken`, `refreshToken`, `password`, `apiKey`).
- Tokens de acesso/renovação não são segredos de config: são cifrados no banco (`marketplace_token.encrypted_value`), nunca gravados em texto claro em tabela, arquivo, fila, evento ou log.
- Nenhum segredo em URL de navegador, query de callback, mensagem de erro, screenshot, ticket, artifact de CI ou saída de `node --check`/teste.
- `scripts/check-marketplace-secrets.mjs` (dono 20) deve falhar se encontrar valor preenchido em arquivo versionado e **nunca imprimir o valor encontrado**.

## 3. Criptografia em repouso (AES-256-GCM)

- `MARKETPLACE_TOKEN_ENCRYPTION_KEY` é exclusiva por instalação, gerada fora do repositório, com 32 bytes codificados em base64. **Não** derivar de senha do banco, senha de admin, domínio ou slug; não compartilhar entre empresas.
- A cifra é **AES-256-GCM**. O formato da interface compartilhada é `v1:<iv>:<tag>:<cipher>`, com componentes em base64 (`lib/crypto.js`: `encryptSecret`, `decryptSecret`, `hmacSha256Hex`, `safeEqual`). O prefixo de versão permite conviver com mais de uma geração de chave durante a rotação.
- Cada operação de cifragem deve usar **IV/nonce aleatório e único** para a mesma chave (12 bytes é o tamanho recomendado para GCM); nunca reutilizar IV. O `tag` de autenticação deve ser validado na descriptografia — falha de tag é falha fechada, não fallback para texto claro.
- Somente o valor cifrado é persistido em `marketplace_token.encrypted_value`. Campos auxiliares (`expires_at`, `scope`, `generation`, `used_at`) não contêm segredo.
- `hmacSha256Hex` e `safeEqual` são usados para assinaturas e comparações em tempo constante; a base string jamais é registrada em log, especialmente a que contém `partner_key`, `access_token` ou `sign`.
- **Rotação da chave de criptografia:** (1) gerar nova chave no cofre com nova versão do prefixo; (2) manter a chave antiga disponível somente durante a janela de transição; (3) descriptografar com a versão indicada e reembaralhar com a nova, sem expor texto claro em log; (4) confirmar que nenhum token antigo ainda é usado; (5) revogar/destruir a chave antiga conforme política de retenção de backup. Se uma chave vazar, tratá-la como exposta: rotacionar imediatamente e reautorizar contas afetadas.

## 4. Rotação de tokens e ciclo de vida

- Referência de validade da especificação: access token ML ~6 h; access token Shopee ~4 h; refresh token ML e Shopee de **uso único** (Shopee ~30 dias); autorização Shopee máxima de 365 dias. Prazo exato é o publicado oficialmente; a aplicação deve tratar `expires_at` como orientação e falhar fechado em erro de autenticação.
- `marketplace_token` é único por `(account_id, token_type)` e guarda `generation` e `used_at`. Fluxo obrigatório:
  1. Antes de usar um refresh, verificar `used_at`; preenchido => não reutilizar, exigir nova autorização.
  2. Renovar via adaptador (`refreshAccessToken` / `refreshAccessToken({ shopId, refreshToken })`), sem logar o token antigo nem o novo.
  3. Em **uma transação**, marcar `used_at` do refresh anterior e gravar o novo com `generation + 1`, atualizando também o access token e `expires_at`.
  4. Controlar concorrência por `(marketplace, seller_id)`/`shop_id`: dois workers não podem renovar o mesmo refresh simultaneamente. Se a renovação vencer a corrida no provedor mas a gravação local falhar, considerar a conta como precisando de reautorização — **não** tentar o refresh consumido novamente.
  5. Erro de autenticação persistente (401/403) => parar a sincronização daquela conta e sinalizar reautorização no painel/status, sem repetir chamadas em loop.
- Renovação de `client_secret`/`partner_key`/webhook secret é procedimento separado: gerar no provedor, atualizar cofre/.env, recarregar o processo e revogar o valor antigo. Fazer por instalação, com validação individual; `ML_REDIRECT_URI`/`SHOPEE_REDIRECT_URI` devem continuar idênticas após a troca.
- Nenhum token real foi gerado, lido ou renovado nesta entrega.

## 5. Redirect URIs HTTPS exatas e `state`

### 5.1 Redirect URIs

- Valores canônicos da especificação (substituir `<dominio>` apenas no `.env`/cofre da instalação, nunca neste documento com valor real):
  - `ML_REDIRECT_URI=https://<dominio>/api/marketplaces/mercadolivre/oauth/callback`
  - `SHOPEE_REDIRECT_URI=https://<dominio>/api/marketplaces/shopee/oauth/callback`
- **HTTPS obrigatório** em produção; `http://`, `localhost`, IP e porta diferentes são bloqueados. Reverse proxy deve preservar o esquema e o host originais para que a comparação não use `http` interno.
- A URL deve ser **idêntica byte a byte** ao cadastro no DevCenter (Mercado Livre) e na Open Platform (Shopee): esquema, host, porta (se explícita), caminho, capitalização e eventual barra final. Não acrescentar parâmetros de query ao redirect cadastrado; `code` e `state` chegam pelo callback do provedor.
- Cada empresa tem seu próprio domínio e seu próprio par de redirect URIs. Nunca reaproveitar callback de outra instalação por "facilidade" de configuração.
- O callback é rota `access: "public"` (sem sessão obrigatória), mas só aceita a requisição após validar `state`, tratar o parâmetro `error` e conferir a identidade da conta autorizada. Nunca autorizar um `seller_id`/`shop_id` diferente do esperado pela sessão administrativa que iniciou o fluxo.

### 5.2 `state` imprevisível e de uso único

- Gerar com fonte criptográfica do runtime (por exemplo, 32 bytes aleatórios em base64url). Proibido `Date.now()`, contador, UUID não criptográfico (por exemplo, v1), slug ou hash de e-mail como `state`.
- Gravar **antes** de redirecionar (`saveOAuthState({ state, marketplace, adminUserId })`), com `marketplace`, `admin_user_id`, `created_at` e `used_at`. A coluna `state` é PK; o vínculo com o administrador impede login CSRF.
- No callback, `consumeOAuthState(state, marketplace)` deve marcar `used_at` de forma atômica e ratear um segundo uso. Rejeitar `state` ausente, desconhecido, já usado, de outro marketplace, de outro administrador ou expirado. TTL curto definido pela implementação (por exemplo, minutos); não aceitar `state` indefinidamente.
- O `code` da troca também é de uso único: não reenviá-lo, não registrá-lo e não incluí-lo em mensagens de erro. A identidade retornada deve ser conferida (ML `site_id === 'MLB'`, `seller_id` esperado; Shopee `shop_id` esperado) antes de `upsertAccount`.
- Após a autorização bem-sucedida, o `state` consumido permanece apenas como registro de auditoria, sem valor de segredo.

## 6. Validação de webhooks

- Rotas `mp-webhook-mel` e `mp-webhook-shopee` são `access: "public"` por necessidade do provedor, mas **a validação própria é obrigatória**: não confiar no corpo, no `User-Agent`, na origem aparente nem apenas no fato de a rota existir.
- Usar `ML_WEBHOOK_SECRET` / `SHOPEE_WEBHOOK_SECRET` no mecanismo de autenticação publicado pelo marketplace, com `hmacSha256Hex` e `safeEqual` quando a assinatura for HMAC. O algoritmo e o cabeçalho exatos devem ser confirmados na documentação oficial vigente no momento da implementação (donos 13/16); não inventar nome de cabeçalho nem assumir que todos os tópicos trazem assinatura.
- Validar também: corpo dentro de limite de tamanho, `Content-Type` esperado, frescor da notificação quando o provedor fornecer timestamp, tópico/tipo de evento em lista de permissões e permissão da conta `seller_id`/`shop_id` cadastrada. Falha => `WebhookVerificationError`, sem detalhes do segredo na resposta.
- O corpo bruto pode viver somente em memória durante a verificação; **não** persistir payload bruto nem payload completo em `payload_redacted`, eventos, outbox ou logs.
- Responder **2xx rapidamente** (referência ML: até ~500 ms) e processar de forma assíncrona: gravar `marketplace_event` com dedupe e enfileirar trabalho. Nenhuma chamada à API do marketplace, nenhuma escrita de estoque e nenhuma criação de pedido dentro do handler síncrono.
- Idempotência obrigatória: `marketplace + dedupe_key` para evento, `marketplace + seller_id + external_order_id` para pedido e `marketplace + seller_id + sku` para anúncio. Notificações duplicadas, fora de ordem ou antigas não podem duplicar efeito; o worker consulta o estado real na API após o push.
- Recuperação de perdas: usar `missed_feeds` do ML e reconciliação periódica da Shopee conforme a especificação; nunca recriar webhook remoto automaticamente nesta fase.
- Proteger o endpoint contra abuso com limitação de taxa no proxy/camada HTTP; segredos nunca na URL do webhook.

## 7. Redação em logs e observabilidade

| Nunca registrar | Registrar com segurança |
|---|---|
| `client_secret`, `partner_key`, chave de criptografia, webhook secrets | Nome da variável ausente/presente (`redact()`), sem valor |
| `access_token`, `refresh_token`, `code`, `state`, `sign`, assinatura, base string HMAC | `marketplace`, `seller_id`/`shop_id`, `token_type`, `generation`, status do resultado |
| URL completa de chamada Shopee (a API exige `sign`/`access_token` na query) | Método, host, caminho da rota, `status`, `requestId` informado pelo provedor |
| Payload bruto de pedido, nome/CPF/e-mail/telefone/endereço do comprador | `external_order_id` (ou hash truncado, quando necessário), `sku`, quantidade, `status` |
| Corpo bruto de webhook, parâmetros de callback com `code` | Tópico, `dedupe_key`, acertos/falhas de dedupe, tempo de processamento |

- Usar `redact(value)` de `lib/secrets.js` em todo ponto de log; adotar lista de campos permitidos em vez de "logar objeto inteiro".
- Classes de erro (`lib/errors.js`) e `MarketplaceHttpError.status`/`.requestId` são seguros; mensagens não incluem segredo, query, corpo nem dado pessoal. `requestJson` não deve vazar query em erro de rede/timeout.
- Mensagens e comentários internos em pt-BR; identificadores técnicos (`listing_type_id`, rotas, nomes de variáveis) permanecem como na API oficial.
- Painel/GraphQL de status (dono 19) expõe **estado agregado e seguro**: conectado/desconectado, última sincronização, contagem de fila e erro sanitizado — nunca token, segredo ou dados do comprador.

## 8. Menor privilégio

- **Banco:** uma role por empresa, dona somente do seu database, sem `SUPERUSER`, `CREATEDB` ou `CREATEROLE`. A aplicação usa essa role; operações de migração são executadas de forma controlada e não por usuário comum. Não conceder acesso de leitura a esquema de marketplace para contas de frontend/EDI. Humanos só com conta nominal, MFA quando disponível e acesso justificado/registrado (acesso de emergência auditado).
- **Admin:** iniciar OAuth apenas administradores designados daquela empresa (`access: "private"`). Não compartilhar conta admin entre empresas nem emprestar a conta da Exemplo. Perfis de conteúdo não podem alterar integração, extensões, `.env`, cofre, usuários nem migrações; se o core não granularizar, compensar com revisão e registro de quem agiu.
- **Escopos de API:** pedir somente o necessário para anúncios, pedidos e estoque daquela conta. Não solicitar escopos de dados de comprador, marketing ou cobrança. `auth_type=seller` da Shopee e `site_id=MLB` do ML são verificados, não presumidos.
- **Cofre/CI:** acesso por identidade nominal e role de deploy; nenhum segredo em arquivo de workflow, matriz, cache ou artifact. `scripts/check-marketplace-secrets.mjs` e varredura de segredos são barreiras de saída (dono 20). Nenhum agente desta fase executa deploy.
- **Sistema de arquivos:** `.env` legível somente pelo usuário de serviço; `media/`, `.evershop/`, `dist/`, `public/sitemap*.xml` e `node_modules/` não são editados nem usados como depósito de segredo.
- **Superfície de publicação:** config por empresa com `enabled: false`, `marketplaces.*.enabled: false`, `publishAllowed: false`, `publishSkus: []` e `itemStatusDefault: "UNLIST"` (Shopee). Nenhuma autorização de app, anúncio, pedido ou webhook remoto é criado nesta fase.

## 9. Resposta a incidente (procedimento recomendado)

1. Isolar a instalação afetada e preservar evidência **sem** copiar segredos ou dados de comprador para ticket/log.
2. Revogar/rotacionar imediatamente toda credencial exposta (incluindo chave de criptografia, `client_secret`, `partner_key` e webhook secrets); invalidar tokens e forçar reautorização quando aplicável.
3. Verificar onde o valor apareceu (log, commit, artifact, screenshot) e limpar histórico/artifacts conforme política; apagar o arquivo sozinho não resolve exposição.
4. Confirmar que nenhuma ação remota indevida ocorreu; suspender crons e fila daquela conta até a validação.
5. Se houver dado pessoal envolvido, acionar DPO/jurídico e seguir `docs/LGPD_MARKETPLACES.md` para comunicação de risco.
6. Registrar o incidente e a correção; repetir as verificações locais sem build, seed, SQL ou rede.

## 10. Checklist local de saída (somente conferência)

- [ ] Nenhum segredo real em `.env.example`, `companies/*.marketplaces.json`, `config/`, testes, logs ou documentação.
- [ ] Chave AES-256-GCM exclusiva da instalação, fora do Git, com rotação versionada possível.
- [ ] Tokens cifrados em repouso; `used_at`/`generation` aplicados na renovação; sem reuso de refresh.
- [ ] Redirect URIs HTTPS idênticas ao cadastro do provedor; `state` aleatório, atômico e de uso único.
- [ ] Webhooks validados, com dedupe, resposta 2xx rápida e processamento assíncrono.
- [ ] Logs redigidos; nenhuma URL com `sign`/`access_token` impressa; erros sem payload.
- [ ] Role de DB, contas admin e escopos de API no menor privilégio; extensão desativada.
- [ ] Nenhum preço inventado; nenhum anúncio/pedido/webhook remoto/autorização de app criado; nenhum changeset tocado.

## 11. Dependências de outros donos (não editadas por este agente)

- Agente 4 — `.env.example`, `config/default.json`, `lib/config.js`, `lib/secrets.js`: nomes de variáveis, `redact()` e validação de configuração.
- Agente 5 — `lib/crypto.js`, `lib/errors.js`: AES-256-GCM, HMAC, `safeEqual` e mensagens de erro sem vazamento.
- Agente 6 — migration e `lib/db.js`: colunas `encrypted_value`, `generation`, `used_at`, `payload_redacted` e transações de renovação.
- Agentes 11/14 — OAuth ML/Shopee: `state`, redirect exato, identidade da conta e troca/renovação.
- Agentes 13/16 — webhooks: algoritmo/cabeçalho oficial, dedupe e resposta rápida.
- Agente 18 — `bootstrap.js`, rotas e crons: `access` correto, registro de jobs e limitação de taxa.
- Agente 19 — admin/observabilidade: painel de status sem dados sensíveis.
- Agente 20 — CI e `scripts/check-marketplace-secrets.mjs`: varredura de segredos sem imprimir valores.
- Jurídico/DPO e operação de cofre — rotação operacional, bases legais, retenção e comunicação de incidentes.

## 12. Riscos registrados

- **Alto:** segredo real parar em `.env.example`, manifesto, log de erro ou artifact de CI. Mitigação: cofre, `redact()`, schema que proíbe chaves de segredo e script de varredura (dono 20).
- **Alto:** reutilização de refresh token de uso único por concorrência de workers. Mitigação: `used_at` atômico, `generation + 1` e lock por conta; falha fechada com reautorização.
- **Alto:** webhook aceito sem validação oficial ou processado de forma síncrona. Mitigação: confirmar assinatura/tópico na documentação vigente, dedupe e fila assíncrona.
- **Médio:** `sign`/`access_token` da Shopee trafegam na query por exigência da API; log de URL completa vaza segredo. Mitigação: logar apenas método/caminho/status/requestId.
- **Médio:** rotação da chave de criptografia sem suporte a versões antigas quebrar tokens em repouso. Mitigação: prefixo `v1:` e janela de transição com recriptografia.
- **Médio:** redirect URI divergente por proxy (`http` interno, barra final, host). Mitigação: comparação exata e geração da URL a partir da configuração da instalação.
- **Operacional:** este documento descreve controles, mas não os implementa nem os valida em runtime; a conformidade depende dos donos de código listados acima.
