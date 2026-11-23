# LGPD — dados de compradores de marketplace (Fase 3)

- Versão: 1.0 (2026-11-23)
- Base: `evershop-seu-ecommerce-facil` (relativo à raiz do repositório)
- Dono: agente 1 — contrato e segurança (Fase 3)
- Natureza: guia técnico de minimização, finalidade, retenção e direitos do titular. **Não é parecer jurídico**: as bases legais indicadas são sugestões (Lei nº 13.709/2018 — LGPD, art. 7º) que exigem confirmação do jurídico/DPO da empresa controladora antes de qualquer coleta ou uso real.
- Referências: `docs/AGENT_CONTRACT_MARKETPLACES.md`, `docs/ESPECIFICACAO_MARKETPLACES.md`, `docs/SEGURANCA_MARKETPLACES.md`, `docs/DADOS_E_LGPD.md`, `docs/SEGURANCA_ISOLAMENTO.md`.
- Estado desta entrega: somente documentação. Nenhum dado pessoal real, credencial, preço, pedido ou anúncio foi criado, lido ou enviado; nenhuma API externa foi chamada.

---

## 1. Quem controla, quem é titular e o que está fora de escopo

- **Controladora:** cada empresa/instalação, identificada por `COMPANY_SLUG`, com seu próprio domínio, banco e `.env`. Mercado Livre e Shopee atuam segundo seus próprios termos e políticas; a qualificação exata de cada parte (controladora independente, operadora, compartilhamento) depende dos contratos vigentes e deve ser confirmada pelo jurídico/DPO.
- **Titular:** a pessoa física compradora no marketplace. Também são titulares os administradores/vendedores pessoas físicas cujos dados apareçam em `marketplace_oauth_state.admin_user_id`, contas administrativas e registros de acesso.
- **Objetivo desta fase:** integrar anúncios, pedidos, estoque e reconciliação **sem** importar dados de identificação do comprador. A loja própria continua "sob consulta"; a integração não cria cliente nem pedido no EverShop e não altera a saída renderizada da Loja Exemplo.
- **Fora de escopo:** marketing, remarketing, enriquecimento de cadastro, emissão de nota fiscal, shipping e atendimento ao comprador. Se algum desses fluxos for necessário no futuro, é preciso novo inventário, base legal própria, aviso de privacidade e decisão do controlador — não basta reaproveitar os dados desta integração.

## 2. Inventário mínimo de dados tratados pela integração

| Dado / campo | Onde aparece | Finalidade | Base legal sugerida (art. 7º) | Regra de retenção e minimização |
|---|---|---|---|---|
| `marketplace`, `seller_id`, `shop_id`, `site_id` | `marketplace_account`, tabelas de listing/order/event | Identificar a conta conectada da empresa e garantir isolamento entre instalações | Execução de contrato (VI) com a empresa titular da conta; legítimo interesse (V) na segurança da operação | Manter enquanto a conta estiver conectada; remover/anonimizar após desconexão definitiva, respeitado registro de auditoria sem dado pessoal |
| `sku`, `product_id`, `quantity`, `totalCents`, `status`, `external_order_id` | `marketplace_order`, `marketplace_listing` | Conciliar pedido x anúncio x estoque e evitar duplicidade (chave `marketplace + seller_id + external_order_id`) | Execução de contrato (VI) da venda e legítimo interesse (V) na reconciliação/anti-fraude, com ponderação documentada; obrigação legal (II) se usado em registro fiscal/contábil | Somente enquanto necessário à reconciliação e à janela de contestação/prazo fiscal definido pelo controlador; nunca "para sempre" por conveniência |
| `external_event_id`, `dedupe_key`, `topic`, timestamps, `status`, `attempts` | `marketplace_event` | Idempotência de webhook, trilha técnica de processamento e reprocessamento | Legítimo interesse (V) em integridade e segurança; obrigação legal (II) quando aplicável a registro | Até o evento ser processado e expirar a janela de dedupe/auditoria definida pela empresa; depois excluir ou anonimizar |
| `payload_redacted` | `marketplace_order`, `marketplace_event` | Guardar **somente** campos técnicos necessários à conferência posterior | Mesma finalidade da tabela que o acompanha; legitimidade depende da estrita necessidade | **Nunca** conter nome, CPF/CNPJ, e-mail, telefone, endereço do comprador nem payload bruto; ver §4 |
| `payload` da `marketplace_outbox` | `marketplace_outbox` | Reenviar operação de anúncio/estoque com idempotência | Execução de contrato (VI) e legítimo interesse (V) operacional | Conter apenas SKU/produto/quantidade/identificadores de anúncio; nenhum dado do comprador; limpar após conclusão conforme política de fila |
| `admin_user_id`, `state` (com `used_at`) | `marketplace_oauth_state` | Autorizar app e impedir CSRF/replay no OAuth | Legítimo interesse (V) em segurança de acesso; obrigação legal (II) para registros de acesso, quando aplicável | `state` com TTL curto (minutos); registro de auditoria sem segredo conforme política de acesso |
| `access_token`, `refresh_token` (cifrados) | `marketplace_token` | Chamar APIs autorizadas pela empresa | Não são dados do comprador; são credenciais da conta conectada, tratadas como segredo | Até expirar, ser revogado ou a conta ser desconectada; cifrados em repouso e rotacionados (ver `docs/SEGURANCA_MARKETPLACES.md`) |
| Logs e painel de status | Observabilidade/admin | Diagnosticar falhas técnicas | Legítimo interesse (V) em segurança/estabilidade | **Nenhum** dado pessoal do comprador, token, segredo, `code`, `state`, `sign` ou payload bruto |

