// Webhook do Mercado Livre (site MLB).
//
// Fluxo: verifyWebhook valida origem/segredo -> parseNotification produz um
// evento redigido e determinístico -> handleNotification grava o evento com
// dedupe (recordEvent) e responde 2xx rapidamente -> o processamento real é
// enfileirado na outbox e executado de forma assíncrona pelo worker.
//
// Nenhum segredo, assinatura, token, CPF/e-mail/telefone de comprador ou payload
// bruto é registrado em log ou persistido. Este módulo não cria pedido nem
// transação: apenas registra o recebimento e consulta a API quando acionado.

import { createHash } from 'node:crypto';

import { MarketplaceError, WebhookVerificationError } from '../../errors.js';
import { getSecret } from '../../secrets.js';
import { hmacSha256Hex, safeEqual } from '../../crypto.js';
import { recordEvent } from '../../events.js';
import { enqueue } from '../../outbox.js';
import { fetchRecentOrders, formatarDataISO } from './orders.js';

const MERCADOLIVRE = 'mercadolivre';
const SITE_ID_PADRAO = 'MLB';
const DIAS_MISSED_FEEDS = 2;
const TOLERANCIA_TIMESTAMP_MS = 5 * 60 * 1000;
const OPERACAO_NOTIFICACAO = 'processar_notificacao_mercadolivre';
const OPERACAO_MISSED_FEEDS = 'reprocessar_missed_feeds_mercadolivre';

function criarErro(mensagem, code) {
  return new MarketplaceError(mensagem, { code, marketplace: MERCADOLIVRE });
}

function falhaVerificacao(code) {
  // Mensagem genérica de propósito: nunca inclui segredo, assinatura nem corpo.
  return new WebhookVerificationError('Não foi possível validar o webhook do Mercado Livre.', {
    code,
    marketplace: MERCADOLIVRE
  });
}

function textoPreenchido(valor) {
  return typeof valor === 'string' && valor.trim() !== '';
}

function obterCabecalho(headers, nomes) {
  if (!headers || typeof headers !== 'object') return null;
  const chaves = typeof headers.keys === 'function' && typeof headers.get === 'function'
    ? Array.from(headers.keys())
    : Object.keys(headers);
  for (const nome of nomes) {
    const encontrada = chaves.find((chave) => String(chave).toLowerCase() === nome);
    if (encontrada === undefined) continue;
    const valor = typeof headers.get === 'function' ? headers.get(encontrada) : headers[encontrada];
    if (valor != null && valor !== '') return valor;
  }
  return null;
}

function obterConsulta(query, nomes) {
  if (!query || typeof query !== 'object') return null;
  for (const nome of nomes) {
    if (query[nome] != null && query[nome] !== '') return query[nome];
  }
  return null;
}

function normalizarRequisicao(entrada) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw falhaVerificacao('WEBHOOK_REQUISICAO_INVALIDA');
  }

  const temEnvelope =
    'headers' in entrada || 'query' in entrada || 'rawBody' in entrada || 'method' in entrada;
  return {
    method: entrada.method ?? null,
    headers: temEnvelope ? (entrada.headers ?? {}) : {},
    query: temEnvelope ? (entrada.query ?? {}) : {},
    rawBody: entrada.rawBody ?? entrada.raw_body ?? null,
    body: temEnvelope ? entrada.body : entrada
  };
}

function textoDoCorpo(requisicao) {
  const bruto = requisicao.rawBody;
  if (typeof bruto === 'string') return bruto;
  if (bruto && typeof bruto === 'object' && typeof bruto.toString === 'function' && ArrayBuffer.isView(bruto)) {
    return Buffer.from(bruto.buffer, bruto.byteOffset, bruto.byteLength).toString('utf8');
  }
  if (typeof requisicao.body === 'string') return requisicao.body;
  if (requisicao.body != null) return JSON.stringify(requisicao.body);
  return '';
}

/** Stringificação com chaves ordenadas, usada quando só há o corpo já parseado. */
function stringificarEstavel(valor, profundidade = 0) {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
  if (profundidade > 12) return 'null';
  if (Array.isArray(valor)) {
    return `[${valor.map((item) => stringificarEstavel(item, profundidade + 1)).join(',')}]`;
  }
  return `{${Object.keys(valor)
    .sort()
    .map((chave) => `${JSON.stringify(chave)}:${stringificarEstavel(valor[chave], profundidade + 1)}`)
    .join(',')}}`;
}

