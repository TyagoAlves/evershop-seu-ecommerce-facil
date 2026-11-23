// Camada HTTP compartilhada pelos adaptadores de marketplace.
// Esta biblioteca NÃO registra logs: mensagens e erros nunca contêm URL,
// query string, tokens, segredos nem payload — apenas status HTTP, host e
// um request id higienizado quando o marketplace o fornece.

import { MarketplaceHttpError } from './errors.js';

// Backoff exponencial com jitter (300 ms, 600 ms, 1,2 s... limitado a 8 s).
const ATRASO_INICIAL_MS = 300;
const ATRASO_MAXIMO_MS = 8000;

// Teto para Retry-After: evita que um valor abusivo trave o worker por horas.
const TETO_RETRY_AFTER_MS = 120000;

const TEMPO_LIMITE_PADRAO_MS = 10000;
const TEMPO_LIMITE_MAXIMO_MS = 300000;
const MAXIMO_TENTATIVAS = 11; // 1 chamada + até 10 retentativas.
const TAMANHO_MAXIMO_REQUEST_ID = 200;

// Cabeçalhos usados por provedores para correlacionar uma requisição.
const CABECALHOS_REQUEST_ID = [
  'x-request-id',
  'x-correlation-id',
  'x-amzn-requestid',
  'x-api-request-id',
  'x-shopee-request-id'
];

/**
 * Pausa a execução por `ms` milissegundos. Valores inválidos viram zero.
 * Exportada para reuso pelos adaptadores e pelo limitador de taxa.
 */
export function sleep(ms) {
  const tempo = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
  return new Promise((resolve) => {
    setTimeout(resolve, tempo);
  });
}

/** Converte um valor numérico em inteiro dentro de limites seguros. */
function inteiroLimitado(valor, padrao, minimo, maximo) {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) {
    return padrao;
  }
  return Math.min(maximo, Math.max(minimo, Math.floor(valor)));
}

/**
 * Retorna somente o host da URL. Host não é segredo, mas caminho, parâmetros
 * de assinatura e tokens nunca entram em mensagens de erro.
 */
function hostSeguro(url) {
  try {
    return new URL(String(url)).host || 'host-desconhecido';
  } catch {
    return 'host-desconhecido';
  }
}

/** Aceita apenas identificadores curtos e simples, próprios para correlação. */
function higienizarRequestId(valor) {
  if (typeof valor !== 'string' && typeof valor !== 'number') {
    return null;
  }
  const texto = String(valor).trim();
  if (!texto || texto.length > TAMANHO_MAXIMO_REQUEST_ID) {
    return null;
  }
  return /^[A-Za-z0-9_.:-]+$/.test(texto) ? texto : null;
}

/** Busca o id de correlação primeiro nos cabeçalhos e depois no corpo JSON. */
function extrairRequestId(headers, corpo) {
  for (const nome of CABECALHOS_REQUEST_ID) {
    const valor = higienizarRequestId(headers?.get?.(nome));
    if (valor) {
      return valor;
    }
  }
  if (corpo && typeof corpo === 'object' && !Array.isArray(corpo)) {
    return higienizarRequestId(corpo.request_id ?? corpo.requestId);
  }
  return null;
}

/**
 * Converte Retry-After (segundos ou data HTTP) em milissegundos.
 * Valores inválidos viram zero e valores enormes são limitados ao teto.
 */
function parseRetryAfterMs(valor) {
  if (valor === undefined || valor === null) {
    return 0;
  }
  const texto = String(valor).trim();
  if (!texto) {
    return 0;
  }
  if (/^\d+(?:\.\d+)?$/.test(texto)) {
    const segundos = Number(texto);
    if (!Number.isFinite(segundos)) {
      return 0;
    }
    return Math.min(TETO_RETRY_AFTER_MS, Math.max(0, Math.round(segundos * 1000)));
  }
  const data = Date.parse(texto);
  if (Number.isNaN(data)) {
    return 0;
  }
  return Math.min(TETO_RETRY_AFTER_MS, Math.max(0, data - Date.now()));
}

/** Retenta apenas em 429 e 5xx; erros do chamador (4xx) falham na hora. */
function deveRetentar(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Backoff com jitter integral, respeitando no mínimo o Retry-After do servidor. */
function calcularEspera(tentativa, headers) {
  const exponencial = Math.min(
    ATRASO_MAXIMO_MS,
    ATRASO_INICIAL_MS * (2 ** tentativa)
  );
  const comJitter = Math.floor(Math.random() * (exponencial + 1));
  const determinado = parseRetryAfterMs(headers?.get?.('retry-after'));
  return Math.min(TETO_RETRY_AFTER_MS, Math.max(comJitter, determinado));
}

/**
 * AbortSignal.timeout é usado quando disponível; o fallback com AbortController
 * cobre runtimes antigos. `limpar()` sempre já o temporizador auxiliar.
 */
function criarControleTimeout(tempoLimiteMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(tempoLimiteMs), limpar() {} };
  }
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), tempoLimiteMs);
  return {
    signal: controlador.signal,
    limpar() {
      clearTimeout(temporizador);
    }
  };
}

