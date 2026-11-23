/**
 * Preço e estoque da Shopee BR — adaptador da extensão marketplace-bridge.
 *
 * Contrato (docs/ESPECIFICACAO_MARKETPLACES.md, §5 e §7):
 *   updatePrice(accessToken, shopId, itemId, modelId, product)
 *   updateStock(accessToken, shopId, itemId, modelId, quantity)
 *
 * Regras aplicadas aqui:
 * - `assertPublishablePrice(product)` roda ANTES de qualquer chamada de rede;
 *   nenhum preço é inferido, herdado ou inventado — a única fonte é
 *   `product.price` do catálogo EverShop;
 * - antes de cada escrita é feita uma CONSULTA PRÉVIA (`get_model_list`) para
 *   comparar o estado remoto e evitar gravação redundante;
 * - escritas usam `retries: 0`: `requestJson` retenta 429/5xx inclusive em POST,
 *   e repetir `update_price`/`update_stock` poderia aplicar a mudança duas vezes;
 * - chaves determinísticas de idempotência são devolvidas ao chamador para a
 *   outbox; a Shopee não aceita chave de idempotência no corpo da requisição;
 * - quantidade negativa é rejeitada (nunca vender abaixo de zero).
 *
 * Nenhuma função cria anúncio, pedido ou cancelamento. Nenhuma função registra
 * logs com token, partner_key, assinatura, preço bruto ou payload de comprador.
 */

import { assertPublishablePrice, fromCents, toCents } from '../../pricing.js';
import { makeIdempotencyKey } from '../../idempotency.js';
import { MarketplaceError, PriceNotAvailableError } from '../../errors.js';
import { callShopeeApi, MARKETPLACE } from './orders.js';

const API_PATHS = Object.freeze({
  modelList: '/api/v2/product/get_model_list',
  updatePrice: '/api/v2/product/update_price',
  updateStock: '/api/v2/product/update_stock'
});

function erro(mensagem, code, ErrorClass = MarketplaceError) {
  const instance = new ErrorClass(mensagem, { marketplace: MARKETPLACE });
  if (!instance.code || ['MARKETPLACE_ERROR', 'MARKETPLACE_HTTP_ERROR'].includes(instance.code)) {
    instance.code = code;
  }
  return instance;
}

function inteiroPositivo(valor, campo, code) {
  const numero = typeof valor === 'number' || typeof valor === 'string' ? Number(valor) : NaN;
  if (!Number.isFinite(numero) || !Number.isInteger(numero) || numero <= 0) {
    throw erro(`${campo} deve ser um inteiro positivo.`, code);
  }
  return numero;
}

function inteiroNaoNegativo(valor, campo, code) {
  const numero = typeof valor === 'number' || typeof valor === 'string' ? Number(valor) : NaN;
  if (!Number.isFinite(numero) || !Number.isInteger(numero) || numero < 0) {
    throw erro(`${campo} deve ser um inteiro maior ou igual a zero.`, code);
  }
  return numero;
}

function textoOuNull(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

/**
 * Aceita tanto a assinatura posicional (accessToken, shopId, itemId, modelId,
 * produto/quantidade) quanto um único objeto de parâmetros. Isso mantém a
 * consistência com o adaptador de Mercado Livre sem engessar quem chama.
 */
function argumentos(itemId, modelId, valor) {
  if (itemId && typeof itemId === 'object' && !Array.isArray(itemId)) {
    return itemId;
  }
  if (modelId && typeof modelId === 'object' && !Array.isArray(modelId)) {
    return { itemId, ...modelId };
  }
  if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
    // Produto posicional: mantém `product` e suas chaves (sku, manageStock...).
    return { itemId, modelId, product: valor, ...valor };
  }
  return { itemId, modelId, quantidade: valor };
}

function chaveIdempotencia({ shopId, sku, operation, itemId, modelId }) {
  return makeIdempotencyKey({
    marketplace: MARKETPLACE,
    sellerId: String(shopId),
    operation,
    sku: textoOuNull(sku),
    externalId: `${itemId}:${modelId}`
  });
}