function validarTimestamp(valor) {
  const numero = Number(valor);
  const milissegundos = numero > 1e12 ? numero : numero * 1000;
  if (!Number.isFinite(milissegundos) || Math.abs(Date.now() - milissegundos) > TOLERANCIA_TIMESTAMP_MS) {
    throw falhaVerificacao('WEBHOOK_TIMESTAMP_INVALIDO');
  }
  return String(valor);
}

function assinaturaLimpa(valor) {
  return String(valor).trim().replace(/^sha256=/i, '').toLowerCase();
}

/**
 * Valida o webhook antes de qualquer persistência.
 *
 * Aceita dois caminhos de validação:
 * 1) HMAC-SHA256 (cabeçalho x-ml-signature/x-webhook-signature/x-signature,
 *    opcionalmente com x-ml-timestamp), calculado com ML_WEBHOOK_SECRET;
 * 2) segredo compartilhado enviado na URL cadastrada (?secret=...), comparado
 *    em tempo constante.
 *
 * @returns {{ valido: true, body: *, rawBody: string, headers: object, query: object }}
 * @throws {WebhookVerificationError} em qualquer falha (fail closed).
 */
export function verifyWebhook(entrada) {
  const requisicao = normalizarRequisicao(entrada);

  if (requisicao.method != null && String(requisicao.method).toUpperCase() !== 'POST') {
    throw falhaVerificacao('WEBHOOK_METODO_INVALIDO');
  }

  const segredo = getSecret('ML_WEBHOOK_SECRET');
  if (!textoPreenchido(segredo)) {
    throw falhaVerificacao('WEBHOOK_SEGREDO_AUSENTE');
  }

  const corpoTexto = textoDoCorpo(requisicao);
  const timestamp = obterCabecalho(requisicao.headers, [
    'x-ml-timestamp',
    'x-webhook-timestamp',
    'x-timestamp'
  ]);
  const timestampValidado = timestamp != null ? validarTimestamp(timestamp) : null;
  const assinatura = obterCabecalho(requisicao.headers, [
    'x-ml-signature',
    'x-webhook-signature',
    'x-signature',
    'x-hub-signature-256'
  ]);

  if (assinatura != null) {
    const candidatos = [corpoTexto];
    if (requisicao.body && typeof requisicao.body === 'object') {
      candidatos.push(stringificarEstavel(requisicao.body));
    }
    const recebida = assinaturaLimpa(assinatura);
    let valido = false;
    for (const candidato of candidatos) {
      const conteudo = timestampValidado ? `${timestampValidado}.${candidato}` : candidato;
      if (safeEqual(recebida, hmacSha256Hex(segredo, conteudo))) {
        valido = true;
        break;
      }
    }
    if (!valido) {
      throw falhaVerificacao('WEBHOOK_ASSINATURA_INVALIDA');
    }
  } else {
    const segredoRecebido = obterConsulta(requisicao.query, ['secret', 'segredo', 'token']);
    if (!textoPreenchido(segredoRecebido) || !safeEqual(String(segredoRecebido), segredo)) {
      throw falhaVerificacao('WEBHOOK_SEGREDO_INVALIDO');
    }
  }

  return {
    valido: true,
    body: requisicao.body,
    rawBody: corpoTexto,
    headers: requisicao.headers,
    query: requisicao.query
  };
}

function extrairCorpo(entrada) {
  if (!entrada || typeof entrada !== 'object') return entrada;
  if ('headers' in entrada || 'query' in entrada || 'rawBody' in entrada || 'method' in entrada) {
    return entrada.body;
  }
  return entrada;
}

function hashCurto(texto) {
  return createHash('sha256').update(String(texto), 'utf8').digest('hex').slice(0, 32);
}

function extrairIdRecurso(recurso) {
  const partes = String(recurso || '').split('/').filter(Boolean);
  if (partes.length === 0) return null;
  try {
    return decodeURIComponent(partes[partes.length - 1]).slice(0, 128) || null;
  } catch {
    return null;
  }
}

function inferirSite(identificador) {
  if (typeof identificador !== 'string') return null;
  const correspondencia = /^(ML[B-Z])/.exec(identificador.toUpperCase());
  return correspondencia ? correspondencia[1] : null;
}

