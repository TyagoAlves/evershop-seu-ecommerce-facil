/**
 * Pedidos da Shopee BR — adaptador da extensão marketplace-bridge.
 *
 * Contrato (docs/ESPECIFICACAO_MARKETPLACES.md, §5 e §7):
 *   fetchRecentOrders(accessToken, shopId, cursor)
 *   getOrderDetail(accessToken, shopId, ordersn)
 *
 * Este módulo SOMENTE consulta a API (`v2.order.get_order_list` e
 * `v2.order.get_order_detail`). Ele não cria pedido, não cancela pedido e não
 * altera estoque. Nenhuma função registra logs: token, partner_key, assinatura
 * e dados de comprador nunca aparecem em mensagens de erro.
 *
 * O parâmetro `cursor` é opaco para o banco: serialize um objeto curto
 * `{ v, timeFrom, timeTo, nextCursor }` em JSON. Isso mantém a janela de tempo
 * estável enquanto as páginas da mesma consulta são percorridas e evita
 * referências ao payload do webhook como fonte de estado.
 *
 * Consulta à documentação oficial em 2026-11-23 (via especificação do projeto):
 * `get_order_list` recebe `time_from`/`time_to` em segundos Unix e devolve
 * `next_cursor`/`has_more`; a janela máxima aceita é de 15 dias. Se a
 * documentação oficial divergir, ela prevalece — ajustar constantes aqui.
 */

import { getSecret } from '../../secrets.js';
import { requestJson } from '../../http.js';
import {
  ConfigError,
  MarketplaceError,
  MarketplaceHttpError
} from '../../errors.js';
import { sign } from './sign.js';

export const MARKETPLACE = 'shopee';

const API_PATHS = Object.freeze({
  orderList: '/api/v2/order/get_order_list',
  orderDetail: '/api/v2/order/get_order_detail'
});

const AMBIENTES = Object.freeze({
  production: 'https://openplatform.shopee.com.br',
  sandbox: 'https://openplatform.sandbox.test-stable.shopee.com.br'
});

const TIMESPAN_PADRAO_SEGUNDOS = 3600;
const TIMESPAN_MINIMO_SEGUNDOS = 60;
const TIMESPAN_MAXIMO_SEGUNDOS = 15 * 24 * 60 * 60;
const SOBREPOSICAO_CURSOR_SEGUNDOS = 60;
const TAMANHO_PAGINA_PADRAO = 50;
const TAMANHO_PAGINA_MAXIMO = 100;
const VERSAO_CURSOR = 1;

/** Erro de domínio estável, sem incluir valores sensíveis na mensagem. */
function erro(mensagem, code, ErrorClass = MarketplaceError) {
  const instance = new ErrorClass(mensagem, { marketplace: MARKETPLACE });
  if (!instance.code || ['MARKETPLACE_ERROR', 'MARKETPLACE_HTTP_ERROR'].includes(instance.code)) {
    instance.code = code;
  }
  return instance;
}

function textoPreenchido(valor) {
  return typeof valor === 'string' && valor.trim() !== '';
}

function textoObrigatorio(valor, campo, code) {
  if (!textoPreenchido(valor)) {
    throw erro(`${campo} ausente ou inválido.`, code);
  }
  return valor.trim();
}

function segredoObrigatorio(nome) {
  const valor = getSecret(nome);
  if (!textoPreenchido(valor)) {
    throw erro(
      `Segredo obrigatório não configurado: ${nome}.`,
      'SEGREDO_AUSENTE'
    );
  }
  return valor.trim();
}

function inteiroPositivo(valor, campo, code) {
  const numero = typeof valor === 'number' || typeof valor === 'string' ? Number(valor) : NaN;
  if (!Number.isFinite(numero) || !Number.isInteger(numero) || numero <= 0) {
    throw erro(`${campo} deve ser um inteiro positivo.`, code);
  }
  return numero;
}

function inteiroOuNull(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) && Number.isInteger(numero) ? numero : null;
}

