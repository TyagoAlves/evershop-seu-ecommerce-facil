import { insertEventIfAbsent, markEventProcessed as dbMarkEventProcessed } from './db.js';
import { IdempotencyConflictError, MarketplaceError } from './errors.js';
import { isUniqueViolation, normalizeKeyPart, stableHash } from './idempotency.js';

const VERSAO_DEDUPE = 'evento-marketplace-v1';
const VALOR_REDIGIDO = '[REDACTED]';
const LIMITE_PROFUNDIDADE = 12;
const LIMITE_ITENS = 200;

function erroDeValidacao(mensagem, marketplace) {
  return new MarketplaceError(mensagem, {
    code: 'VALIDACAO_EVENTO',
    ...(typeof marketplace === 'string' && marketplace.trim()
      ? { marketplace: marketplace.trim().toLowerCase() }
      : {})
  });
}

function textoPreenchido(valor) {
  return typeof valor === 'string' && valor.trim().length > 0;
}

function primeiroCampo(objeto, nomes) {
  if (!objeto || typeof objeto !== 'object') return undefined;
  for (const nome of nomes) {
    const valor = objeto[nome];
    if (valor !== undefined && valor !== null) return valor;
  }
  return undefined;
}

/** Normaliza chaves camelCase e com acentos antes de comparar com a lista de sensíveis. */
function chaveSegura(chave) {
  return String(chave)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
}

const CHAVE_SENSIVEL =
  /(^|_)(cpf|cnpj|e?mail|phone|telefone|celular|mobile|nome|name|buyer|comprador|customer|cliente|recipient|destinatario|endereco|address|token|secret|password|senha|authorization|signature|sign)(_|$)/;

function ehChaveSensivel(chave) {
  return CHAVE_SENSIVEL.test(chaveSegura(chave));
}

/** Remove CPF, e-mail, telefone e credenciais que apareçam dentro de um texto. */
function redigirTexto(texto) {
  return String(texto)
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, VALOR_REDIGIDO)
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, VALOR_REDIGIDO)
    .replace(/(?:\+55[\s.\-]*)?(?:\(\d{2}\)|\d{2})[\s.\-]+\d{4,5}[\s.\-]+\d{4}\b/g, VALOR_REDIGIDO)
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, VALOR_REDIGIDO);
}

/**
 * Redação recursiva aplicada ANTES de qualquer persistência de payload.
 * Nomes, CPF, e-mails e telefones de compradores nunca chegam ao banco.
 */
export function redactPayload(valor, profundidade = 0, vistos = new WeakSet()) {
  if (valor == null) return valor;
  if (profundidade >= LIMITE_PROFUNDIDADE) return '[PROFUNDIDADE_EXCEDIDA]';
  if (typeof valor === 'string') {
    const textoRedigido = redigirTexto(valor);
    const inicio = valor.trimStart()[0];
    if (inicio === '{' || inicio === '[') {
      try {
        // Alguns webhooks enviam JSON serializado dentro de um campo de texto.
        return JSON.stringify(redactPayload(JSON.parse(valor), profundidade + 1, vistos));
      } catch {
        // Texto que não é JSON continua apenas com a redação por padrão.
      }
    }
    return textoRedigido;
  }
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
  if (typeof valor === 'bigint') return valor.toString();
  if (typeof valor === 'function' || typeof valor === 'symbol') return VALOR_REDIGIDO;
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor.toISOString();
  }
  if (valor instanceof ArrayBuffer || ArrayBuffer.isView(valor)) return VALOR_REDIGIDO;
  if (vistos.has(valor)) return '[REFERENCIA_CICLICA]';

  vistos.add(valor);
  try {
    if (Array.isArray(valor)) {
      return valor
        .slice(0, LIMITE_ITENS)
        .map((item) => redactPayload(item, profundidade + 1, vistos));
    }

    const resultado = {};
    let contador = 0;
    for (const chave of Object.keys(valor)) {
      if (contador >= LIMITE_ITENS) {
        resultado.__omitido = 'LIMITE_DE_CAMPOS';
        break;
      }
      contador += 1;
      const chaveRedigida = redigirTexto(chave);
      resultado[chaveRedigida] = ehChaveSensivel(chave)
        ? VALOR_REDIGIDO
        : redactPayload(valor[chave], profundidade + 1, vistos);
    }
    return resultado;
  } finally {
    vistos.delete(valor);
  }
}

/**
 * Chave de dedupe por marketplace + dedupe_key. Quando o webhook não traz
 * externalEventId, usa o hash do payload já redigido como critério estável.
 */
export function makeEventDedupeKey({ marketplace, topic, externalEventId, payload } = {}) {
  if (!textoPreenchido(marketplace)) {
    throw erroDeValidacao('Marketplace é obrigatório para gerar a chave de dedupe.', marketplace);
  }
  if (!textoPreenchido(topic)) {
    throw erroDeValidacao('Tópico é obrigatório para gerar a chave de dedupe.', marketplace);
  }

  const externo = normalizeKeyPart(externalEventId);
  const base = externo || stableHash([redactPayload(payload ?? {})]);

  return stableHash([
    VERSAO_DEDUPE,
    normalizeKeyPart(marketplace),
    normalizeKeyPart(topic),
    base
  ]);
}