/** Janela de recuperação de notificações perdidas (~2 dias, conforme a especificação). */
export function construirJanelaMissedFeeds(referencia = new Date(), dias = DIAS_MISSED_FEEDS) {
  const fim = referencia instanceof Date ? referencia : new Date(referencia);
  if (Number.isNaN(fim.getTime())) {
    throw criarErro('Referência de data inválida para a janela de missed_feeds.', 'JANELA_MISSED_FEEDS_INVALIDA');
  }
  const quantidadeDias = Number.isFinite(Number(dias)) && Number(dias) > 0 ? Number(dias) : DIAS_MISSED_FEEDS;
  const inicio = new Date(fim.getTime() - quantidadeDias * 24 * 60 * 60 * 1000);
  return {
    de: formatarDataISO(inicio),
    ate: formatarDataISO(fim),
    dias: quantidadeDias
  };
}

function montarDedupeKey({ topic, idExterno, recurso, action, janela }) {
  const base = [
    MERCADOLIVRE,
    topic,
    action ?? '',
    idExterno ?? hashCurto(recurso || topic),
    janela ? janela.de.slice(0, 10) : ''
  ].join(':');
  return `${MERCADOLIVRE}:${topic}:${hashCurto(base)}`;
}

/**
 * Converte a notificação (ou a requisição que a contém) em um evento seguro.
 * Topics aceitos: items, orders, claims etc. — qualquer tópico alfanumérico é
 * aceito, desde que não ambíguo; o processamento real consulta a API depois.
 */
export function parseNotification(entrada) {
  const corpo = extrairCorpo(entrada);
  let objeto;
  try {
    objeto = typeof corpo === 'string' ? JSON.parse(corpo) : corpo;
  } catch {
    throw criarErro('Notificação de webhook inválida: JSON não pôde ser lido.', 'NOTIFICACAO_JSON_INVALIDA');
  }
  if (!objeto || typeof objeto !== 'object' || Array.isArray(objeto)) {
    throw criarErro('Notificação de webhook inválida: corpo não é um objeto.', 'NOTIFICACAO_INVALIDA');
  }

  const topic = String(objeto.topic ?? objeto.topic_name ?? '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{1,64}$/.test(topic)) {
    throw criarErro('Notificação de webhook inválida: tópico ausente ou inválido.', 'TOPICO_INVALIDO');
  }

  const recursoBruto = typeof objeto.resource === 'string' ? objeto.resource : '';
  const recurso = recursoBruto.split('?')[0].replace(/\/+$/, '');
  if (recurso && !/^\/[A-Za-z0-9_./-]{1,200}$/.test(recurso)) {
    throw criarErro('Notificação de webhook inválida: recurso ausente ou inválido.', 'RECURSO_INVALIDO');
  }

  const resourceId = extrairIdRecurso(recurso);
  const idExterno = objeto.id != null && String(objeto.id) !== '' ? String(objeto.id) : resourceId;
  if (!textoPreenchido(idExterno) && topic !== 'missed_feeds') {
    throw criarErro('Notificação de webhook inválida: identificador ausente.', 'ID_NOTIFICACAO_AUSENTE');
  }

  const siteId = objeto.site_id != null && String(objeto.site_id) !== ''
    ? String(objeto.site_id)
    : inferirSite(resourceId);
  const missedFeed =
    topic === 'missed_feeds' ||
    recurso.includes('missed_feeds') ||
    Array.isArray(objeto.missed_feeds);
  const referencia = objeto.date_created ?? new Date();
  const janela = missedFeed ? construirJanelaMissedFeeds(referencia, DIAS_MISSED_FEEDS) : null;
  const action = objeto.action != null && String(objeto.action) !== ''
    ? String(objeto.action).slice(0, 100)
    : null;
  const dedupeKey = montarDedupeKey({ topic, idExterno, recurso, action, janela });

  // Lista de permitidos: nada do comprador entra no payload persistido.
  const payloadRedacted = {
    dedupeKey,
    topic,
    externalEventId: textoPreenchido(idExterno) ? idExterno : null,
    resource: recurso || null,
    resourceId,
    sellerId: objeto.seller_id != null ? String(objeto.seller_id).slice(0, 64) : null,
    siteId,
    action,
    attempt: objeto.attempt != null ? Number(objeto.attempt) || null : null,
    missedFeed,
    janela,
    receivedAt: new Date().toISOString()
  };

  return {
    topic,
    resource: recurso || null,
    resourceId,
    externalEventId: payloadRedacted.externalEventId,
    siteId,
    siteValido: siteId == null || siteId === SITE_ID_PADRAO,
    missedFeed,
    janela,
    dedupeKey,
    payloadRedacted
  };
}

