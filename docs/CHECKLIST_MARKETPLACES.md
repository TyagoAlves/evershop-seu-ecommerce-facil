# Checklist local — integração Mercado Livre e Shopee BR (Fase 3)

- Versão: 1.0 (2026-11-23)
- Dono: agente 20 (CI, scripts e checklist) — contrato em `docs/AGENT_CONTRACT_MARKETPLACES.md`.
- Escopo: validação **local e somente leitura** do código da extensão `marketplace-bridge` antes de qualquer ativação.
- Estado desta fase: extensão `enabled: false`, `publishAllowed: false` e `publishSkus: []`. Nenhum anúncio, pedido, autorização de app, webhook remoto, migration aplicada, changeset ou publicação foi executado.
- Idioma: pt-BR. Identificadores técnicos de API permanecem como na documentação oficial.

> [!IMPORTANT]
> Este checklist **não autoriza publicação**. Cumprir todos os itens apenas reduz risco técnico; a ativação depende de autorização explícita e formal do responsável pela loja e pelo template.

---

## 1. Pré-requisitos

### 1.1 Preços e catálogo

- [ ] Todos os SKUs candidatos têm preço **real** em `product.price` do EverShop, conferido no catálogo da instalação correspondente.
- [ ] Nenhum preço foi inferido, arredondado para valor comercial, copiado de outra empresa ou inventado para satisfazer validação.
- [ ] `assertPublishablePrice` falha fechado para `price <= 0`, nulo ou ausente; nenhum anúncio é montado nesses casos.
- [ ] Produtos “sob consulta” da Loja Exemplo permanecem “sob consulta” na loja própria; integração não cria preço artificial.
- [ ] `categoryMap`, `attributeMap`, `listingTypeId` e `categoryId` da empresa foram preenchidos pelo dono da config com dados reais; valores `null` continuam bloqueando o SKU.
- [ ] `publishSkus` permanece vazio até decisão explícita; lista vazia nunca significa “todos os SKUs”.

### 1.2 Credenciais e ambiente

- [ ] Cada empresa possui par de credenciais OAuth próprio: `ML_APP_ID`/`ML_CLIENT_SECRET` e `SHOPEE_PARTNER_ID`/`SHOPEE_PARTNER_KEY`. Nada compartilhado entre instalações.
- [ ] Nenhuma credencial, token, `partner_key`, chave de criptografia ou dado pessoal está em arquivo versionado, log, fixture, seed ou config de empresa.
- [ ] `.env.example` contém **somente nomes** de variáveis; valores reais ficam no cofre ou no `.env` da instalação, nunca no Git.
- [ ] `MARKETPLACE_TOKEN_ENCRYPTION_KEY` é exclusiva por instalação, gerada fora do repositório, com base64 de 32 bytes para AES-256-GCM.
- [ ] Redirect URIs OAuth são HTTPS e cadastradas exatamente no DevCenter do Mercado Livre e na Open Platform da Shopee; `state` é imprevisível, gravado no banco e de uso único.
- [ ] Webhooks possuem segredo próprio por marketplace (`ML_WEBHOOK_SECRET`, `SHOPEE_WEBHOOK_SECRET`) e validação antes de responder 2xx.
- [ ] Sandbox da Shopee disponível para ensaios (`SHOPEE_ENV=sandbox` no ambiente de teste, nunca no `.env.example` versionado); no Mercado Livre, quando não houver homologação equivalente, limitar-se a leitura e reconciliação antes de qualquer escrita.
- [ ] Nenhum usuário de teste, anúncio de teste ou transação real foi criado em ambiente de marketplace.

### 1.3 Governança

- [ ] Autorização explícita registrada do responsável pela loja e pelo template para qualquer habilitação futura.
- [ ] Configuração não secreta por empresa validada pelo dono do schema (`companies/<slug>.marketplaces.json`).
- [ ] Extensão `marketplace-bridge` continua `enabled: false` em `config/default.json` nesta fase.
- [ ] Documentos de segurança e LGPD da Fase 3 revisados: `docs/SEGURANCA_MARKETPLACES.md` e `docs/LGPD_MARKETPLACES.md`.
- [ ] Backup recente da instalação, domínio e catálogo disponíveis antes de qualquer mudança futura de configuração.

### 1.4 Risco conhecido — imagens no `add_item` da Shopee

- [ ] `getProductImages()` do catálogo EverShop devolve **URLs absolutas**, enquanto `v2.product.add_item` da Shopee trabalha com `image_id` obtido por upload de imagem. São representações distintas.
- [ ] O mapper da Shopee não converte URL em `image_id` e não inventa identificador; associar um ID arbitrário ou reaproveitar ID de outro anúncio/empresa é falha de integridade, não solução.
- [ ] Enquanto não existir um helper de upload de imagem devidamente implementado, revisado e autorizado — fora do escopo desta fase —, qualquer SKU que dependa de foto deve **falhar fechado**: nenhum payload de anúncio Shopee é montado nem enviado.
- [ ] Essa limitação é bloqueio técnico adicional a preço real, allowlist e autorização explícita. Ela não autoriza publicação e não substitui nenhuma das validações deste checklist.

---

## 2. Validações locais (sem build, seed, rede ou publicação)

Execute na raiz de `evershop-seu-ecommerce-facil`:

| Comando | O que faz | Bloqueio esperado |
|---|---|---|
| `npm run mp:secrets` | Verifica `.env.example` e arquivos versionados; falha se houver variável de segredo preenchida. Nunca imprime valores. | `exit 1` com arquivo, linha e nome da variável/chave; corrija e rode novamente. |
| `npm run mp:config` | Executa `node scripts/validate-marketplaces-config.mjs` (dono 3) para validar a config por empresa e o schema. | `exit 1`: config ausente, inválida ou com chave de aparência de segredo. |
| `npm run mp:check` | Executa `node --check` em todos os `.js` de `extensions/marketplace-bridge` e `node --test` nos testes locais. | `exit 1`: erro de sintaxe ou teste falhando. |

Comandos equivalentes, se necessário:

- `node scripts/check-marketplace-secrets.mjs --secrets` (padrão) e `node scripts/check-marketplace-secrets.mjs --check`.
- `node --check <arquivo.js>` para um arquivo isolado.
- `node --test extensions/marketplace-bridge/tests/<arquivo>.test.mjs`.

Regras de execução:

- [ ] Nenhum comando acima usa rede, banco, `npm install`, `npm ci`, build, seed, start/dev ou migração.
- [ ] `node_modules/`, `dist/`, `.evershop/`, `media/` e `public/sitemap*.xml` não foram alterados nem precisam ser lidos manualmente.
- [ ] O CI (`.github/workflows/template-ci.yml`) executa as três verificações acima antes do `Build`, mantendo o smoke test e as auditorias existentes.
- [ ] Falha em qualquer verificação = parar. Não “pular” com `continue-on-error`, não editar a validação para passar.

---

## 3. O que NÃO fazer

- [ ] **Não** publicar anúncio, criar/atualizar preço ou estoque em marketplace, criar pedido, cancelar pedido nem autorizar aplicativo em ambiente real.
- [ ] **Não** chamar APIs oficiais com credenciais reais; nem mesmo “só para testar”.
- [ ] **Não** preencher preço `0`, preço simbólico ou preço inventado no catálogo para facilitar validação.
- [ ] **Não** inventar `image_id` da Shopee, não reutilizar ID de outra empresa/anúncio e não burlar a falha fechado descrita em 1.4.
- [ ] **Não** rodar `npm install`, `npm ci`, `npm run build`, `npm run seed`, `npm start`, `npm run dev`, migrações, SQL ou chamadas externas nesta fase.
- [ ] **Não** fazer `git add`, `git commit`, `git push`, `git checkout`, `git clean`, `git reset`, changeset, publish, deploy nem abrir PR.
- [ ] **Não** tocar no rascunho `pb-draft-1` (`changeset_id=2`) nem publicar o page builder.
- [ ] **Não** editar arquivos fora do dono definido em `docs/AGENT_CONTRACT_MARKETPLACES.md`.
- [ ] **Não** alterar visual, textos, SEO, WhatsApp, domínio ou catálogo da Loja Exemplo nesta fase.
- [ ] **Não** registrar token, segredo, CPF, e-mail, telefone ou payload bruto de pedido em log; usar sempre redação.
- [ ] **Não** reutilizar credenciais, seller id, shop id ou token entre empresas.
- [ ] **Não** interpretar `publishSkus: []` como permissão para publicar tudo.

---

## 4. Ordem de ativação futura (sequência proposta — não executada)

1. **Configuração e segredos:** preencher a config não secreta da empresa e injetar segredos somente no cofre/`.env` da instalação; rodar `mp:secrets` e `mp:config`.
2. **Código-fonte:** rodar `mp:check`; corrigir até sintaxe e testes passarem. Nenhuma escrita remota.
3. **Habilitação técnica controlada:** habilitar a extensão e a empresa na config, mantendo `publishAllowed: false` e `publishSkus: []`. Validar leitura de catálogo e reconciliação sem criar anúncio.
4. **OAuth em sandbox:** autorizar a integração no ambiente de teste da Shopee (e no fluxo de homologação do ML quando disponível), conferindo redirect exato, `state` de uso único e tokens cifrados em repouso.
5. **Webhooks de homologação:** validar assinatura, dedupe, resposta 2xx rápida e processamento assíncrono; conferir recuperação por `missed_feeds` e pelo mecanismo de push da Shopee.
6. **Allowlist explícita:** só após revisão de preço real por SKU, incluir SKUs em `publishSkus` e, se autorizado, ativar `publishAllowed`. Nenhum SKU fora da allowlist.
7. **Observabilidade:** conferir painel/consultas de status, filas, tentativas e erros sem expor segredos ou dados de comprador.
8. **Decisão formal:** somente com autorização explícita e registrada, agendar a mudança em produção com rollback e responsável nomeado. Este checklist não executa essa etapa.

---

## 5. Dependências de outros donos

- Agente 3: `scripts/validate-marketplaces-config.mjs`, `companies/schema.marketplaces.json` e os JSON por empresa — necessários para `mp:config`.
- Agente 4: `.env.example`, `config/default.json`, `lib/config.js` e `lib/secrets.js` — necessários para manter a extensão desativada e os nomes de variáveis sem valores.
- Agente 8: `tests/pricing.test.mjs` e `tests/normalize.test.mjs` — necessários para `mp:check`.
- Agente 15: mapper/adaptador Shopee — origem da limitação de `image_id` registrada em 1.4; upload de imagem está fora do escopo desta fase.
- Agentes 11 a 18: adaptadores, serviços, rotas e crons — necessários para que `node --check` e os testes cubram a extensão completa.
- Agentes 1, 2 e 19: documentação de segurança, fluxos e observabilidade — necessárias para revisão final de governança.

---

## 6. Registro de execução

Preencher somente com evidência real. Nenhum item foi marcado por este agente.

| Data | Comando executado | Resultado (`exit code`) | Responsável | Observação sem segredos |
|---|---|---|---|---|
|  |  |  |  |  |