**Dados que esta integração não deve coletar nem replicar:** CPF/CNPJ do comprador, e-mail, telefone, nome completo, endereço de entrega, IP do titular, preferências/comportamento de compra, notas fiscais e quaisquer campos livres do pedido. Não há finalidade para eles na Fase 3; "coletar primeiro e decidir depois" viola necessidade e minimização.

> Atenção: `totalCents` refere-se ao valor do pedido informado pelo marketplace e é usado apenas para conciliação; **não** é preço de anúncio. A publicação de preço usa exclusivamente `product.price` validado por `lib/pricing.js`, sem valor inventado.

## 3. Finalidade e bases legais (sugestões sujeitas ao DPO)

1. **Anúncios e preço:** manter o catálogo da empresa coerente com `product.price` do EverShop. Base sugerida: execução de contrato (VI) com a empresa/controladora e legítimo interesse (V) na operação. Não envolve dados do comprador.
2. **Pedidos e estoque:** registrar identificadores do pedido do marketplace para dedupe, baixa/reserva de estoque e reconciliação. Bases sugeridas: execução de contrato (VI) da relação de compra e legítimo interesse (V) em integridade e prevenção a fraude. Registros fiscais/contábeis, quando existirem, têm base própria (II) e são tratados fora desta extensão.
3. **Webhooks e eventos:** garantir que notificação duplicada, perdida ou fora de ordem não altere estoque duas vezes. Base sugerida: legítimo interesse (V), com registro da ponderação (necessidade x direitos do titular).
4. **Segurança e acesso:** OAuth com `state`, tokens cifrados, logs redigidos e segregação por empresa. Base sugerida: legítimo interesse (V) e obrigação legal (II) quando aplicável a registro de acesso.
5. **Marketing/perfilamento:** **sem base definida nesta fase**; não realizar. Consentimento (I) específico e livre seria necessário se a empresa decidir usar dados para essa finalidade, com possibilidade de revogação.
6. **Dados sensíveis (art. 5º, II):** não são necessários e não devem ser tratados; se aparecerem indevidamente em payload, devem ser descartados/redigidos antes da persistência e o incidente registrado.

As bases acima não substituem a análise do controlador: finalidade, necessidade, proporcionalidade, aviso de privacidade e contrato com o marketplace devem ser validados antes de qualquer operação real.

## 4. Regra dura para `payload_redacted` e logs

- `payload_redacted` existe em `marketplace_order` e `marketplace_event` e deve ser montado por **lista de campos permitidos**, nunca por cópia integral do payload recebido.
- Campos aceitáveis, quando necessários à finalidade: `marketplace`, `sellerId`/`shopId`, `externalOrderId`/`externalEventId`, `sku`, `productId`, `quantity`, `totalCents`, `status`, `topic`, `dedupeKey` e timestamps técnicos.
- **Proibido** em `payload_redacted`, em `marketplace_outbox.payload`, em logs e em mensagens de erro: nome, CPF/CNPJ, e-mail, telefone, endereço de entrega, IP, texto livre do pedido, nota fiscal, `access_token`, `refresh_token`, `code`, `state`, `sign`, chave HMAC e corpo bruto de webhook.
- Identificador do comprador devolvido pelo provedor, quando existir e for estritamente necessário ao dedupe, deve ser **hash truncado** com sal por instalação; ainda assim é dado pessoal se puder ser religado ao titular — tratar como tal e não exibir no painel.
- O corpo bruto da notificação pode existir somente em memória durante a validação da assinatura (ver `docs/SEGURANCA_MARKETPLACES.md`, §6) e não pode ser salvo em arquivo, tabela ou log.
- Erros de domínio e observabilidade seguem a política de redação: status, `requestId`, tópico e contadores são suficientes; "logar tudo para debugar" não é aceitável.

