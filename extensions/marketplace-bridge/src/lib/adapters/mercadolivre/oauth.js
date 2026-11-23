/**
 * OAuth do Mercado Livre (site MLB) — adaptador da extensão marketplace-bridge.
 *
 * Contrato (docs/ESPECIFICACAO_MARKETPLACES.md, §5):
 *   getAuthorizationUrl(state)
 *   exchangeCode(code)
 *   refreshAccessToken(refreshToken)
 *   getSellerIdentity(accessToken)
 *
 * Nenhuma função deste módulo registra logs: client_id, client_secret, code,
 * refresh_token, access_token e state nunca aparecem em mensagens de erro,
 * query de URL nem saída de console. A URL de autorização carrega state apenas
 * porque o chamador (dono 18, com validação gravada pelo dono 6) o forneceu.
 */
import { requestJson } from '../../http.js';
import {
  ConfigError,
  MarketplaceError,
  SecretsMissingError
} from '../../errors.js';
import { getSecret } from '../../secrets.js';

const MARKETPLACE = 'mercadolivre';
const SITE_ID = 'MLB';
const USER_PRODUCT_SELLER_TAG = 'user_product_seller';
const AUTHORIZATION_URL = 'https://auth.mercadolibre.com.br/authorization';
const API_BASE_URL = 'https://api.mercadolibre.com';
const TOKEN_URL = `${API_BASE_URL}/oauth/token`;

/** Erro de domínio com código estável, sem incluir valores sensíveis. */
function oauthError(message, code, ErrorClass = MarketplaceError) {
  return new ErrorClass(message, { code, marketplace: MARKETPLACE });
}

/** Lê apenas o nome da variável; o valor nunca entra na mensagem de erro. */
function requiredSecret(name) {
  const value = getSecret(name);
  if (typeof value !== 'string' || value.trim() === '') {
    throw oauthError(
      `Segredo obrigatório não configurado: ${name}.`,
      'SECRETS_MISSING',
      SecretsMissingError
    );
  }
  return value;
}

function requiredValue(value, field, code) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw oauthError(`${field} ausente ou inválido.`, code);
  }
  return value;
}

/**
 * Redirect HTTPS exato do cadastro no DevCenter: esquema/host/caminho/barra
 * final não são normalizados aqui (a normalização quebraria a comparação exata).
 */
function assertHttpsRedirect(redirectUri) {
  let parsed;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw oauthError(
      'ML_REDIRECT_URI inválida.',
      'OAUTH_REDIRECT_INVALID',
      ConfigError
    );
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw oauthError(
      'ML_REDIRECT_URI deve ser HTTPS, sem credenciais, query ou fragmento.',
      'OAUTH_REDIRECT_INVALID',
      ConfigError
    );
  }
}

/** requestJson responde { status, body, headers }; status não 2xx é falha fechada. */
function responseBody(response, context) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw oauthError(
      `Resposta inválida da API do Mercado Livre (${context}).`,
      'ML_RESPONSE_INVALID'
    );
  }
  if (typeof response.status === 'number' && (response.status < 200 || response.status >= 300)) {
    throw oauthError(
      `Falha na API do Mercado Livre (${context}, status ${response.status}).`,
      'ML_HTTP_ERROR'
    );
  }
  const body = response.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw oauthError(
      `Corpo inválido da API do Mercado Livre (${context}).`,
      'ML_RESPONSE_INVALID'
    );
  }
  return body;
}

/**
 * POST no endpoint de token. O corpo é form-urlencoded; é passado como texto
 * já codificado (requestJson deve repassar strings sem convertê-las em JSON).
 * retries: 0 porque code e refresh token são de uso único: repetir a chamada
 * automaticamente poderia consumir o segredo duas vezes sem sentido.
 */
async function postToken(params) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    form.set(key, value);
  }

  const response = await requestJson({
    method: 'POST',
    url: TOKEN_URL,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'
    },
    body: form.toString(),
    retries: 0
  });
  return responseBody(response, 'oauth/token');
}

/** Normaliza a resposta oficial sem devolver o corpo bruto com segredos extras. */
function parseToken(body) {
  const accessToken = body.access_token;
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw oauthError(
      'Resposta de token do Mercado Livre sem access_token.',
      'ML_TOKEN_INVALID'
    );
  }

  const refreshToken =
    typeof body.refresh_token === 'string' && body.refresh_token !== ''
      ? body.refresh_token
      : null;
  const rawExpiresIn = Number(body.expires_in);
  const expiresIn = Number.isFinite(rawExpiresIn) && rawExpiresIn > 0 ? rawExpiresIn : null;

  return {
    accessToken,
    refreshToken,
    tokenType:
      typeof body.token_type === 'string' && body.token_type !== ''
        ? body.token_type
        : 'Bearer',
    expiresIn,
    // Orientativo: o chamador pode usar o valor de expires_in da resposta.
    expiresAt:
      expiresIn === null ? null : new Date(Date.now() + expiresIn * 1000).toISOString(),
    scope: typeof body.scope === 'string' && body.scope !== '' ? body.scope : null,
    sellerId: body.user_id === undefined || body.user_id === null ? null : String(body.user_id)
  };
}

