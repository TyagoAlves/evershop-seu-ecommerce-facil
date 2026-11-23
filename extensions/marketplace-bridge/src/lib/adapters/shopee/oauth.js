import { getSecret } from '../../secrets.js';
import {
  ConfigError,
  MarketplaceHttpError,
  SecretsMissingError
} from '../../errors.js';
import { requestJson } from '../../http.js';
import { sign, timestampAtual } from './sign.js';

const MARKETPLACE = 'shopee';
const CAMINHO_TOKEN = '/api/v2/auth/token/get';
const CAMINHO_REFRESH = '/api/v2/auth/access_token/get';

// Hosts oficiais conforme SHOPEE_ENV; nunca misturar credenciais entre ambientes.
const AMBIENTES = Object.freeze({
  production: Object.freeze({
    api: 'https://openplatform.shopee.com.br',
    autorizacao: 'https://open.shopee.com.br/auth'
  }),
  sandbox: Object.freeze({
    api: 'https://openplatform.sandbox.test-stable.shopee.com.br',
    autorizacao: 'https://open.sandbox.test-stable.shopee.com.br/auth'
  })
});

function erroDeConfiguracao(mensagem) {
  return new ConfigError(mensagem, { marketplace: MARKETPLACE });
}

function ambiente() {
  const valor = getSecret('SHOPEE_ENV') ?? 'production';
  if (valor !== 'production' && valor !== 'sandbox') {
    throw erroDeConfiguracao('SHOPEE_ENV deve ser "production" ou "sandbox".');
  }
  return valor;
}

/** Lê apenas as variáveis necessárias; nomes ausentes são informados sem valores. */
function credenciais({ comRedirect = false } = {}) {
  const nomes = ['SHOPEE_PARTNER_ID', 'SHOPEE_PARTNER_KEY'];
  if (comRedirect) {
    nomes.push('SHOPEE_REDIRECT_URI');
  }

  const valores = {};
  const faltando = [];
  for (const nome of nomes) {
    const valor = getSecret(nome);
    if (valor === null) {
      faltando.push(nome);
    } else {
      valores[nome] = valor;
    }
  }

  if (faltando.length > 0) {
    throw new SecretsMissingError(
      `Segredos ausentes para shopee: ${faltando.join(', ')}.`,
      { marketplace: MARKETPLACE, missing: faltando }
    );
  }

  return {
    partnerId: valores.SHOPEE_PARTNER_ID,
    partnerKey: valores.SHOPEE_PARTNER_KEY,
    redirectUri: valores.SHOPEE_REDIRECT_URI ?? null
  };
}

function textoObrigatorio(valor, descricao) {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw erroDeConfiguracao(`${descricao} da Shopee ausente ou inválido.`);
  }
  return valor.trim();
}

function shopIdPositivo(valor, obrigatorio) {
  const vazio =
    valor === undefined ||
    valor === null ||
    valor === '' ||
    valor === 0 ||
    valor === '0';

  if (vazio) {
    if (obrigatorio) {
      throw erroDeConfiguracao('shop_id da Shopee ausente ou inválido.');
    }
    return 0;
  }

  if (typeof valor === 'number' && Number.isSafeInteger(valor) && valor > 0) {
    return valor;
  }
  if (typeof valor === 'string' && /^[1-9]\d*$/.test(valor)) {
    const numero = Number(valor);
    if (Number.isSafeInteger(numero)) {
      return numero;
    }
  }

  throw erroDeConfiguracao('shop_id da Shopee ausente ou inválido.');
}

function validarRedirect(valor) {
  let url;
  try {
    url = new URL(valor);
  } catch {
    throw erroDeConfiguracao('SHOPEE_REDIRECT_URI deve ser uma URL HTTPS válida.');
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname === '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw erroDeConfiguracao('SHOPEE_REDIRECT_URI deve ser uma URL HTTPS válida.');
  }

  // Devolvemos o texto configurado: o redirect deve ser exatamente o cadastrado.
  return valor;
}

function textoSeguro(valor) {
  if (typeof valor !== 'string') {
    return null;
  }
  const texto = valor.trim();
  return /^[A-Za-z0-9_.:-]{1,120}$/.test(texto) ? texto : null;
}

function extrairCodigoErro(corpo) {
  for (const chave of ['error', 'code']) {
    const codigo = textoSeguro(corpo?.[chave]);
    // `code: '0'` também é usado como sucesso por algumas respostas.
    if (codigo !== null && codigo !== '0') {
      return codigo;
    }
  }
  return null;
}

function extrairRequestId(corpo, headers) {
  const doCorpo = textoSeguro(corpo?.request_id ?? corpo?.requestId);
  if (doCorpo !== null) {
    return doCorpo;
  }

  if (!headers || typeof headers !== 'object') {
    return null;
  }
  for (const [chave, valor] of Object.entries(headers)) {
    if (chave.toLowerCase() !== 'x-request-id' && chave.toLowerCase() !== 'x-shopee-request-id') {
      continue;
    }
    const encontrado = textoSeguro(Array.isArray(valor) ? valor[0] : valor);
    if (encontrado !== null) {
      return encontrado;
    }
  }
  return null;
}

function corpoComoObjeto(corpo) {
  if (corpo && typeof corpo === 'object' && !Array.isArray(corpo)) {
    return corpo;
  }
  if (typeof corpo === 'string') {
    try {
      const parseado = JSON.parse(corpo);
      if (parseado && typeof parseado === 'object' && !Array.isArray(parseado)) {
        return parseado;
      }
    } catch {
      // Resposta não JSON é tratada como resposta sem corpo útil.
    }
  }
  return {};
}