/**
 * Consulta prévia obrigatória: lê modelo/preço/estoque atuais antes de gravar.
 * Falha fechada — se não for possível consultar, a escrita é bloqueada.
 * Nunca devolve o corpo bruto da API.
 */
async function consultarEstadoAtual({ accessToken, shopId, itemId, modelId, operation, timeoutMs }) {
  let resposta;
  try {
    resposta = await callShopeeApi({
      path: API_PATHS.modelList,
      accessToken,
      shopId,
      body: { item_id: itemId },
      operation: `consulta prévia para ${operation}`,
      timeoutMs,
      retries: 1
    });
  } catch {
    throw erro(
      `Não foi possível consultar o estado atual antes de ${operation}; a gravação foi bloqueada.`,
      'CONSULTA_PREVIA_FALHOU'
    );
  }

  const dados = resposta && resposta.response && typeof resposta.response === 'object' && !Array.isArray(resposta.response)
    ? resposta.response
    : {};
  const modelos = Array.isArray(dados.model_list) ? dados.model_list : [];
  const modelo = modelos.find((candidate) => textoOuNull(candidate?.model_id) === String(modelId));
  if (!modelo) {
    throw erro(
      `Modelo não encontrado na consulta prévia para ${operation}; a gravação foi bloqueada.`,
      'MODELO_REMOTO_AUSENTE'
    );
  }

  const precoBruto = Array.isArray(modelo.price_info) ? modelo.price_info[0]?.current_price : undefined;
  const precoNumero = typeof precoBruto === 'number' ? precoBruto : Number(precoBruto);
  let priceCentsAtual = null;
  try {
    if (Number.isFinite(precoNumero)) {
      priceCentsAtual = toCents(precoNumero);
    }
  } catch {
    priceCentsAtual = null;
  }

  const estoqueBruto = Array.isArray(modelo.stock_info) ? modelo.stock_info[0]?.normal_stock : undefined;
  const estoqueNumero = typeof estoqueBruto === 'number' ? estoqueBruto : Number(estoqueBruto);
  const quantidadeAtual = Number.isInteger(estoqueNumero) && estoqueNumero >= 0 ? estoqueNumero : null;

  return { priceCentsAtual, quantidadeAtual };
}

/** Payload puro de preço, sem chamada de rede (útil para testes e auditoria). */
export function buildPricePayload({ product, itemId, modelId }) {
  // Fail closed antes de montar qualquer payload: price <= 0 nunca é enviado.
  const preco = assertPublishablePrice(product);
  const priceCents = toCents(preco);
  if (priceCents <= 0) {
    throw new PriceNotAvailableError(
      'Preço indisponível: o valor em centavos deve ser maior que zero.'
    );
  }

  const item = inteiroPositivo(itemId, 'item_id', 'ITEM_ID_INVALIDO');
  const modelo = inteiroPositivo(modelId, 'model_id', 'MODEL_ID_INVALIDO');

  return {
    body: {
      item_id: item,
      price_list: [{ model_id: modelo, original_price: fromCents(priceCents) }]
    },
    itemId: item,
    modelId: modelo,
    priceCents
  };
}

/** Payload puro de estoque, sem chamada de rede (útil para testes e auditoria). */
export function buildStockPayload({ itemId, modelId, quantity }) {
  const item = inteiroPositivo(itemId, 'item_id', 'ITEM_ID_INVALIDO');
  const modelo = inteiroPositivo(modelId, 'model_id', 'MODEL_ID_INVALIDO');
  const quantidade = inteiroNaoNegativo(quantity, 'quantity', 'QUANTIDADE_INVALIDA');

  return {
    body: {
      item_id: item,
      stock_list: [{ model_id: modelo, normal_stock: quantidade }]
    },
    itemId: item,
    modelId: modelo,
    quantity: quantidade
  };
}

/**
 * Atualiza o preço via `v2.product.update_price`.
 *
 * @param {string} accessToken token de acesso descriptografado pelo chamador
 * @param {number|string} shopId loja Shopee conectada
 * @param {number|string} itemId id do item Shopee
 * @param {number|string} modelId id do modelo Shopee
 * @param {{price: number, sku?: string, manageStock?: boolean}} product produto
 *   do catálogo EverShop (fonte única de preço)
 * @param {object} [opcoes] `timeoutMs`, `sku`, `retries` ignorado (sempre 0)
 */