function textoOuNull(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

function codigoSeguro(valor) {
  return String(valor ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'ERRO_API';
}

/** `SHOPEE_ENV` (segredo de ambiente) define o host; padrão é produção. */
function urlBase() {
  const ambiente = textoPreenchido(getSecret('SHOPEE_ENV')) ? getSecret('SHOPEE_ENV').trim() : 'production';
  const url = Object.prototype.hasOwnProperty.call(AMBIENTES, ambiente) ? AMBIENTES[ambiente] : null;
  if (!url) {
    throw erro(
      'SHOPEE_ENV deve ser "production" ou "sandbox".',
      'AMBIENTE_SHOPEE_INVALIDO',
      ConfigError
    );
  }
  return url;
}

/**
 * Chamada assinada à Shop API. A assinatura usa o caminho da API (sem query),
 * conforme Push/OpenAPI v2: partner_id + path + timestamp + access_token +
 * shop_id, HMAC-SHA256 com partner_key.
 *
 * Exportada para reuso de inventory.js e webhook.js, evitando uma segunda
 * implementação de assinatura/URL. Nenhuma mensagem de erro carrega a URL: a
 * query contém token e assinatura.
 */
export async function callShopeeApi({
  path,
  accessToken,
  shopId,
  body = {},
  method = 'POST',
  timeoutMs,
  retries,
  operation = 'consulta'
} = {}) {
  const endpoint = textoObrigatorio(path, 'path da API', 'CAMINHO_API_AUSENTE');
  const token = textoObrigatorio(accessToken, 'access_token', 'ACCESS_TOKEN_AUSENTE');
  const shop = inteiroPositivo(shopId, 'shop_id', 'SHOP_ID_INVALIDO');
  const partnerId = segredoObrigatorio('SHOPEE_PARTNER_ID');
  const partnerKey = segredoObrigatorio('SHOPEE_PARTNER_KEY');
  const timestamp = Math.floor(Date.now() / 1000);

  const assinatura = sign({
    path: endpoint,
    timestamp,
    partnerId,
    partnerKey,
    accessToken: token,
    shopId: shop
  });

  const url = new URL(`${urlBase()}${endpoint}`);
  url.searchParams.set('partner_id', partnerId);
  url.searchParams.set('timestamp', String(timestamp));
  url.searchParams.set('sign', assinatura);
  url.searchParams.set('access_token', token);
  url.searchParams.set('shop_id', String(shop));

  const opcoes = {
    method: method === 'GET' ? 'GET' : 'POST',
    url: url.toString(),
    headers: { Accept: 'application/json' }
  };
  if (opcoes.method !== 'GET') {
    opcoes.body = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  }
  if (Number.isFinite(timeoutMs)) opcoes.timeoutMs = timeoutMs;
  if (Number.isFinite(retries)) opcoes.retries = retries;

  const resposta = await requestJson(opcoes);
  return validarRespostaShopee(resposta, operation);
}

/** CorpoShopee: `error`/`message`; falha fechada sem repetir a mensagem remota. */
function validarRespostaShopee(resposta, operation) {
  if (!resposta || typeof resposta.status !== 'number' || resposta.status < 200 || resposta.status >= 300) {
    throw erro(`A API Shopee não respondeu com sucesso (${operation}).`, 'SHOPEE_HTTP_ERROR', MarketplaceHttpError);
  }

  const corpo = resposta.body;
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    throw erro(`Resposta inválida da API Shopee (${operation}).`, 'SHOPEE_RESPOSTA_INVALIDA');
  }

  const erroRemoto = corpo.error;
  const falhou =
    erroRemoto !== undefined &&
    erroRemoto !== null &&
    erroRemoto !== 0 &&
    String(erroRemoto).toLowerCase() !== '' &&
    String(erroRemoto).toLowerCase() !== 'ok';
  if (falhou) {
    throw erro(
      `A API Shopee rejeitou a operação (${operation}).`,
      `SHOPEE_API_${codigoSeguro(erroRemoto)}`,
      MarketplaceHttpError
    );
  }

  return corpo;
}

function numeroFinito(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function tokenCursor(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'object') return null;
  const limpo = String(valor).trim();
  if (limpo === '' || limpo === '0' || limpo === 'null') return null;
  return limpo.slice(0, 200);
}

/**
 * Interpreta o cursor opaco e calcula a janela `time_from`/`time_to`.
 * Com `next_cursor` ativo, a janela anterior é preservada para paginar sem
 * repetir ou perder registros. Sem `next_cursor`, inicia janela nova com
 * sobreposição pequena (dedupe por ordersn é responsabilidade do serviço).
 */
export function parseOrderCursor(cursor, timespanSegundos = TIMESPAN_PADRAO_SEGUNDOS, agoraSegundos = Math.floor(Date.now() / 1000)) {
  const timespanSolicitado = numeroFinito(timespanSegundos);
  const timespan = Math.min(
    TIMESPAN_MAXIMO_SEGUNDOS,
    Math.max(
      TIMESPAN_MINIMO_SEGUNDOS,
      timespanSolicitado === null ? TIMESPAN_PADRAO_SEGUNDOS : Math.floor(timespanSolicitado)
    )
  );
  const agora = Math.floor(numeroFinito(agoraSegundos) ?? Math.floor(Date.now() / 1000));

  let estado = {};
  let cursorSimples = null;
  if (typeof cursor === 'string' && cursor.trim() !== '') {
    const bruto = cursor.trim();
    try {
      const parsed = JSON.parse(bruto);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        estado = parsed;
      } else {
        cursorSimples = bruto;
      }
    } catch {
      cursorSimples = bruto;
    }
  } else if (cursor && typeof cursor === 'object' && !Array.isArray(cursor)) {
    estado = cursor;
  }

  const nextCursor = tokenCursor(
    estado.nextCursor ?? estado.next_cursor ?? cursorSimples
  );
  const timeFromSalvo = numeroFinito(estado.timeFrom ?? estado.time_from);
  const timeToSalvo = numeroFinito(estado.timeTo ?? estado.time_to);

  let timeFrom;
  let timeTo;
  if (nextCursor !== null && timeToSalvo !== null) {
    // Paginação da mesma janela: mantém time_to e reaproveita time_from.
    timeTo = Math.floor(timeToSalvo);
    timeFrom = Math.floor(timeFromSalvo ?? Math.max(0, timeTo - timespan));
  } else {
    timeTo = agora;
    const ancora = timeToSalvo === null
      ? agora - timespan
      : timeToSalvo - SOBREPOSICAO_CURSOR_SEGUNDOS;
    timeFrom = Math.floor(Math.max(0, Math.min(ancora, agora)));
  }

  // A API rejeita janelas muito longas e intervalos invertidos.
  timeFrom = Math.max(0, Math.min(timeFrom, timeTo));
  if (timeTo - timeFrom > TIMESPAN_MAXIMO_SEGUNDOS) {
    timeFrom = timeTo - TIMESPAN_MAXIMO_SEGUNDOS;
  }

  return { timeFrom, timeTo, nextCursor };
}