function agendarProcessamento(tarefa) {
  const executar = () => {
    Promise.resolve()
      .then(tarefa)
      .catch(() => {
        // Sem payload, sem segredo e sem stack trace: apenas sinaliza a falha.
        console.error('[marketplace-bridge] Falha ao enfileirar processamento do webhook ML.');
      });
  };
  if (typeof setImmediate === 'function') {
    setImmediate(executar);
  } else {
    queueMicrotask(executar);
  }
}

function foiDuplicado(registro) {
  if (!registro || typeof registro !== 'object') return false;
  return registro.duplicate === true || registro.inserted === false || registro.duplicado === true;
}

/**
 * Ponto de entrada do callback HTTP.
 *
 * Uso previsto na rota pública: `await verifyWebhook(req); await handleNotification(req, { verificado: true })`
 * e responder 200. Se `verificado` não for true, a própria função valida antes
 * de gravar. O retorno já traz status 200 e o dedupeKey para observabilidade.
 */
export async function handleNotification(entrada, opcoes = {}) {
  const contexto = opcoes.verificado === true ? entrada : verifyWebhook(entrada);
  const notificacao = parseNotification(contexto?.body ?? contexto);

  // A gravação com dedupe acontece ANTES do ack: duplicatas não geram nova fila.
  const registro = await recordEvent({
    marketplace: MERCADOLIVRE,
    topic: notificacao.topic,
    externalEventId: notificacao.dedupeKey,
    payload: notificacao.payloadRedacted
  });

  const deveProcessar = notificacao.siteValido
    && foiDuplicado(registro) === false
    && opcoes.processar !== false;
  const dadosFila = {
    dedupeKey: notificacao.dedupeKey,
    topic: notificacao.topic,
    resource: notificacao.resource,
    resourceId: notificacao.resourceId,
    externalEventId: notificacao.externalEventId,
    siteId: notificacao.siteId,
    missedFeed: notificacao.missedFeed,
    janela: notificacao.janela
  };

  if (deveProcessar) {
    const operacao = notificacao.missedFeed ? OPERACAO_MISSED_FEEDS : OPERACAO_NOTIFICACAO;
    agendarProcessamento(() =>
      enqueue({
        marketplace: MERCADOLIVRE,
        operation: operacao,
        sku: null,
        externalId: notificacao.dedupeKey,
        payload: dadosFila
      })
    );
  }

  return {
    aceito: true,
    status: 200,
    dedupeKey: notificacao.dedupeKey,
    duplicado: foiDuplicado(registro),
    processamentoAgendado: deveProcessar,
    ...(!notificacao.siteValido ? { ignorado: 'site_id_fora_do_escopo' } : {})
  };
}

/**
 * Recupera perdas usando a janela de ~2 dias: varre GET /orders/search com
 * date_from/date_to e devolve as páginas para o serviço de pedidos tratar com
 * insertOrderIfAbsent (idempotência por marketplace + seller + external id).
 * Nenhuma escrita é feita aqui.
 */
export async function reprocessarMissedFeeds(accessToken, sellerId, janelaOuNotificacao, opcoes = {}) {
  const janela = janelaOuNotificacao?.janela ?? janelaOuNotificacao ?? construirJanelaMissedFeeds();
  if (!textoPreenchido(janela?.de) || !textoPreenchido(janela?.ate)) {
    throw criarErro('Janela de missed_feeds inválida para reprocessamento.', 'JANELA_INVALIDA');
  }

  let cursor = {
    offset: 0,
    limit: opcoes.limit ?? 50,
    dateFrom: janela.de,
    dateTo: janela.ate
  };
  const limitePaginas = Number.isInteger(opcoes.maxPaginas) && opcoes.maxPaginas > 0
    ? Math.min(opcoes.maxPaginas, 100)
    : 20;
  const paginas = [];

  for (let indice = 0; indice < limitePaginas; indice += 1) {
    const pagina = await fetchRecentOrders(accessToken, sellerId, cursor, opcoes);
    if (!Array.isArray(pagina.orders) || pagina.orders.length === 0) break;
    paginas.push(pagina);
    if (!pagina.nextCursor) break;
    cursor = {
      ...pagina.nextCursor,
      dateFrom: janela.de,
      dateTo: janela.ate
    };
  }

  const vistos = new Set();
  const orders = paginas
    .flatMap((pagina) => pagina.orders)
    .filter((pedido) => {
      if (!textoPreenchido(pedido?.id) || vistos.has(pedido.id)) return false;
      vistos.add(pedido.id);
      return true;
    });

  return { janela, paginas, orders, total: orders.length };
}
