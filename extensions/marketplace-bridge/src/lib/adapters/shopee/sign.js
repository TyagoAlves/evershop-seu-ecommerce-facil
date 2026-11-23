import { hmacSha256Hex } from '../../crypto.js';
import { ConfigError } from '../../errors.js';

const MARKETPLACE = 'shopee';

// A Shopee aceita o timestamp por aproximadamente 5 minutos.
const VALIDADE_TIMESTAMP_SEGUNDOS = 300;

function erroDeConfiguracao(mensagem) {
  return new ConfigError(mensagem, { marketplace: MARKETPLACE });
}

/** Segundos inteiros desde a época, no formato exigido pela Shopee. */
export function timestampAtual() {
  return Math.floor(Date.now() / 1000);
}

function normalizarTimestamp(timestamp) {
  let texto;

  if (typeof timestamp === 'number') {
    if (!Number.isSafeInteger(timestamp)) {
      throw erroDeConfiguracao('Timestamp da Shopee deve ser um inteiro em segundos.');
    }
    texto = String(timestamp);
  } else if (typeof timestamp === 'string' && /^\d+$/.test(timestamp)) {
    texto = timestamp;
  } else {
    throw erroDeConfiguracao('Timestamp da Shopee deve ser um inteiro em segundos.');
  }

  const valor = Number(texto);
  if (!Number.isSafeInteger(valor) || valor <= 0) {
    throw erroDeConfiguracao('Timestamp da Shopee deve ser um inteiro positivo em segundos.');
  }

  if (Math.abs(timestampAtual() - valor) > VALIDADE_TIMESTAMP_SEGUNDOS) {
    throw erroDeConfiguracao('Timestamp da Shopee fora da janela de validade de 5 minutos.');
  }

  // Mantemos o texto exato que será enviado na query: a assinatura depende dele.
  return texto;
}

function normalizarPath(path) {
  if (typeof path !== 'string' || !/^\/[^\s?#]+$/.test(path)) {
    throw erroDeConfiguracao(
      'Path da Shopee inválido para assinatura: informe somente o caminho, sem query.'
    );
  }
  return path;
}

function normalizarPartnerId(partnerId) {
  if (typeof partnerId === 'number' && Number.isSafeInteger(partnerId) && partnerId > 0) {
    return String(partnerId);
  }
  if (typeof partnerId === 'string' && /^[1-9]\d*$/.test(partnerId)) {
    return partnerId;
  }
  throw erroDeConfiguracao('partner_id da Shopee ausente ou inválido.');
}

function normalizarPartnerKey(partnerKey) {
  if (typeof partnerKey !== 'string' || partnerKey === '') {
    throw erroDeConfiguracao('partner_key da Shopee ausente ou inválido.');
  }
  // O valor não é validado nem registrado: segredos nunca entram em mensagens.
  return partnerKey;
}

function normalizarAccessToken(accessToken) {
  if (
    typeof accessToken !== 'string' ||
    accessToken === '' ||
    accessToken.trim() !== accessToken
  ) {
    throw erroDeConfiguracao('access_token da Shopee inválido para assinatura.');
  }
  return accessToken;
}

function normalizarShopId(shopId) {
  if (
    shopId === undefined ||
    shopId === null ||
    shopId === '' ||
    shopId === 0 ||
    shopId === '0'
  ) {
    return 0;
  }

  if (typeof shopId === 'number' && Number.isSafeInteger(shopId) && shopId > 0) {
    return shopId;
  }
  if (typeof shopId === 'string' && /^[1-9]\d*$/.test(shopId)) {
    const valor = Number(shopId);
    if (Number.isSafeInteger(valor)) {
      return valor;
    }
  }

  throw erroDeConfiguracao('shop_id da Shopee inválido para assinatura.');
}

/**
 * Assina a requisição da Shopee com HMAC-SHA256 em hex minúsculo.
 *
 * - Rotas públicas de autenticação (`/api/v2/auth/token/get` e
 *   `/api/v2/auth/access_token/get`): `partner_id + path + timestamp`.
 * - Shop API: `partner_id + path + timestamp + access_token + shop_id`.
 *
 * `access_token` e `shop_id` devem vir juntos ou nenhum dos dois. A base string
 * nunca é registrada: na Shop API ela contém token, e `partner_key` é segredo.
 *
 * @param {object} opcoes
 * @param {string} opcoes.path Caminho da rota, sem host, query ou fragmento.
 * @param {number|string} opcoes.timestamp Segundos inteiros (janela de 5 min).
 * @param {string|number} opcoes.partnerId Identificador do parceiro.
 * @param {string} opcoes.partnerKey Chave secreta do parceiro (somente no servidor).
 * @param {string} [opcoes.accessToken] Token da Shop API, quando aplicável.
 * @param {number|string} [opcoes.shopId] Loja da Shop API, quando aplicável.
 * @returns {string} Assinatura em hex minúsculo.
 */
export function sign({
  path,
  timestamp,
  partnerId,
  partnerKey,
  accessToken = '',
  shopId = 0
} = {}) {
  const caminho = normalizarPath(path);
  const instante = normalizarTimestamp(timestamp);
  const idParceiro = normalizarPartnerId(partnerId);
  const chave = normalizarPartnerKey(partnerKey);
  const token = normalizarAccessToken(accessToken);
  const idLoja = normalizarShopId(shopId);

  const usaShopApi = token !== '' || idLoja !== 0;
  if (usaShopApi && (token === '' || idLoja === 0)) {
    throw erroDeConfiguracao(
      'Assinatura da Shop API exige access_token e shop_id em conjunto.'
    );
  }

  const base = usaShopApi
    ? `${idParceiro}${caminho}${instante}${token}${idLoja}`
    : `${idParceiro}${caminho}${instante}`;

  // Nunca logar `base` nem `chave`: a base pode conter access_token.
  return hmacSha256Hex(chave, base).toLowerCase();
}