function proximoCursor({ timeFrom, timeTo, hasMore, nextCursor }) {
  return JSON.stringify({
    v: VERSAO_CURSOR,
    timeFrom,
    timeTo,
    nextCursor: hasMore ? nextCursor : null
  });
}

function resumoPedido(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const ordersn = textoOuNull(item.ordersn ?? item.order_sn);
  if (ordersn === null) return null;
  return {
    ordersn,
    orderStatus: textoOuNull(item.order_status ?? item.orderStatus),
    createTime: inteiroOuNull(item.create_time ?? item.createTime),
    updateTime: inteiroOuNull(item.update_time ?? item.updateTime)
  };
}

/**
 * Lista pedidos recentes com janela temporal e paginação por cursor.
 *
 * @param {string} accessToken token de acesso descriptografado pelo chamador
 * @param {number|string} shopId loja Shopee conectada
 * @param {string|object|null} cursor cursor opaco retornado na chamada anterior
 * @param {number|object} [timespan] segundos da janela; objeto aceita
 *   `timespan`, `pageSize`, `orderStatus`, `now` e `agoraSegundos`
 * @returns {Promise<{orders: object[], nextCursor: string, hasMore: boolean,
 *   timeFrom: number, timeTo: number}>}
 */
export async function fetchRecentOrders(accessToken, shopId, cursor = null, timespan = TIMESPAN_PADRAO_SEGUNDOS) {
  const opcoes = typeof timespan === 'object' && timespan !== null ? timespan : { timespan };
  const relogio = numeroFinito(opcoes.agoraSegundos ?? opcoes.now);
  const agoraSegundos = Math.floor(
    relogio === null ? Date.now() / 1000 : (relogio > 1e12 ? relogio / 1000 : relogio)
  );
  const janela = parseOrderCursor(cursor, opcoes.timespan, agoraSegundos);

  const pageSizeBruto = numeroFinito(opcoes.pageSize);
  const pageSize = Math.min(
    TAMANHO_PAGINA_MAXIMO,
    Math.max(1, Math.floor(pageSizeBruto === null ? TAMANHO_PAGINA_PADRAO : pageSizeBruto))
  );

  const body = {
    time_from: janela.timeFrom,
    time_to: janela.timeTo,
    page_size: pageSize
  };
  if (janela.nextCursor !== null) body.cursor = janela.nextCursor;
  if (textoPreenchido(opcoes.orderStatus)) body.order_status = opcoes.orderStatus.trim();

  const resposta = await callShopeeApi({
    path: API_PATHS.orderList,
    accessToken,
    shopId,
    body,
    operation: 'listagem de pedidos'
  });

  const dados = resposta.response && typeof resposta.response === 'object' && !Array.isArray(resposta.response)
    ? resposta.response
    : {};
  const lista = Array.isArray(dados.order_list) ? dados.order_list : [];
  const orders = lista.map(resumoPedido).filter(Boolean);
  const cursorRemoto = tokenCursor(dados.next_cursor);
  const hasMore = Boolean(dados.has_more) && cursorRemoto !== null;

  return {
    orders,
    nextCursor: proximoCursor({
      timeFrom: janela.timeFrom,
      timeTo: janela.timeTo,
      hasMore,
      nextCursor: cursorRemoto
    }),
    hasMore,
    timeFrom: janela.timeFrom,
    timeTo: janela.timeTo
  };
}

