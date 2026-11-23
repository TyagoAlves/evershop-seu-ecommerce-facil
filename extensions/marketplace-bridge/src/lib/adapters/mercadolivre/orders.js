// Adaptador de consulta de pedidos do Mercado Livre (escopo exclusivo: site MLB).
// Este módulo apenas consulta a API oficial por meio de ./client.js. Ele NÃO cria pedido,
// transação, anúncio nem webhook remoto. Nenhum dado do comprador (nome, CPF, e-mail,
// telefone ou endereço) é devolvido ou registrado em log.

import { MarketplaceError, MarketplaceHttpError } from '../../errors.js';
import { toCents } from '../../pricing.js';
import * as mlClient from './client.js';

const SITE_ID_PADRAO = 'MLB';
const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 50;

function criarErro(mensagem, code) {
  return new MarketplaceError(mensagem, { code, marketplace: 'mercadolivre' });
}

function validarIdentificador(valor, nome) {
  const texto = valor == null ? '' : String(valor).trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(texto)) {
    throw criarErro(`Identificador ${nome} inválido para o Mercado Livre.`, `ID_${nome.toUpperCase()}_INVALIDO`);
  }
  return texto;
}

/** Formata datas para o formato aceito por date_from/date_to (sem milissegundos). */
export function formatarDataISO(valor) {
  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) {
    throw criarErro('Data de cursor inválida para consulta no Mercado Livre.', 'CURSOR_DATA_INVALIDO');
  }
  return data.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Wrapper único de acesso ao client.js do Mercado Livre.
 *
 * Assinatura real do cliente (agente 12): `request(accessToken, { method, path,
 * query, body, headers, idempotencyKey })`, devolvendo
 * `{ status, body, headers }` com `headers` sendo um `Headers` nativo.
 * `idempotencyKey` é repassado em todas as operações de escrita; nas leituras
 * ele permanece ausente. Nenhum token entra em URL, query, mensagem ou log.
 */
export async function requestMercadoLivre({
  accessToken,
  method = 'GET',
  path,
  query,
  body,
  idempotencyKey
}) {
  if (typeof accessToken !== 'string' || accessToken.trim() === '') {
    throw criarErro('Token de acesso do Mercado Livre ausente.', 'TOKEN_AUSENTE');
  }
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw criarErro('Caminho de requisição inválido para o Mercado Livre.', 'CAMINHO_INVALIDO');
  }
  if (typeof mlClient.request !== 'function') {
    throw criarErro('Cliente do Mercado Livre indisponível.', 'CLIENTE_INDISPONIVEL');
  }

  const opcoes = { method, path, query, body };
  if (typeof idempotencyKey === 'string' && idempotencyKey.trim() !== '') {
    opcoes.idempotencyKey = idempotencyKey.trim();
  }

  const resposta = await mlClient.request(accessToken, opcoes);
  return normalizarResposta(resposta, path);
}

/** `headers` do requestJson é o objeto Headers nativo: usar headers.get(). */
function obterHeader(headers, nome) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(nome);
  return headers[nome] ?? headers[nome.toLowerCase()] ?? null;
}

function normalizarResposta(resposta, path) {
  const envelope = resposta
    && typeof resposta === 'object'
    && !Array.isArray(resposta)
    && 'status' in resposta
    && 'body' in resposta;
  const status = envelope ? Number(resposta.status) : 200;
  const corpo = envelope ? resposta.body : resposta;
  const headers = envelope ? (resposta.headers ?? null) : null;

  if (!Number.isFinite(status) || status >= 400) {
    const requestId = obterHeader(headers, 'x-request-id') ?? corpo?.request_id ?? null;
    throw new MarketplaceHttpError(
      `Falha na API do Mercado Livre ao acessar ${path} (status ${Number.isFinite(status) ? status : 'desconhecido'}).`,
      {
        status,
        ...(requestId != null ? { requestId: String(requestId).slice(0, 100) } : {}),
        marketplace: 'mercadolivre'
      }
    );
  }

  return { status, body: corpo ?? {}, headers };
}

function interpretarCursor(cursor, limiteSolicitado) {
  const limite = Number.isInteger(limiteSolicitado) && limiteSolicitado > 0
    ? Math.min(limiteSolicitado, LIMITE_MAXIMO)
    : LIMITE_PADRAO;

  if (cursor == null || cursor === '') {
    return { offset: 0, limit: limite };
  }
  if (typeof cursor === 'number' || (typeof cursor === 'string' && /^\d+$/.test(cursor))) {
    const offset = Number(cursor);
    return { offset: Number.isFinite(offset) && offset >= 0 ? offset : 0, limit: limite };
  }
  if (typeof cursor === 'object') {
    const offsetBruto = Number(cursor.offset);
    const limiteCursor = Number(cursor.limit);
    return {
      offset: Number.isInteger(offsetBruto) && offsetBruto >= 0 ? offsetBruto : 0,
      limit: Number.isInteger(limiteCursor) && limiteCursor > 0
        ? Math.min(limiteCursor, LIMITE_MAXIMO)
        : limite,
      dateFrom: cursor.dateFrom ?? cursor.date_from ?? cursor.desde ?? null,
      dateTo: cursor.dateTo ?? cursor.date_to ?? cursor.ate ?? null
    };
  }
  if (typeof cursor === 'string' && !Number.isNaN(Date.parse(cursor))) {
    return { offset: 0, limit: limite, dateFrom: cursor };
  }
  throw criarErro('Formato de cursor de pedidos não reconhecido.', 'CURSOR_INVALIDO');
}