## 5. Retenção mínima e descarte

- Prazo é **o menor tempo necessário à finalidade informada**, mais o período legalmente exigido quando houver obrigação (fiscal/contábil, por exemplo), definido pelo controlador e pelo jurídico/contador. **Este documento não inventa prazos numéricos.**
- Referências operacionais sugeridas (ajustáveis pelo controlador, nunca ampliadas sem justificativa):
  - `state` OAuth: minutos; marcar `used_at` e manter somente registro de auditoria.
  - Tokens: até expirar/revogar; cifrados; rotação conforme `docs/SEGURANCA_MARKETPLACES.md`.
  - Eventos de webhook: até processar e encerrar a janela de dedupe/reprocessamento.
  - Pedidos/listings: enquanto a conta estiver ativa e durante a janela de reconciliação/contestação; depois excluir ou anonimizar de forma irreversível.
- Ao fim do prazo: excluir ou anonimizar; a anonimização deve ser irreversível, e pseudonimização (hash) **não** é anonimização se ainda houver chave de religação. Aplicar a mesma regra a backups e réplicas conforme procedimento da instalação.
- Não acumular "histórico completo" do marketplace sem finalidade; não replicar dados entre empresas nem para ambiente de desenvolvimento/teste. Testes usam dados sintéticos.

## 6. Direitos do titular e canal

- Direitos previstos no art. 18 da LGPD incluem confirmação de tratamento, acesso, correção, anonimização/bloqueio/eliminação de dados desnecessários ou ilícitos, portabilidade quando aplicável, informação sobre compartilhamento e revogação de consentimento. Aplicam-se aos compradores e também a administradores/vendedores pessoas físicas.
- O controlador deve garantir esses direitos por canal **oficial e real** da empresa. Regras herdadas de `docs/DADOS_E_LGPD.md`:
  - **Não** usar `ADMIN_EMAIL` como canal de privacidade nem como e-mail público.
  - **Não** inventar `privacidade@`, `contato@` ou qualquer endereço "chutado": se não houver canal público real confirmado, omitir e registrar a pendência com o DPO.
  - Não expor dados de comprador no painel administrativo além do necessário para a operação; nenhuma tela deverá listar CPF/e-mail/telefone do comprador por curiosidade.
- Quando o marketplace também tratar dados do comprador, a empresa deve esclarecer em seu aviso de privacidade quem responde por cada etapa e como o titular solicita acesso/eliminação; essa comunicação depende do jurídico/DPO e não é alterada por esta fase.
- Transferências internacionais e subcontratação pelos marketplaces exigem avaliação de adequação/cláusulas contratuais e registro pelo controlador (arts. 33-35 da LGPD); não afirmar conformidade sem revisão contratual.
- Incidentes com risco ou dano a titulares seguem o procedimento de comunicação aplicável (incluindo art. 48 da LGPD), acionando DPO/jurídico; o procedimento técnico está em `docs/SEGURANCA_MARKETPLACES.md`, §9.

## 7. Boas práticas de implementação e governança

1. **Privacidade por concepção e por padrão:** minimizar antes de escrever o SQL; se o campo não tem finalidade documentada, não criar coluna nem payload.
2. **Isolamento por empresa:** `COMPANY_SLUG`, DB, `.env`, cofre e redirect URIs próprios. Nenhum dado de comprador ou de conta da Exemplo pode aparecer em outra instalação.
3. **Aviso no ponto de coleta:** a finalidade e a retenção devem ser transparentes no canal onde o comprador informa dados; esta integração não altera textos, SEO, WhatsApp nem a saída da loja própria.
4. **Acesso restrito e nominal:** MFA quando disponível, menor privilégio, registros de acesso sem segredo e sem dado do comprador. Nunca conta compartilhada.
5. **Validação de assinatura antes de persistir:** rejeitar payload não autenticado; dedupe e processamento assíncrono evitam efeitos duplicados.
6. **Testes sintéticos:** nenhum CPF/e-mail/telefone real em seed, teste, fixture, documentação ou log; nenhum dado real em `.env.example`.
7. **Avaliação de impacto (RIPD):** se o tratamento passar a envolver grande volume, perfilamento ou dados sensíveis, submeter à avaliação do controlador antes de implementar.
8. **Prestação de contas:** registrar decisões de base legal, prazo de retenção e ponderação de legítimo interesse; documentação técnica não substitui essa decisão.
9. **Nenhuma publicação:** não criar anúncio, pedido, webhook remoto, autorização de app, changeset nem comit como parte desta entrega.

