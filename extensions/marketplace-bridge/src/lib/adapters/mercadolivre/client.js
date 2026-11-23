// Cliente HTTP da API do Mercado Livre (site MLB, moeda BRL).
//
// O token de acesso viaja SOMENTE no cabeçalho Authorization; nunca entra em
// URL, query string, mensagem de erro ou log. `requestJson` já faz timeout,
// backoff em 429/5xx e devolve `{ status, body, headers }`, com `headers` sendo
// o objeto `Headers` nativo (use `headers.get('x-request-id')`).
//
// Atenção (aviso do agente 7): `requestJson` também retenta POST/PUT. Por isso
// este módulo aceita `idempotencyKey` (reaproveitada do outbox) e as funções de
// escrita em `listings.js` fazem consulta prévia antes de criar e leem o item
// completo antes de atualizar. Nenhuma chamada de escrita acontece aqui.

import { MarketplaceError } from '../../errors.js';
import { requestJson } from '../../http.js';

const MERCADOLIVRE = 'mercadolivre';

/** Base oficial da API; o site (MLB) é definido pela conta autorizada. */
export const ML_API_BASE = 'https://api.mercadolibre.com';

function erroLocal(mensagem, code) {
  return new MarketplaceError(mensagem, { marketplace: MERCADOLIVRE, code });
}

/** Garante que a rota comece com "/" sem alterar o restante do caminho. */
function caminhoAbsoluto(caminho) {
  if (typeof caminho !== 'string' || caminho.trim() === '') {
    throw erroLocal(
      'Caminho da API do Mercado Livre não informado.',
      'ML_CAMINHO_AUSENTE'
    );
  }
  const texto = caminho.trim();
  return texto.startsWith('/') ? texto : `/${texto}`;
}

/** Serializa a query sem incluir nulos, vazios nem segredos. */
function queryParaString(query) {
  if (query === undefined || query === null) {
    return '';
  }

  const parametros = new URLSearchParams();
  const entradas =
    query instanceof URLSearchParams ? query.entries() : Object.entries(query);

  for (const [chave, valorBruto] of entradas) {
    if (valorBruto === undefined || valorBruto === null) {
      continue;
    }

    let valor;
    if (Array.isArray(valorBruto)) {
      valor = valorBruto
        .filter((item) => item !== undefined && item !== null && item !== '')
        .map(String)
        .join(',');
    } else if (typeof valorBruto === 'object') {
      valor = JSON.stringify(valorBruto);
    } else {
      valor = String(valorBruto);
    }

    if (valor === '') {
      continue;
    }
    parametros.append(String(chave), valor);
  }

  const texto = parametros.toString();
  return texto === '' ? '' : `?${texto}`;
}

/** Valida e codifica identificadores usados no caminho da API. */
function idNoCaminho(valor) {
  const texto =
    typeof valor === 'string' || typeof valor === 'number' ? String(valor).trim() : '';
  if (texto === '') {
    throw erroLocal(
      'Identificador necessário não informado para o Mercado Livre.',
      'ML_ID_AUSENTE'
    );
  }
  return encodeURIComponent(texto);
}

/**
 * Executa uma chamada na API do Mercado Livre.
 *
 * @param {string} accessToken token vigente da conta (não é registrado)
 * @param {object} opcoes
 * @param {string} [opcoes.method='GET'] método HTTP
 * @param {string} opcoes.path rota iniciada por "/" (ex.: "/items")
 * @param {object|URLSearchParams} [opcoes.query] parâmetros de consulta
 * @param {*} [opcoes.body] corpo JSON enviado quando informado
 * @param {object} [opcoes.headers] cabeçalhos extras (não podem sobrescrever o token)
 * @param {string} [opcoes.idempotencyKey] chave determinística do outbox
 * @returns {Promise<{status: number, body: *, headers: Headers}>}
 */
export async function request(
  accessToken,
  { method = 'GET', path, query, body, headers, idempotencyKey } = {}
) {
  if (typeof accessToken !== 'string' || accessToken.trim() === '') {
    throw erroLocal(
      'Token de acesso do Mercado Livre indisponível.',
      'ML_TOKEN_AUSENTE'
    );
  }

  const url = new URL(`${caminhoAbsoluto(path)}${queryParaString(query)}`, ML_API_BASE);
  const cabecalhos = new Headers(headers ?? undefined);
  cabecalhos.set('Authorization', `Bearer ${accessToken.trim()}`);
  cabecalhos.set('Accept', 'application/json');

  // A API pode ignorar este cabeçalho, mas a chave determinística permanece no
  // outbox e é reutilizada em todas as tentativas da mesma operação.
  if (typeof idempotencyKey === 'string' && idempotencyKey.trim() !== '') {
    cabecalhos.set('X-Idempotency-Key', idempotencyKey.trim());
  }

  return requestJson({ method, url: url.toString(), headers: cabecalhos, body });
}

/** Leitura de um anúncio completo (necessária antes de qualquer PUT em /items). */
export async function getItem(accessToken, itemId) {
  return request(accessToken, {
    method: 'GET',
    path: `/items/${idNoCaminho(itemId)}`
  });
}

/**
 * Multiget oficial: GET /items/bulk?ids=...
 *
 * Consulta documentada em 23/11/2026: o formato antigo `/items?ids=` foi
 * descontinuado em 25/10/2026 e não deve ser usado.
 */
export async function getItemsBulk(accessToken, ids) {
  const lista = (Array.isArray(ids) ? ids : [ids])
    .map((id) =>
      typeof id === 'string' || typeof id === 'number' ? String(id).trim() : ''
    )
    .filter(Boolean);

  // Sem identificadores não há chamada de rede nem escrita.
  if (lista.length === 0) {
    return { status: 200, body: [], headers: new Headers() };
  }

  return request(accessToken, {
    method: 'GET',
    path: '/items/bulk',
    query: { ids: lista.join(',') }
  });
}

/** Busca de anúncios por SKU do vendedor (usada na checagem prévia). */
export async function searchItemsBySku(accessToken, sellerId, sku) {
  const vendedor = idNoCaminho(sellerId);
  if (typeof sku !== 'string' || sku.trim() === '') {
    throw erroLocal(
      'SKU necessário para buscar anúncios no Mercado Livre.',
      'ML_SKU_AUSENTE'
    );
  }

  return request(accessToken, {
    method: 'GET',
    path: `/users/${vendedor}/items/search`,
    query: { sku: sku.trim() }
  });
}
