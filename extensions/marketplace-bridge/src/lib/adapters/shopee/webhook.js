/**
 * Webhook (Push Mechanism) da Shopee BR — adaptador da extensão marketplace-bridge.
 *
 * Contrato (docs/ESPECIFICACAO_MARKETPLACES.md, §5, §7 e §8):
 *   verifyWebhook(request)
 *   parseNotification(request)
 *   handleNotification(request, context)
 *
 * Fluxo obrigatório:
 * 1) validar a chamada com SHOPEE_WEBHOOK_SECRET (e com a assinatura nativa da
 *    Shopee quando `SHOPEE_PARTNER_KEY` estiver disponível);
 * 2) responder 2xx rapidamente após registrar o evento com dedupe;
 * 3) consultar a API para obter o estado REAL do pedido — o payload do push
 *    serve somente como chave de busca (ordersn/item_id/model_id), nunca como
 *    fonte de status, preço, estoque ou dados de comprador;
 * 4) não criar pedido, não cancelar pedido e não persistir dados pessoais.
 *
 * Nenhuma função registra logs. O payload redigido enviado a `recordEvent`
 * contém apenas identificadores técnicos e o estado devolvido pela API.
 */

import { hmacSha256Hex, safeEqual } from '../../crypto.js';
import { getSecret } from '../../secrets.js';
import { recordEvent } from '../../events.js';
import { stableHash } from '../../idempotency.js';
import { WebhookVerificationError } from '../../errors.js';
import { sign } from './sign.js';
import { getOrderDetail, MARKETPLACE } from './orders.js';

/** Status que a rota pública deve devolver quando a validação passar. */
export const WEBHOOK_ACK_STATUS = 200;

const TOLERANCIA_SEGUNDOS_PADRAO = 300; // assinatura Shopee válida por 5 min
const CONSULTA_DETALHE_TIMEOUT_MS = 2500;
const PROFUNDIDADE_MAXIMA_DADOS = 8;

function erro(mensagem, code, ErrorClass = WebhookVerificationError) {
  const instance = new ErrorClass(mensagem, { marketplace: MARKETPLACE });
  if (!instance.code || instance.code === 'MARKETPLACE_ERROR' || instance.code === 'WEBHOOK_VERIFICATION_ERROR') {
    instance.code = code;
  }
  return instance;
}

function textoPreenchido(valor) {
  return typeof valor === 'string' && valor.trim() !== '';
}

function textoOuNull(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

function queryFrom(request) {
  const params = new URLSearchParams();
  const origem = request && typeof request === 'object' ? request : {};

  const fontes = [origem.query, origem.params, origem.searchParams];
  for (const fonte of fontes) {
    if (!fonte) continue;
    if (typeof fonte.forEach === 'function' && typeof fonte.get === 'function') {
      fonte.forEach((valor, chave) => params.set(chave, valor));
      continue;
    }
    if (typeof fonte === 'object' && !Array.isArray(fonte)) {
      for (const [chave, valor] of Object.entries(fonte)) {
        if (valor !== undefined && valor !== null) params.set(chave, String(valor));
      }
    }
  }

  if ([...params.keys()].length === 0 && typeof origem.url === 'string') {
    try {
      const url = new URL(origem.url, 'https://localhost');
      url.searchParams.forEach((valor, chave) => params.set(chave, valor));
    } catch {
      // URL inválida: validação falha fechada adiante por falta de parâmetros.
    }
  }
  return params;
}

function headerFrom(headers, nome) {
  if (!headers || typeof headers !== 'object') return null;
  if (typeof headers.get === 'function') {
    const valor = headers.get(nome);
    return textoOuNull(valor);
  }
  const alvo = nome.toLowerCase();
  for (const [chave, valor] of Object.entries(headers)) {
    if (chave.toLowerCase() === alvo) return textoOuNull(valor);
  }
  return null;
}

function caminhosAssinatura(request, options) {
  const caminhos = [];
  const adicionar = (valor) => {
    const texto = textoOuNull(valor);
    if (texto && !caminhos.includes(texto)) caminhos.push(texto);
  };

  adicionar(options.webhookPath);
  adicionar(request?.path);
  adicionar(request?.route);

  if (typeof request?.url === 'string') {
    try {
      adicionar(new URL(request.url, 'https://localhost').pathname);
    } catch {
      // URL inválida não produz caminho extra.
    }
  }

  // Se o segredo foi colocado como último segmento do caminho, a assinatura
  // pode ter sido calculada sobre o caminho registrado sem esse segmento.
  for (const caminho of [...caminhos]) {
    const partes = caminho.split('/');
    const ultima = partes[partes.length - 1];
    if (textoPreenchido(ultima) && ultima.length >= 16) {
      adicionar(partes.slice(0, -1).join('/') || '/');
    }
  }
  return caminhos;
}

function timestampSegundos(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) return null;
  // Shopee envia segundos; aceita milissegundos para tolerar variações de gateway.
  return numero > 1e12 ? Math.floor(numero / 1000) : Math.floor(numero);
}

