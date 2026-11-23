// Adaptador de anúncios da Shopee Brasil.
// Toda chamada passa por requestJson e é assinada com a chave do parceiro.
// Nenhuma URL, token, assinatura, segredo ou payload aparece em log/erro.
//
// Escopo: request genérico, leitura de item/modelo/busca e escrita de anúncio.
// Preço e estoque são escritos por `inventory.js` (updatePrice/updateStock),
// que faz consulta prévia do modelo e usa retries 0. Não duplicar aqui.

import { requestJson } from '../../http.js';
import { requireSecrets } from '../../secrets.js';
import { sign } from './sign.js';
import { ConfigError, MarketplaceError } from '../../errors.js';

const BASE_PRODUCAO = 'https://openplatform.shopee.com.br';
const BASE_SANDBOX = 'https://openplatform.sandbox.test-stable.shopee.com.br';

/** Caminhos oficiais Shop API v2 usados pelo adaptador de anúncios. */
export const CAMINHOS_SHOPEE = Object.freeze({
  ADD_ITEM: '/api/v2/product/add_item',
  BATCH_ADD_ITEM: '/api/v2/product/batch_add_item',
  GET_BATCH_TASK_RESULT: '/api/v2/product/get_batch_task_result',
  UPDATE_ITEM: '/api/v2/product/update_item',
  GET_ITEM_BASE_INFO: '/api/v2/product/get_item_base_info',
  GET_MODEL_LIST: '/api/v2/product/get_model_list',
  SEARCH: '/api/v2/product/search'
});

// requestJson retenta automaticamente 429/5xx e falhas de rede, inclusive em
// POST/PUT. Escritas NÃO podem ser repetidas cegamente: o padrão abaixo é zero
// retentativas para endpoints que alteram o catálogo. Leituras mantêm o padrão.
const CAMINHOS_ESCRITA = new Set([
  CAMINHOS_SHOPEE.ADD_ITEM,
  CAMINHOS_SHOPEE.BATCH_ADD_ITEM,
  CAMINHOS_SHOPEE.UPDATE_ITEM
]);

/** Host conforme SHOPEE_ENV; valor desconhecido falha fechado. */
function baseUrl() {
  const bruto = typeof process.env.SHOPEE_ENV === 'string'
    ? process.env.SHOPEE_ENV.trim().toLowerCase()
    : 'production';
  const ambiente = bruto === '' ? 'production' : bruto;

  if (ambiente !== 'production' && ambiente !== 'sandbox') {
    throw new ConfigError(
      'SHOPEE_ENV inválido: use production ou sandbox.',
      { code: 'SHOPEE_ENV_INVALID', marketplace: 'shopee' }
    );
  }

  return ambiente === 'sandbox' ? BASE_SANDBOX : BASE_PRODUCAO;
}

/**
 * Aceita caminhos "/api/v2/...", "api/v2/..." e a notação pontuada
 * "v2.product.add_item" usada na especificação.
 */
function normalizePath(path) {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new ConfigError(
      'Caminho da API Shopee não informado.',
      { code: 'SHOPEE_PATH_MISSING', marketplace: 'shopee' }
    );
  }

  const limpo = path.trim().replace(/^\/+/, '');
  if (limpo.startsWith('api/')) {
    return `/${limpo}`;
  }

  const partes = limpo.split('.');
  if (partes.length >= 2 && /^v\d+$/i.test(partes[0])) {
    return `/api/${partes.join('/')}`;
  }

  return `/api/v2/${partes.join('/')}`;
}

/** Mantém somente códigos de erro simples e curtos nas mensagens. */
function sanitizeApiCode(value) {
  if (typeof value !== 'string') {
    return 'erro_desconhecido';
  }
  const texto = value.trim();
  return /^[A-Za-z0-9_.:-]{1,100}$/.test(texto) ? texto : 'erro_desconhecido';
}

function sanitizeRequestId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const texto = value.trim();
  return /^[A-Za-z0-9_.:-]{1,200}$/.test(texto) ? texto : null;
}

/**
 * Executa uma chamada assinada à Shop API.
 *
 * @param {string} accessToken token de acesso já descriptografado pelo chamador
 * @param {number|string} shopId identificador da loja conectada
 * @param {{path: string, body?: object, method?: string, retries?: number,
 *   timeoutMs?: number}} options
 * @returns {Promise<{status: number, body: *, headers: Headers}>}
 *
 * Observação: `headers` devolvido por requestJson é o objeto Headers nativo;
 * consulte com headers.get('x-shopee-request-id'), nunca por indexação.
 */