function converterParaCentavos(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) {
    return null;
  }
  return toCents(numero);
}

function mapearItemResumo(item) {
  return {
    itemId: item?.item?.id != null ? String(item.item.id) : null,
    title: typeof item?.item?.title === 'string' ? item.item.title.slice(0, 200) : null,
    sku: item?.item?.seller_custom_field ?? item?.item?.seller_sku ?? null,
    quantity: Number.isFinite(Number(item?.quantity)) ? Number(item.quantity) : null,
    unitPriceCents: converterParaCentavos(item?.unit_price ?? item?.item?.price)
  };
}

function resumirPedido(pedido) {
  return {
    id: pedido?.id != null ? String(pedido.id) : null,
    siteId: pedido?.site_id ?? null,
    status: pedido?.status ?? null,
    statusDetail: pedido?.status_detail ?? null,
    dateCreated: pedido?.date_created ?? null,
    dateClosed: pedido?.date_closed ?? null,
    sellerId: pedido?.seller?.id != null ? String(pedido.seller.id) : null,
    currencyId: pedido?.currency_id ?? null,
    totalCents: converterParaCentavos(pedido?.total_amount ?? pedido?.paid_amount),
    items: Array.isArray(pedido?.items) ? pedido.items.map(mapearItemResumo) : []
  };
}

function detalharPedido(pedido) {
  const resumo = resumirPedido(pedido);
  return {
    ...resumo,
    shipping: pedido?.shipping
      ? {
          id: pedido.shipping.id != null ? String(pedido.shipping.id) : null,
          status: pedido.shipping.status ?? null,
          shipmentType: pedido.shipping.shipment_type ?? null
        }
      : null
  };
}

/**
 * Busca pedidos recentes em GET /orders/search?seller=...&sort=date_desc.
 * `cursor` aceita: número/string numérica (offset), objeto
 * `{ offset, limit, dateFrom, dateTo }`, string ISO (date_from) ou null.
 * @returns {{ orders: object[], results: object[], nextCursor: object|null,
 *             hasMore: boolean, total: number|null, siteId: string }}
 */
export async function fetchRecentOrders(accessToken, sellerId, cursor, opcoes = {}) {
  const seller = validarIdentificador(sellerId, 'sellerId');
  const siteId = opcoes.siteId ?? SITE_ID_PADRAO;
  const estado = interpretarCursor(cursor, opcoes.limit);

  const query = {
    seller,
    sort: 'date_desc',
    limit: estado.limit,
    offset: estado.offset
  };
  if (estado.dateFrom) {
    query.date_from = formatarDataISO(estado.dateFrom);
  }
  if (estado.dateTo) {
    query.date_to = formatarDataISO(estado.dateTo);
  }

  const { body } = await requestMercadoLivre({
    accessToken,
    method: 'GET',
    path: '/orders/search',
    query
  });

  const elementos = Array.isArray(body?.results)
    ? body.results
    : Array.isArray(body?.elements)
      ? body.elements
      : Array.isArray(body)
        ? body
        : [];
  const pedidos = elementos
    .filter((pedido) => pedido?.site_id === siteId)
    .map(resumirPedido);

  const totalBruto = Number(body?.paging?.total);
  const total = Number.isFinite(totalBruto) ? totalBruto : null;
  const offsetAtual = Number(body?.paging?.offset ?? estado.offset);
  const limiteAtual = Number(body?.paging?.limit ?? estado.limit);
  const proximoOffset = (Number.isFinite(offsetAtual) ? offsetAtual : estado.offset) + elementos.length;
  const hasMore = total != null
    ? proximoOffset < total
    : elementos.length === (Number.isFinite(limiteAtual) ? limiteAtual : estado.limit);

  const proximoCursor = hasMore
    ? {
        offset: proximoOffset,
        limit: estado.limit,
        ...(estado.dateFrom ? { dateFrom: estado.dateFrom } : {}),
        ...(estado.dateTo ? { dateTo: estado.dateTo } : {})
      }
    : null;

  return {
    orders: pedidos,
    results: pedidos,
    nextCursor: proximoCursor,
    hasMore,
    total,
    siteId
  };
}

/** Busca um pedido em GET /orders/{id} e rejeita qualquer site_id diferente de MLB. */
export async function getOrderDetail(accessToken, orderId, opcoes = {}) {
  const id = validarIdentificador(orderId, 'orderId');
  const siteId = opcoes.siteId ?? SITE_ID_PADRAO;
  const { body } = await requestMercadoLivre({
    accessToken,
    method: 'GET',
    path: `/orders/${encodeURIComponent(id)}`
  });

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw criarErro('Resposta inválida ao consultar pedido no Mercado Livre.', 'PEDIDO_RESPOSTA_INVALIDA');
  }
  if (body.site_id !== siteId) {
    throw criarErro('Pedido consultado pertence a site diferente do escopo configurado.', 'PEDIDO_FORA_DO_SITE');
  }

  return detalharPedido(body);
}