export async function updatePrice(accessToken, shopId, itemId, modelId, product, opcoes = {}) {
  const params = argumentos(itemId, modelId, product);
  const produto = params.product ?? params.produto ?? null;
  if (!produto || typeof produto !== 'object' || Array.isArray(produto)) {
    throw new PriceNotAvailableError(
      'Preço indisponível: informe o produto do catálogo com product.price.'
    );
  }

  const { body, itemId: item, modelId: modelo, priceCents } = buildPricePayload({
    product: produto,
    itemId: params.itemId,
    modelId: params.modelId
  });
  const idempotencyKey = chaveIdempotencia({
    shopId,
    sku: params.sku ?? produto.sku,
    operation: 'update_price',
    itemId: item,
    modelId: modelo
  });

  const atual = await consultarEstadoAtual({
    accessToken,
    shopId,
    itemId: item,
    modelId: modelo,
    operation: 'a atualização de preço',
    timeoutMs: opcoes.timeoutMs
  });
  const base = { itemId: item, modelId: modelo, priceCents, idempotencyKey, preConsulta: atual };
  if (atual.priceCentsAtual !== null && atual.priceCentsAtual === priceCents) {
    return { ...base, ok: true, skipped: true, reason: 'PRECO_IGUAL_AO_REMOTO' };
  }

  // POST de escrita sem retentativa automática: requestJson retentaria 429/5xx.
  await callShopeeApi({
    path: API_PATHS.updatePrice,
    accessToken,
    shopId,
    body,
    operation: 'atualização de preço',
    timeoutMs: opcoes.timeoutMs,
    retries: 0
  });

  return { ...base, ok: true, skipped: false };
}

/**
 * Atualiza o estoque via `v2.product.update_stock`.
 *
 * @param {string} accessToken token de acesso descriptografado pelo chamador
 * @param {number|string} shopId loja Shopee conectada
 * @param {number|string} itemId id do item Shopee
 * @param {number|string} modelId id do modelo Shopee
 * @param {number|object} quantity quantidade (ou objeto com `quantity`,
 *   `product` e `sku`)
 * @param {object} [opcoes] `timeoutMs` e opções de logística
 */
export async function updateStock(accessToken, shopId, itemId, modelId, quantity, opcoes = {}) {
  const params = argumentos(itemId, modelId, quantity);
  const produto = params.product ?? params.produto ?? null;
  const { body, itemId: item, modelId: modelo, quantity: quantidade } = buildStockPayload({
    itemId: params.itemId,
    modelId: params.modelId,
    quantity: params.quantity ?? params.quantidade
  });
  const idempotencyKey = chaveIdempotencia({
    shopId,
    sku: params.sku ?? textoOuNull(produto?.sku),
    operation: 'update_stock',
    itemId: item,
    modelId: modelo
  });

  if (produto && produto.manageStock === false) {
    return {
      ok: true,
      skipped: true,
      reason: 'ESTOQUE_NAO_GERENCIADO',
      itemId: item,
      modelId: modelo,
      quantity: quantidade,
      idempotencyKey
    };
  }

  const atual = await consultarEstadoAtual({
    accessToken,
    shopId,
    itemId: item,
    modelId: modelo,
    operation: 'a atualização de estoque',
    timeoutMs: opcoes.timeoutMs
  });
  const base = { itemId: item, modelId: modelo, quantity: quantidade, idempotencyKey, preConsulta: atual };
  if (atual.quantidadeAtual !== null && atual.quantidadeAtual === quantidade) {
    return { ...base, ok: true, skipped: true, reason: 'ESTOQUE_IGUAL_AO_REMOTO' };
  }

  // POST de escrita sem retentativa automática: evita aplicar o estoque duas vezes.
  await callShopeeApi({
    path: API_PATHS.updateStock,
    accessToken,
    shopId,
    body,
    operation: 'atualização de estoque',
    timeoutMs: opcoes.timeoutMs,
    retries: 0
  });

  return { ...base, ok: true, skipped: false };
}