function normalizarResultadoInsercao(resultado, nomesLinha) {
  if (resultado === false || resultado == null) {
    return { linha: null, inserido: false };
  }
  if (resultado === true) return { linha: null, inserido: true };
  if (Array.isArray(resultado)) {
    return normalizarResultadoInsercao(resultado[0], nomesLinha);
  }
  if (typeof resultado !== 'object') return { linha: null, inserido: false };

  const duplicado =
    resultado.duplicate === true ||
    resultado.duplicated === true ||
    resultado.existed === true ||
    resultado.exists === true;
  const inserido =
    resultado.inserted === true || resultado.created === true || resultado.isNew === true
      ? true
      : duplicado
        ? false
        : undefined;

  let linha = null;
  for (const nome of nomesLinha) {
    if (resultado[nome] && typeof resultado[nome] === 'object') {
      linha = resultado[nome];
      break;
    }
  }
  if (!linha && 'dedupe_key' in resultado) linha = resultado;
  if (!linha && 'event_id' in resultado) linha = resultado;

  return {
    linha,
    inserido: inserido === undefined ? linha != null : inserido
  };
}

function conferirConflitoEvento(linha, { marketplace, topic, externalEventId, dedupeKey }) {
  const pares = [
    [primeiroCampo(linha, ['marketplace']), marketplace],
    [primeiroCampo(linha, ['topic']), topic],
    [primeiroCampo(linha, ['external_event_id', 'externalEventId']), externalEventId],
    [primeiroCampo(linha, ['dedupe_key', 'dedupeKey']), dedupeKey]
  ];

  for (const [existente, recebido] of pares) {
    if (existente == null || recebido == null) continue;
    if (normalizeKeyPart(existente) !== normalizeKeyPart(recebido)) {
      throw new IdempotencyConflictError(
        'Já existe evento com esta chave de dedupe, mas com identificador diferente.',
        {
          code: 'EVENTO_CONFLITANTE',
          marketplace: normalizeKeyPart(marketplace).toLowerCase()
        }
      );
    }
  }
}

function mensagemSegura(erro) {
  if (erro == null) return null;
  const texto = typeof erro === 'string' ? erro : erro.message || 'Erro desconhecido';
  return redigirTexto(String(texto)).slice(0, 500);
}

/**
 * Registra o evento recebido do webhook com dedupe e payload redigido.
 * Não marca como processado: quem consome o evento é o worker.
 * Retorno: { eventId, dedupeKey, topic, inserted, duplicate, event }.
 */
export async function recordEvent({ marketplace, topic, externalEventId, payload } = {}) {
  if (!textoPreenchido(marketplace)) {
    throw erroDeValidacao('Marketplace é obrigatório para registrar o evento.');
  }
  if (!textoPreenchido(topic)) {
    throw erroDeValidacao('Tópico é obrigatório para registrar o evento.', marketplace);
  }

  const payloadRedacted = redactPayload(payload ?? {});
  const dedupeKey = makeEventDedupeKey({ marketplace, topic, externalEventId, payload: payloadRedacted });
  const externoNormalizado = normalizeKeyPart(externalEventId) || null;

  let resultado;
  try {
    resultado = await insertEventIfAbsent({
      marketplace: normalizeKeyPart(marketplace).toLowerCase(),
      dedupeKey,
      topic: topic.trim(),
      externalEventId: externoNormalizado,
      payloadRedacted
    });
  } catch (erro) {
    if (isUniqueViolation(erro)) {
      return {
        eventId: null,
        dedupeKey,
        topic: topic.trim(),
        inserted: false,
        duplicate: true,
        event: null
      };
    }
    throw new MarketplaceError('Falha ao registrar evento de marketplace.');
  }

  const { linha, inserido } = normalizarResultadoInsercao(resultado, ['event', 'row', 'record']);
  if (!inserido && linha) {
    conferirConflitoEvento(linha, {
      marketplace,
      topic,
      externalEventId: externoNormalizado,
      dedupeKey
    });
  }

  return {
    eventId: primeiroCampo(linha, ['event_id', 'id', 'eventId']) ?? null,
    dedupeKey,
    topic: topic.trim(),
    inserted: inserido,
    duplicate: !inserido,
    event: linha
  };
}

/**
 * Encerramento do processamento pelo worker. O erro, quando houver, é
 * redigido antes de ir para o banco (nunca contém payload bruto ou segredos).
 */
export async function markEventAsProcessed(eventId, error = null) {
  if (eventId == null || eventId === '') {
    throw erroDeValidacao('Identificador do evento é obrigatório.');
  }

  try {
    return await dbMarkEventProcessed(eventId, mensagemSegura(error));
  } catch (erro) {
    throw new MarketplaceError('Falha ao marcar evento como processado.');
  }
}