function timestampRecente(timestamp, agoraMs, toleranciaSegundos) {
  const agoraSegundos = agoraMs / 1000;
  return Number.isFinite(agoraSegundos) && Math.abs(agoraSegundos - timestamp) <= toleranciaSegundos;
}

/**
 * Valida o Push Mechanism da Shopee.
 *
 * A assinatura nativa usa `partner_id + path + timestamp` como base. Por
 * defensividade, aceita HMAC com `SHOPEE_PARTNER_KEY` (regra oficial) ou com
 * `SHOPEE_WEBHOOK_SECRET` (segredo dedicado da instalação, exigido pelo
 * contrato); também aceita o segredo dedicado enviado como parâmetro/cabeçalho
 * ou segmento do caminho. Todas as comparações são em tempo constante.
 *
 * @returns {true} quando válido
 * @throws {WebhookVerificationError} quando inválido ou sem segredo configurado
 */
export function verifyWebhook(request = {}, options = {}) {
  const query = queryFrom(request);
  const webhookSecret = getSecret('SHOPEE_WEBHOOK_SECRET');
  if (!textoPreenchido(webhookSecret)) {
    throw erro(
      'Segredo do webhook Shopee não configurado.',
      'WEBHOOK_SEGREDO_AUSENTE'
    );
  }

  const partnerId = textoOuNull(query.get('partner_id'));
  const timestampTexto = textoOuNull(query.get('timestamp'));
  const assinaturaRecebida = textoOuNull(query.get('sign'));
  const shopId = textoOuNull(query.get('shop_id'));
  const code = textoOuNull(query.get('code'));

  const faltantes = [];
  if (!partnerId) faltantes.push('partner_id');
  if (!timestampTexto) faltantes.push('timestamp');
  if (!assinaturaRecebida) faltantes.push('sign');
  if (!shopId) faltantes.push('shop_id');
  if (!code) faltantes.push('code');
  if (faltantes.length > 0) {
    throw erro(
      `Push Shopee incompleto: ${faltantes.join(', ')}.`,
      'WEBHOOK_PARAMETROS_AUSENTES'
    );
  }

  const timestamp = timestampSegundos(timestampTexto);
  if (timestamp === null) {
    throw erro('Timestamp do push Shopee inválido.', 'WEBHOOK_TIMESTAMP_INVALIDO');
  }
  const agoraMs = Number.isFinite(options.now) ? options.now : Date.now();
  const tolerancia = Number.isFinite(options.toleranceSeconds)
    ? Math.max(1, Math.floor(options.toleranceSeconds))
    : TOLERANCIA_SEGUNDOS_PADRAO;
  if (!timestampRecente(timestamp, agoraMs, tolerancia)) {
    throw erro('Timestamp do push Shopee fora da janela aceita.', 'WEBHOOK_TIMESTAMP_EXPIRADO');
  }

  const assinatura = assinaturaRecebida.toLowerCase();
  const caminhos = caminhosAssinatura(request, options);
  if (caminhos.length === 0) {
    throw erro('Caminho do webhook Shopee não informado.', 'WEBHOOK_CAMINHO_AUSENTE');
  }

  const partnerKey = getSecret('SHOPEE_PARTNER_KEY');
  const chaves = [webhookSecret];
  if (textoPreenchido(partnerKey)) chaves.push(partnerKey.trim());

  let assinaturaValida = false;
  for (const caminho of caminhos) {
    const base = `${partnerId}${caminho}${timestamp}`;
    for (const chave of chaves) {
      let esperada;
      try {
        if (chave === partnerKey?.trim()) {
          esperada = sign({
            path: caminho,
            timestamp,
            partnerId,
            partnerKey: chave,
            accessToken: '',
            shopId: 0
          });
        } else {
          esperada = hmacSha256Hex(chave, base);
        }
      } catch {
        esperada = null;
      }
      if (esperada && safeEqual(esperada, assinatura)) {
        assinaturaValida = true;
        break;
      }
    }
    if (assinaturaValida) break;
  }

  if (!assinaturaValida) {
    // Segundo fator: segredo dedicado no query, cabeçalho ou caminho.
    const tokens = [
      query.get('secret'),
      query.get('webhook_secret'),
      query.get('token'),
      headerFrom(request.headers, 'x-webhook-secret')
    ].filter((valor) => textoPreenchido(valor));
    const tokenNoCaminho = caminhos.some((caminho) =>
      caminho.split('/').some((segmento) => textoPreenchido(segmento) && safeEqual(segmento, webhookSecret))
    );
    const tokenValido = tokenNoCaminho || tokens.some((valor) => safeEqual(valor.trim(), webhookSecret));
    if (!tokenValido) {
      throw erro('Assinatura do push Shopee inválida.', 'WEBHOOK_ASSINATURA_INVALIDA');
    }
  }

  return true;
}