function itemDetail(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const itemId = textoOuNull(item.item_id ?? item.itemId);
  const modelId = textoOuNull(item.model_id ?? item.modelId);
  const sku = textoOuNull(item.model_sku ?? item.modelSku ?? item.item_sku ?? item.itemSku);
  if (itemId === null && modelId === null && sku === null) return null;
  return {
    itemId,
    modelId,
    sku,
    quantity: inteiroOuNull(item.quantity)
  };
}

/**
 * Consulta o estado REAL do pedido na Shopee após um push. Nunca usa o payload
 * do webhook como fonte de status: o payload serve apenas como chave de busca.
 * Não cria nem cancela pedido.
 *
 * @param {string} accessToken token de acesso descriptografado pelo chamador
 * @param {number|string} shopId loja Shopee conectada
 * @param {string} ordersn número do pedido
 * @param {object} [opcoes] `timeoutMs`, `retries` (úteis no caminho do webhook)
 */
export async function getOrderDetail(accessToken, shopId, ordersn, opcoes = {}) {
  const numeroPedido = textoObrigatorio(ordersn, 'ordersn', 'ORDERSN_AUSENTE');

  const chamada = {
    path: API_PATHS.orderDetail,
    accessToken,
    shopId,
    body: { ordersn: numeroPedido },
    operation: 'detalhe do pedido'
  };
  if (Number.isFinite(opcoes.timeoutMs)) chamada.timeoutMs = opcoes.timeoutMs;
  if (Number.isFinite(opcoes.retries)) chamada.retries = opcoes.retries;

  const resposta = await callShopeeApi(chamada);
  const dados = resposta.response && typeof resposta.response === 'object' && !Array.isArray(resposta.response)
    ? resposta.response
    : {};
  const pedido = dados.order && typeof dados.order === 'object' && !Array.isArray(dados.order)
    ? dados.order
    : Array.isArray(dados.order_list) && dados.order_list[0] && typeof dados.order_list[0] === 'object'
      ? dados.order_list[0]
      : dados;

  const itens = Array.isArray(pedido.item_list) ? pedido.item_list : [];
  const total = numeroFinito(pedido.total_amount ?? pedido.totalAmount);
  const remoteOrdersn = textoOuNull(pedido.ordersn ?? pedido.order_sn) ?? numeroPedido;

  return {
    ordersn: remoteOrdersn,
    orderStatus: textoOuNull(pedido.order_status ?? pedido.orderStatus),
    createTime: inteiroOuNull(pedido.create_time ?? pedido.createTime),
    updateTime: inteiroOuNull(pedido.update_time ?? pedido.updateTime),
    totalAmount: total === null ? null : total,
    currency: textoOuNull(pedido.currency),
    items: itens.map(itemDetail).filter(Boolean)
  };
}