export async function request(
  accessToken,
  shopId,
  { path, body, method = 'POST', retries, timeoutMs } = {}
) {
  if (typeof accessToken !== 'string' || accessToken.trim() === '') {
    throw new ConfigError(
      'Token de acesso da Shopee ausente; nenhuma chamada foi feita.',
      { code: 'SHOPEE_TOKEN_MISSING', marketplace: 'shopee' }
    );
  }

  const shopIdNumerico = Number(shopId);
  if (!Number.isSafeInteger(shopIdNumerico) || shopIdNumerico <= 0) {
    throw new ConfigError(
      'Shop ID da Shopee inválido; nenhuma chamada foi feita.',
      { code: 'SHOPEE_SHOP_ID_INVALID', marketplace: 'shopee' }
    );
  }

  const caminho = normalizePath(path);
  const segredos = requireSecrets('shopee');
  const partnerId = segredos.SHOPEE_PARTNER_ID;
  const partnerKey = segredos.SHOPEE_PARTNER_KEY;
  if (!partnerId || !partnerKey) {
    throw new ConfigError(
      'Credenciais do parceiro Shopee ausentes; nenhuma chamada foi feita.',
      { code: 'SHOPEE_PARTNER_MISSING', marketplace: 'shopee' }
    );
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const token = accessToken.trim();
  const assinatura = sign({
    path: caminho,
    timestamp,
    partnerId,
    partnerKey,
    accessToken: token,
    shopId: shopIdNumerico
  });

  const query = new URLSearchParams({
    partner_id: partnerId,
    timestamp: String(timestamp),
    sign: assinatura,
    access_token: token,
    shop_id: String(shopIdNumerico)
  });

  const tentativas = Number.isSafeInteger(retries) && retries >= 0
    ? retries
    : (CAMINHOS_ESCRITA.has(caminho) ? 0 : 2);

  let resposta;
  try {
    resposta = await requestJson({
      method,
      url: `${baseUrl()}${caminho}?${query.toString()}`,
      headers: { Accept: 'application/json' },
      body,
      retries: tentativas,
      timeoutMs
    });
  } catch (erro) {
    // Preserva o erro de HTTP compartilhado e apenas identifica o marketplace.
    if (erro && typeof erro === 'object' && !erro.marketplace) {
      erro.marketplace = 'shopee';
    }
    throw erro;
  }

  const corpo = resposta?.body;
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    throw new MarketplaceError(
      'A Shopee devolveu uma resposta inesperada.',
      { code: 'SHOPEE_INVALID_RESPONSE', marketplace: 'shopee' }
    );
  }

  // A Shopee costuma responder HTTP 200 mesmo com erro no envelope.
  if (typeof corpo.error === 'string' && corpo.error.trim() !== '') {
    const codigo = sanitizeApiCode(corpo.error);
    const erro = new MarketplaceError(
      codigo === 'erro_desconhecido'
        ? 'A API Shopee retornou um erro.'
        : `A API Shopee retornou um erro (código: ${codigo}).`,
      { code: 'SHOPEE_API_ERROR', marketplace: 'shopee' }
    );
    erro.apiErrorCode = codigo;
    erro.status = Number.isInteger(resposta.status) ? resposta.status : null;
    erro.requestId = sanitizeRequestId(corpo.request_id);
    throw erro;
  }

  return resposta;
}

/** Atalhos para os endpoints de produto; as operações de alto nível ficam em listings.js. */
export function addItem(accessToken, shopId, body) {
  return request(accessToken, shopId, { path: CAMINHOS_SHOPEE.ADD_ITEM, body });
}

export function updateItem(accessToken, shopId, body) {
  return request(accessToken, shopId, { path: CAMINHOS_SHOPEE.UPDATE_ITEM, body });
}

export function batchAddItem(accessToken, shopId, body) {
  return request(accessToken, shopId, { path: CAMINHOS_SHOPEE.BATCH_ADD_ITEM, body });
}

export function getBatchTaskResult(accessToken, shopId, body) {
  return request(accessToken, shopId, { path: CAMINHOS_SHOPEE.GET_BATCH_TASK_RESULT, body });
}

// updatePrice/updateStock ficam exclusivamente em inventory.js, com consulta
// prévia de modelo e chave de idempotência próprias.

function idsValidos(valores) {
  const lista = Array.isArray(valores) ? valores : [valores];
  const ids = lista
    .map((valor) => Number(valor))
    .filter((valor) => Number.isSafeInteger(valor) && valor > 0);
  if (ids.length === 0) {
    throw new ConfigError(
      'Lista de item_id da Shopee vazia ou inválida.',
      { code: 'SHOPEE_ITEM_ID_INVALID', marketplace: 'shopee' }
    );
  }
  return ids;
}

export function getItemBaseInfo(accessToken, shopId, itemIds) {
  return request(accessToken, shopId, {
    path: CAMINHOS_SHOPEE.GET_ITEM_BASE_INFO,
    body: { item_id_list: idsValidos(itemIds) }
  });
}

export function getModelList(accessToken, shopId, itemId) {
  const [id] = idsValidos(itemId);
  return request(accessToken, shopId, {
    path: CAMINHOS_SHOPEE.GET_MODEL_LIST,
    body: { item_id: id }
  });
}

export function searchItems(accessToken, shopId, { pageNumber = 1, pageSize = 50 } = {}) {
  const pagina = Number(pageNumber);
  const tamanho = Number(pageSize);
  if (!Number.isSafeInteger(pagina) || pagina <= 0) {
    throw new ConfigError(
      'Número de página inválido na busca da Shopee.',
      { code: 'SHOPEE_PAGE_INVALID', marketplace: 'shopee' }
    );
  }
  if (!Number.isSafeInteger(tamanho) || tamanho <= 0 || tamanho > 100) {
    throw new ConfigError(
      'Tamanho de página inválido na busca da Shopee.',
      { code: 'SHOPEE_PAGE_SIZE_INVALID', marketplace: 'shopee' }
    );
  }

  return request(accessToken, shopId, {
    path: CAMINHOS_SHOPEE.SEARCH,
    body: { page_number: pagina, page_size: tamanho }
  });
}