/** Corpo de requisição em JSON ganha Content-Type quando não foi informado. */
function ehCorpoJson(body) {
  return (
    body !== null &&
    typeof body === 'object' &&
    !(body instanceof URLSearchParams) &&
    !(typeof Blob !== 'undefined' && body instanceof Blob) &&
    !ArrayBuffer.isView(body)
  );
}

function prepararCorpo(body, headers) {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (ehCorpoJson(body) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return ehCorpoJson(body) ? JSON.stringify(body) : body;
}

/** JSON quando possível; texto simples (ou null) quando a API não responde JSON. */
function interpretarCorpo(texto) {
  if (typeof texto !== 'string' || texto.length === 0) {
    return null;
  }
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

/**
 * Centraliza a criação do erro de domínio e garante as propriedades exigidas
 * pelo contrato (.status e .requestId) independentemente da assinatura usada
 * por errors.js. Nenhuma URL é anexada ao erro.
 */
function criarErroHttp(mensagem, { status, requestId }) {
  const erro = new MarketplaceHttpError(mensagem, status, { requestId });
  if (erro.status !== status) {
    erro.status = status;
  }
  if (erro.requestId !== requestId) {
    erro.requestId = requestId;
  }
  if (!erro.code) {
    erro.code = 'MARKETPLACE_HTTP_ERROR';
  }
  return erro;
}

/**
 * Executa uma chamada HTTP com timeout e retentativas.
 *
 * @param {object} opcoes
 * @param {string} opcoes.method Método HTTP (padrão GET quando ausente).
 * @param {string} opcoes.url URL completa; nunca aparece em mensagens de erro.
 * @param {object|Headers} [opcoes.headers] Cabeçalhos da requisição.
 * @param {*} [opcoes.body] Objeto/array vira JSON; string, Buffer e
 *   URLSearchParams são enviados como estão.
 * @param {number} [opcoes.timeoutMs=10000] Timeout por tentativa (1 ms a 5 min).
 * @param {number} [opcoes.retries=2] Retentativas além da primeira chamada.
 * @returns {Promise<{status: number, body: *, headers: Headers}>}
 * @throws {MarketplaceHttpError} Em 4xx/5xx finais, falha de rede ou timeout.
 *
 * Atenção: POST/PUT retentados podem ser repetidos se o servidor já tiver
 * processado a chamada. Os adaptadores devem usar chaves de idempotência ou
 * consultar o recurso antes de criar/anular anúncios e pedidos.
 */
export async function requestJson({
  method,
  url,
  headers,
  body,
  timeoutMs = TEMPO_LIMITE_PADRAO_MS,
  retries = 2
}) {
  const tempoLimite = inteiroLimitado(
    timeoutMs,
    TEMPO_LIMITE_PADRAO_MS,
    1,
    TEMPO_LIMITE_MAXIMO_MS
  );
  const tentativas = inteiroLimitado(retries, 2, 0, MAXIMO_TENTATIVAS - 1) + 1;
  const metodo = typeof method === 'string' && method.trim()
    ? method.trim().toUpperCase()
    : 'GET';
  const cabecalhos = new Headers(headers ?? undefined);
  const corpo = prepararCorpo(body, cabecalhos);
  const host = hostSeguro(url);
  let ultimoRequestId = null;

  for (let tentativa = 0; tentativa < tentativas; tentativa += 1) {
    const controle = criarControleTimeout(tempoLimite);
    let esperaMs = 0;
    let vaiRetentar = false;

    try {
      const resposta = await fetch(url, {
        method: metodo,
        headers: cabecalhos,
        body: corpo,
        signal: controle.signal
      });
      const texto = await resposta.text();
      const corpoResposta = interpretarCorpo(texto);
      const requestId = extrairRequestId(resposta.headers, corpoResposta);
      if (requestId) {
        ultimoRequestId = requestId;
      }

      if (resposta.ok) {
        return {
          status: resposta.status,
          body: corpoResposta,
          headers: resposta.headers
        };
      }

      if (deveRetentar(resposta.status) && tentativa + 1 < tentativas) {
        esperaMs = calcularEspera(tentativa, resposta.headers);
        vaiRetentar = true;
      } else {
        throw criarErroHttp(
          `Falha HTTP ${resposta.status} ao chamar a API (${host}).`,
          { status: resposta.status, requestId }
        );
      }
    } catch (erro) {
      // O erro de domínio já está pronto; não deve ser reprocessado.
      if (erro instanceof MarketplaceHttpError) {
        throw erro;
      }
      if (tentativa + 1 < tentativas) {
        esperaMs = calcularEspera(tentativa, null);
        vaiRetentar = true;
      } else {
        throw criarErroHttp(
          `Falha de rede ou timeout ao chamar a API (${host}).`,
          { status: 0, requestId: ultimoRequestId }
        );
      }
    } finally {
      controle.limpar();
    }

    if (vaiRetentar) {
      await sleep(esperaMs);
    }
  }

  // Linha de segurança: o laço sempre retorna ou lança em uma das tentativas.
  throw criarErroHttp(`Falha HTTP ao chamar a API (${host}).`, {
    status: 0,
    requestId: ultimoRequestId
  });
}