## 8. Checklist local de conformidade (conferência documental)

- [ ] Finalidade de cada campo listada; nenhum campo coletado "para completar layout".
- [ ] `payload_redacted` montado por lista de campos permitidos; zero ocorrências de CPF/e-mail/telefone/nome/endereço/IP e payload bruto.
- [ ] Nenhum dado de comprador em logs, erros, painel, testes, seeds ou arquivos versionados.
- [ ] Retenção definida pelo controlador e compatível com a finalidade; descarte/anonimização previsto inclusive em backup.
- [ ] Bases legais confirmadas por jurídico/DPO antes de qualquer uso real; legítimo interesse ponderado quando aplicável.
- [ ] Canal de titularidade real informado; `ADMIN_EMAIL` não usado como contato de privacidade; pendência registrada se não houver canal público.
- [ ] Isolamento por `COMPANY_SLUG` verificado; nenhuma replicação de dados entre empresas.
- [ ] Nenhum dado pessoal real foi processado nesta entrega e nenhuma ação remota foi executada.

## 9. Dependências de outros donos (não editadas por este agente)

- Agente 3 — `companies/schema.marketplaces.json` e configs por empresa: proibir chaves de segredo e manter `enabled: false`/`publishAllowed: false`/`publishSkus: []`.
- Agente 4 — `.env.example`, `lib/config.js`, `lib/secrets.js`: nomes sem valores e `redact()`.
- Agente 5 — `lib/crypto.js`: cifragem de tokens e comparação segura.
- Agente 6 — migration e `lib/db.js`: esquema de `payload_redacted`, chaves de idempotência, `used_at` e transações de descarte/anonimização quando definidas.
- Agentes 12/15 — `mapper.js`: garantir que nenhum campo de comprador entre no payload de anúncio.
- Agentes 13/16 — `orders.js` e `webhook.js`: sanitização antes de `insertOrderIfAbsent`/`insertEventIfAbsent`.
- Agente 17 — serviços de sincronização: não replicar dados de comprador entre tabelas, lojas ou ambientes.
- Agente 18 — rotas e crons: callbacks/webhooks validados e sem exposição de dados.
- Agente 19 — `docs/OBSERVABILIDADE_MARKETPLACES.md`, GraphQL/admin: painel sem dados pessoais.
- Agente 20 — `scripts/check-marketplace-secrets.mjs` e CI: varredura sem imprimir segredos nem dados pessoais.
- Jurídico/DPO e controlador das empresas — bases legais, prazos, aviso de privacidade, canal do titular, contratos com marketplaces e transferências internacionais.

## 10. Riscos registrados

- **Alto:** payload bruto de pedido/webhook copiado para `payload_redacted` ou log, trazendo nome, CPF, e-mail ou telefone do comprador. Mitigação: lista de campos permitidos, redação e validação antes de persistir.
- **Alto:** base legal ou prazo de retenção assumido por analogia com a loja própria. Mitigação: decisão formal do controlador/DPO; hipóteses deste documento são sugestões.
- **Médio:** reaproveitamento de identificador do comprador como "chave técnica" sem sal/hash e sem tratamento como dado pessoal. Mitigação: minimizar ou usar hash truncado por instalação.
- **Médio:** dados de comprador de marketplace migrados para o EverShop com a intenção de "completar" pedido/cadastro, alterando o modo sob consulta ou a saída da Exemplo. Mitigação: vedação expressa nesta fase; nenhuma criação de cliente/pedido no core.
- **Médio:** ausência de canal de privacidade real levando alguém a usar `ADMIN_EMAIL` como contato do titular. Mitigação: omitir e registrar pendência conforme `docs/DADOS_E_LGPD.md`.
- **Jurídico:** transferências internacionais, compartilhamento com marketplaces e comunicação de incidentes dependem de análise contratual; nada disso foi validado aqui.
- **Operacional:** este documento é inventário e diretriz; a conformidade efetiva depende da implementação dos donos listados e da decisão do controlador.
