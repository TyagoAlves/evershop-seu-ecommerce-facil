/** Normalização do envelope bruto dos webhooks e resolução segura de token. */

import { getMarketplaceSettings } from '../../lib/config.js';
import { listConnectedAccounts } from '../../lib/db.js';
import { obterAccessTokenDescriptografado } from './oauth.js';

function bufferDoCorpo(request) {
  if (Buffer.isBuffer(request?.body)) return request.body;
  if (Buffer.isBuffer(request?.rawBody)) return request.rawBody;
  if (typeof request?.body === 'string') return Buffer.from(request.body, 'utf8');
  return Buffer.alloc(0);
}

function corpoParseado(buffer) {
  if (buffer.length === 0) return {};
  const texto = buffer.toString('utf8');
  try {
    const analisado = JSON.parse(texto);
    return analisado && typeof analisado === 'object' ? analisado : texto;
  } catch {
    return texto;
  }
}

/**
 * Entrega aos adaptadores o envelope original: headers, query, caminho e corpo
 * bruto. Nenhuma função desta pasta registra esse conteúdo.
 */
export function criarEnvelopeWebhook(request) {
  const rawBody = bufferDoCorpo(request);
  return {
    method: request?.method ?? null,
    headers: request?.headers ?? {},
    query: request?.query ?? {},
    params: request?.params ?? {},
    path: request?.path ?? null,
    originalUrl: request?.originalUrl ?? request?.url ?? null,
    url: request?.url ?? request?.originalUrl ?? null,
    rawBody,
    body: corpoParseado(rawBody)
  };
}

/** Caminho configurado para a validação da assinatura, com fallback oficial. */
export function caminhoWebhookConfigurado(marketplace, padrao) {
  const configurado = getMarketplaceSettings(marketplace)?.webhookPath;
  return typeof configurado === 'string' && configurado.trim().startsWith('/')
    ? configurado.trim()
    : padrao;
}

function idDaLoja(conta) {
  const bruto = conta?.shop_id ?? conta?.shopId ?? conta?.seller_id ?? null;
  const numero = Number(bruto);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

/** Token descriptografado da loja que enviou o push; usado apenas no servidor. */
export async function obterTokenShopeePorLoja(shopId) {
  const numero = Number(shopId);
  if (!Number.isSafeInteger(numero) || numero <= 0) return null;

  const contas = await listConnectedAccounts('shopee');
  const conta = contas.find((item) => idDaLoja(item) === numero) ?? null;
  if (!conta) return null;
  return obterAccessTokenDescriptografado({ marketplace: 'shopee', conta });
}