async function getJson(path, accessToken, context) {
  const response = await requestJson({
    method: 'GET',
    url: `${API_BASE_URL}${path}`,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`
    }
  });
  return responseBody(response, context);
}

/** A tag pode vir como texto ou como objeto, conforme a versão da resposta. */
function hasUserProductSellerTag(tags) {
  return tags.some((tag) => {
    if (typeof tag === 'string') {
      return tag === USER_PRODUCT_SELLER_TAG;
    }
    if (tag && typeof tag === 'object') {
      return (
        tag.id === USER_PRODUCT_SELLER_TAG ||
        tag.name === USER_PRODUCT_SELLER_TAG ||
        tag.tag === USER_PRODUCT_SELLER_TAG
      );
    }
    return false;
  });
}

/**
 * Monta a URL de autorização. `state` é obrigatório e fornecido pelo chamador:
 * ele deve gerá-lo com fonte criptográfica, gravá-lo via
 * saveOAuthState({ state, marketplace, adminUserId }) e consumi-lo de forma
 * atômica no callback (consumeOAuthState) antes de trocar o código.
 */
export function getAuthorizationUrl(state) {
  requiredValue(state, 'state', 'OAUTH_STATE_REQUIRED');

  const clientId = requiredSecret('ML_APP_ID');
  const redirectUri = requiredSecret('ML_REDIRECT_URI');
  assertHttpsRedirect(redirectUri);

  const url = new URL(AUTHORIZATION_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

/** Troca o `code` do callback por tokens; não registra nem reenvia o código. */
export async function exchangeCode(code) {
  requiredValue(code, 'code', 'OAUTH_CODE_REQUIRED');

  const clientId = requiredSecret('ML_APP_ID');
  const clientSecret = requiredSecret('ML_CLIENT_SECRET');
  const redirectUri = requiredSecret('ML_REDIRECT_URI');
  // O redirect enviado na troca deve ser o mesmo exato usado na autorização.
  assertHttpsRedirect(redirectUri);

  const body = await postToken({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri
  });
  return parseToken(body);
}

/**
 * Renova tokens; o refresh token do Mercado Livre é de USO ÚNICO.
 *
 * Este adaptador somente faz a troca remota. O chamador (dono 18, com lib/db.js
 * do dono 6) é responsável por, em uma transação e com lock por conta:
 *   1) verificar `used_at` do refresh atual; se preenchido, falhar fechado e
 *      exigir nova autorização (nunca reutilizar o mesmo refresh);
 *   2) marcar o refresh consumido com markTokenUsed(tokenId);
 *   3) cifrar os novos valores com encryptSecret() e gravá-los via saveToken({
 *      accountId, type, value, expiresAt, scope, generation }), usando
 *      generation + 1 também para o novo refresh token;
 *   4) tratar falha na gravação como necessidade de reautorização: o refresh
 *      remoto já foi consumido e não deve ser tentado novamente.
 */
export async function refreshAccessToken(refreshToken) {
  requiredValue(refreshToken, 'refresh_token', 'OAUTH_REFRESH_TOKEN_REQUIRED');

  const body = await postToken({
    grant_type: 'refresh_token',
    client_id: requiredSecret('ML_APP_ID'),
    client_secret: requiredSecret('ML_CLIENT_SECRET'),
    refresh_token: refreshToken
  });
  return parseToken(body);
}

/**
 * Identidade do vendedor: GET /users/me e GET /users/{id}. Só aceita
 * site_id === 'MLB' e sinaliza a tag user_product_seller (modelo User Products).
 * Devolve { sellerId, id, siteId, nickname, isUserProductSeller, tags }.
 */
export async function getSellerIdentity(accessToken) {
  requiredValue(accessToken, 'access_token', 'OAUTH_ACCESS_TOKEN_REQUIRED');

  const me = await getJson('/users/me', accessToken, 'users/me');
  if (me.site_id !== SITE_ID) {
    throw oauthError(
      'Conta do Mercado Livre fora do site MLB.',
      'ML_SITE_NOT_ALLOWED'
    );
  }
  if (me.id === undefined || me.id === null || me.id === '') {
    throw oauthError('Identidade do vendedor sem id.', 'ML_IDENTITY_INVALID');
  }

  const sellerId = String(me.id);
  const detail = await getJson(
    `/users/${encodeURIComponent(sellerId)}`,
    accessToken,
    'users/{id}'
  );
  if (detail.site_id !== SITE_ID) {
    throw oauthError(
      'Conta do Mercado Livre fora do site MLB.',
      'ML_SITE_NOT_ALLOWED'
    );
  }
  if (detail.id !== undefined && detail.id !== null && String(detail.id) !== sellerId) {
    throw oauthError(
      'Divergência de id entre /users/me e /users/{id}.',
      'ML_IDENTITY_INVALID'
    );
  }

  const rawTags = Array.isArray(detail.tags)
    ? detail.tags
    : Array.isArray(me.tags)
      ? me.tags
      : [];

  return {
    sellerId,
    id: sellerId,
    siteId: SITE_ID,
    nickname:
      typeof detail.nickname === 'string'
        ? detail.nickname
        : typeof me.nickname === 'string'
          ? me.nickname
          : null,
    isUserProductSeller: hasUserProductSellerTag(rawTags),
    tags: rawTags.filter((tag) => typeof tag === 'string')
  };
}