/** Converte o JSON de `data` sem confiar no conteúdo recebido. */
function parseData(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'object' && !Array.isArray(valor)) return valor;
  if (Array.isArray(valor)) return valor;
  if (typeof valor !== 'string') return null;
  try {
    const parsed = JSON.parse(valor);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function procurarIdentificadores(valor, destino, profundidade = 0) {
  if (!valor || profundidade > PROFUNDIDADE_MAXIMA_DADOS) return;
  if (Array.isArray(valor)) {
    for (const item of valor) procurarIdentificadores(item, destino, profundidade + 1);
    return;
  }
  if (typeof valor !== 'object') return;

  for (const [chaveBruta, valorFilho] of Object.entries(valor)) {
    const chave = chaveBruta.toLowerCase();
    if (typeof valorFilho === 'string' || typeof valorFilho === 'number') {
      if ((chave === 'ordersn' || chave === 'order_sn') && !destino.ordersn) {
        destino.ordersn = textoOuNull(valorFilho);
      }
      if ((chave === 'item_id' || chave === 'itemid') && !destino.itemId) {
        destino.itemId = textoOuNull(valorFilho);
      }
      if ((chave === 'model_id' || chave === 'modelid') && !destino.modelId) {
        destino.modelId = textoOuNull(valorFilho);
      }
    }
    procurarIdentificadores(valorFilho, destino, profundidade + 1);
  }
}

/**
 * Normaliza o push para `{ shopId, code, ordersn, itemId, modelId, timestamp, data }`.
 * `data` bruto NUNCA é devolvido: apenas identificadores técnicos são extraídos.
 */
export function parseNotification(request = {}, options = {}) {
  const query = queryFrom(request);
  const corpo = request && request.body && typeof request.body === 'object' && !Array.isArray(request.body)
    ? request.body
    : {};
  const valor = (nome) => query.get(nome) ?? corpo[nome] ?? corpo[nome.replace(/_/g, '')] ?? null;

  const data = parseData(valor('data'));
  const identificadores = { ordersn: null, itemId: null, modelId: null };
  procurarIdentificadores(data, identificadores);

  const timestamp = timestampSegundos(valor('timestamp'));
  return {
    shopId: textoOuNull(valor('shop_id') ?? options.shopId),
    code: textoOuNull(valor('code')),
    timestamp,
    ordersn: identificadores.ordersn,
    itemId: identificadores.itemId,
    modelId: identificadores.modelId,
    data,
    parsed: data !== null
  };
}

function topicFrom(code) {
  const limpo = String(code ?? '').replace(/[^A-Za-z0-9_-]/g, '').toUpperCase();
  return limpo ? `shopee.${limpo.toLowerCase()}` : 'shopee.webhook';
}

/**
 * Chave externa determinística: marketplace + shop + código + ordersn/item_id/
 * model_id. `recordEvent` deriva o dedupe dessa chave, então pushes repetidos
 * não geram eventos duplicados e o estado do payload não entra no cálculo.
 */
export function externalEventIdFor(notification) {
  const partes = [
    MARKETPLACE,
    notification?.shopId ?? '',
    notification?.code ?? '',
    notification?.ordersn ?? '',
    notification?.itemId ?? '',
    notification?.modelId ?? ''
  ].map((valor) => String(valor));
  return stableHash(partes);
}

/** Payload mínimo e redigido: sem nome, CPF, e-mail, telefone ou endereço. */
function payloadRedacted(notification, remoteState = null) {
  return {
    origem: 'push',
    shopId: notification.shopId,
    code: notification.code,
    ordersn: notification.ordersn,
    itemId: notification.itemId,
    modelId: notification.modelId,
    timestamp: notification.timestamp,
    estadoRemoto: remoteState
  };
}

async function resolverAccessToken(context, notification) {
  if (typeof context.accessToken === 'string' && context.accessToken.trim() !== '') {
    return context.accessToken.trim();
  }
  if (typeof context.getAccessToken === 'function') {
    const token = await context.getAccessToken({
      shopId: notification.shopId,
      notification
    });
    return typeof token === 'string' && token.trim() !== '' ? token.trim() : null;
  }
  return null;
}

function codigoSeguro(valor) {
  return String(valor ?? 'FALHA_CONSULTA')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .slice(0, 60);
}

/**
 * Recebe o push, registra o evento com dedupe e consulta a API para obter o
 * estado real do pedido. A rota deve devolver `status` (200) assim que esta
 * função terminar; para SLA mais rígido, o chamador pode passar
 * `context.deferRemoteRefresh = true` e consumir `followUp` em um worker.
 *
 * @param {object} request requisição HTTP (query/url/headers/body)
 * @param {object} [context] `getAccessToken` ou `accessToken`, `webhookPath`,
 *   `recordEvent` (injeção para testes), `deferRemoteRefresh`
 */
export async function handleNotification(request = {}, context = {}) {
  verifyWebhook(request, context);
  const notification = parseNotification(request, context);
  const topic = topicFrom(notification.code);
  const externalEventId = externalEventIdFor(notification);
  const gravarEvento = typeof context.recordEvent === 'function' ? context.recordEvent : recordEvent;

  const evento = await gravarEvento({
    marketplace: MARKETPLACE,
    topic,
    externalEventId,
    payload: payloadRedacted(notification)
  });

  let remoteState = null;
  const remoteRefresh = { tentado: false, ok: false };
  if (context.deferRemoteRefresh !== true) {
    const token = await resolverAccessToken(context, notification);
    if (token && notification.ordersn && notification.shopId) {
      remoteRefresh.tentado = true;
      try {
        remoteState = await getOrderDetail(token, notification.shopId, notification.ordersn, {
          timeoutMs: CONSULTA_DETALHE_TIMEOUT_MS,
          retries: 0
        });
        remoteRefresh.ok = true;
      } catch (erroConsulta) {
        // Nunca devolve mensagem da API: ela pode conter dados do pedido.
        remoteRefresh.erro = codigoSeguro(erroConsulta?.code);
      }
    }
  }

  const followUp = remoteRefresh.tentado
    ? null
    : {
        operation: 'refreshOrderDetail',
        shopId: notification.shopId,
        ordersn: notification.ordersn,
        reason: remoteState ? 'SEM_DADOS' : 'REFRESH_DIFERIDO_OU_SEM_CREDENCIAL'
      };

  return {
    status: WEBHOOK_ACK_STATUS,
    received: true,
    duplicate: Boolean(evento?.duplicate),
    dedupeKey: textoOuNull(evento?.dedupeKey),
    eventId: textoOuNull(evento?.eventId),
    topic,
    notification: {
      shopId: notification.shopId,
      code: notification.code,
      ordersn: notification.ordersn,
      itemId: notification.itemId,
      modelId: notification.modelId,
      timestamp: notification.timestamp
    },
    remoteState,
    remoteRefresh,
    followUp
  };
}

/** Corpo padrão da resposta 2xx para a rota pública do webhook. */
export function webhookAck(resultado = {}) {
  return {
    status: WEBHOOK_ACK_STATUS,
    body: {
      received: true,
      duplicate: Boolean(resultado.duplicate)
    }
  };
}