function assinarRota(path) {
  const { partnerId, partnerKey } = credenciais();
  const timestamp = timestampAtual();
  // Rotas de autenticação usam assinatura pública: partner_id + path + timestamp.
  const assinatura = sign({ path, timestamp, partnerId, partnerKey });
  return { partnerId, timestamp, assinatura };
}

async function postToken(path, body, { retries = 2 } = {}) {
  const { partnerId, timestamp, assinatura } = assinarRota(path);
  const url = new URL(path, AMBIENTES[ambiente()].api);
  url.searchParams.set('partner_id', partnerId);
  url.searchParams.set('timestamp', String(timestamp));
  url.searchParams.set('sign', assinatura);

  let resposta;
  try {
    resposta = await requestJson({
      method: 'POST',
      url: url.toString(),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body,
      timeoutMs: 10000,
      retries
    });
  } catch (erro) {
    // Não propagamos a mensagem original: ela pode conter a URL assinada.
    throw new MarketplaceHttpError(`Falha de comunicação com a Shopee em ${path}.`, {
      marketplace: MARKETPLACE,
      status: Number.isInteger(erro?.status) ? erro.status : null,
      requestId: textoSeguro(erro?.requestId)
    });
  }

  const status = Number.isInteger(resposta?.status) ? resposta.status : null;
  const corpo = corpoComoObjeto(resposta?.body);
  const requestId = extrairRequestId(corpo, resposta?.headers);

  if (status !== null && (status < 200 || status >= 300)) {
    throw new MarketplaceHttpError(`Falha na Shopee ao chamar ${path}.`, {
      marketplace: MARKETPLACE,
      status,
      requestId
    });
  }

  const codigo = extrairCodigoErro(corpo);
  if (codigo !== null) {
    throw new MarketplaceHttpError(
      `A Shopee recusou a operação em ${path} (${codigo}).`,
      { marketplace: MARKETPLACE, status, requestId }
    );
  }

  return corpo;
}

function normalizarTokens(corpo, shopIdFallback) {
  const accessToken = textoObrigatorio(corpo.access_token, 'access_token');
  const refreshToken = textoObrigatorio(corpo.refresh_token, 'refresh_token');
  const expireIn = Number(corpo.expire_in);

  if (!Number.isFinite(expireIn) || expireIn <= 0) {
    throw new MarketplaceHttpError(
      'A Shopee não informou a validade do access_token.',
      { marketplace: MARKETPLACE }
    );
  }

  const segundos = Math.floor(expireIn);
  const shopId = shopIdPositivo(corpo.shop_id ?? shopIdFallback, true);

  return {
    accessToken,
    refreshToken,
    expiresIn: segundos,
    expiresAt: new Date(Date.now() + segundos * 1000).toISOString(),
    shopId,
    sellerId: String(shopId)
  };
}

/**
 * Monta a URL de autorização da Shopee BR.
 * `state` deve ser imprevisível, gravado no banco e de uso único (responsabilidade
 * da rota que inicia o OAuth).
 *
 * @param {string} state Estado anti-CSRF.
 * @returns {string} URL HTTPS para redirecionar o vendedor.
 */
export function getAuthorizationUrl(state) {
  const estado = textoObrigatorio(state, 'state');
  const { partnerId, redirectUri } = credenciais({ comRedirect: true });
  const redirect = validarRedirect(redirectUri);

  const url = new URL(AMBIENTES[ambiente()].autorizacao);
  url.searchParams.set('partner_id', partnerId);
  url.searchParams.set('auth_type', 'seller');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('state', estado);

  return url.toString();
}

/**
 * Troca o código de autorização por tokens.
 *
 * A API exige `shop_id: 1` nesta primeira chamada; o shop_id efetivo vem na
 * resposta. O argumento `shopId` nunca é enviado no corpo — serve apenas como
 * fallback caso a resposta não traga o identificador da loja.
 *
 * @param {string} code Código recebido no callback OAuth.
 * @param {number|string} [shopId] Identificador conhecido da loja (fallback).
 * @returns {Promise<object>} Tokens normalizados, shopId e validade calculada.
 */
export async function exchangeCode(code, shopId = undefined) {
  const codigo = textoObrigatorio(code, 'Código de autorização');
  const fallback = shopIdPositivo(shopId, false);

  const corpo = await postToken(CAMINHO_TOKEN, {
    code: codigo,
    partner_id: credenciais().partnerId,
    shop_id: 1
  });

  return normalizarTokens(corpo, fallback || undefined);
}

/**
 * Renova o access token da Shopee.
 *
 * O refresh token é de uso único (~30 dias), o access token dura cerca de 4h e
 * a autorização da loja expira em no máximo 365 dias. A camada de persistência
 * deve gravar a nova geração e marcar o refresh anterior como usado; nunca
 * reutilizar este retorno após uma segunda chamada.
 *
 * @param {object} opcoes
 * @param {number|string} opcoes.shopId Identificador da loja.
 * @param {string} opcoes.refreshToken Refresh token ainda não utilizado.
 * @returns {Promise<object>} Tokens normalizados, shopId e validade calculada.
 */
export async function refreshAccessToken({ shopId, refreshToken } = {}) {
  const idLoja = shopIdPositivo(shopId, true);
  const refresh = textoObrigatorio(refreshToken, 'refresh_token');

  // Um refresh já consumido não deve ser reenviado por retentativa automática.
  const corpo = await postToken(
    CAMINHO_REFRESH,
    {
      partner_id: credenciais().partnerId,
      shop_id: idLoja,
      refresh_token: refresh
    },
    { retries: 1 }
  );

  return normalizarTokens(corpo, idLoja);
}
