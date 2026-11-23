import {
  claimNextOutbox,
  insertOutboxIfAbsent,
  markOutboxDone,
  markOutboxFailed
} from './db.js';
import { IdempotencyConflictError, MarketplaceError } from './errors.js';
import { isUniqueViolation, makeIdempotencyKey, normalizeKeyPart } from './idempotency.js';
import { redactPayload } from './events.js';

const manipuladores = new Map();
const LIMITE_PADRAO = 20;
const LIMITE_MAXIMO = 100;

function erroDeValidacao(mensagem, marketplace) {
  return new MarketplaceError(mensagem, {
    code: 'VALIDACAO_OUTBOX',
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

/**
 * Registra o manipulador de uma operação da outbox. Nenhum manipulador é
 * registrado por padrão: a fila nunca chama API de marketplace sem código
 * explícito de um adaptador/serviço.
 * Retorna uma função para remover o registro.
 */
export function registerOutboxHandler(operation, handler) {
  if (!textoPreenchido(operation)) {
    throw erroDeValidacao('Operação é obrigatória para registrar o manipulador.');
  }
  if (typeof handler !== 'function') {
    throw erroDeValidacao('Manipulador da outbox deve ser uma função.', operation);
  }

  const chave = normalizeKeyPart(operation);
  manipuladores.set(chave, handler);
  return () => {
    if (manipuladores.get(chave) === handler) manipuladores.delete(chave);
  };
}

export function unregisterOutboxHandler(operation) {
  return manipuladores.delete(normalizeKeyPart(operation));
}

function normalizarResultadoInsercao(resultado) {
  if (resultado === false || resultado == null) {
    return { linha: null, inserido: false };
  }
  if (resultado === true) return { linha: null, inserido: true };
  if (Array.isArray(resultado)) return normalizarResultadoInsercao(resultado[0]);
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
  for (const nome of ['outbox', 'row', 'record']) {
    if (resultado[nome] && typeof resultado[nome] === 'object') {
      linha = resultado[nome];
      break;
    }
  }
  if (!linha && 'idempotency_key' in resultado) linha = resultado;
  if (!linha && 'outbox_id' in resultado) linha = resultado;

  return {
    linha,
    inserido: inserido === undefined ? linha != null : inserido
  };
}

function conferirConflitoOutbox(linha, { marketplace, operation, idempotencyKey }) {
  const pares = [
    [primeiroCampo(linha, ['marketplace']), marketplace],
    [primeiroCampo(linha, ['operation']), operation],
    [primeiroCampo(linha, ['idempotency_key', 'idempotencyKey']), idempotencyKey]
  ];

  for (const [existente, recebido] of pares) {
    if (existente == null || recebido == null) continue;
    if (normalizeKeyPart(existente) !== normalizeKeyPart(recebido)) {
      throw new IdempotencyConflictError(
        'Já existe item na outbox com esta chave de idempotência, mas com operação diferente.',
        {
          code: 'OUTBOX_CONFLITANTE',
          marketplace: normalizeKeyPart(marketplace).toLowerCase()
        }
      );
    }
  }
}

/**
 * Enfileira uma operação com chave de idempotência determinística e payload
 * redigido. Nenhuma chamada de API acontece aqui.
 * Retorno: { outboxId, idempotencyKey, operation, inserted, duplicate, outbox }.
 */
export async function enqueue({ marketplace, operation, sku, externalId, payload } = {}) {
  if (!textoPreenchido(marketplace)) {
    throw erroDeValidacao('Marketplace é obrigatório para enfileirar a operação.');
  }
  if (!textoPreenchido(operation)) {
    throw erroDeValidacao('Operação é obrigatória para enfileirar a operação.', marketplace);
  }

  const idempotencyKey = makeIdempotencyKey({ marketplace, operation, sku, externalId });
  const payloadRedacted = redactPayload(payload ?? {});

  let resultado;
  try {
    resultado = await insertOutboxIfAbsent({
      marketplace: normalizeKeyPart(marketplace).toLowerCase(),
      operation: operation.trim(),
      idempotencyKey,
      payload: payloadRedacted
    });
  } catch (erro) {
    if (isUniqueViolation(erro)) {
      return {
        outboxId: null,
        idempotencyKey,
        operation: operation.trim(),
        inserted: false,
        duplicate: true,
        outbox: null
      };
    }
    throw new MarketplaceError('Falha ao enfileirar operação de marketplace.');
  }

  const { linha, inserido } = normalizarResultadoInsercao(resultado);
  if (!inserido && linha) {
    conferirConflitoOutbox(linha, { marketplace, operation, idempotencyKey });
  }

  return {
    outboxId: primoCampoSeguro(linha) ?? null,
    idempotencyKey,
    operation: operation.trim(),
    inserted: inserido,
    duplicate: !inserido,
    outbox: linha
  };
}

function primoCampoSeguro(linha) {
  return primeiroCampo(linha, ['outbox_id', 'id', 'outboxId']);
}

function itensReivindicados(resultado) {
  if (Array.isArray(resultado)) return resultado;
  if (!resultado || typeof resultado !== 'object') return [];
  for (const chave of ['items', 'rows', 'outbox', 'records']) {
    if (Array.isArray(resultado[chave])) return resultado[chave];
  }
  return [resultado];
}

function payloadArmazenado(valor) {
  if (valor == null) return {};
  if (typeof valor === 'object') return valor;
  if (typeof valor === 'string') {
    try {
      const analisado = JSON.parse(valor);
      return analisado && typeof analisado === 'object' ? analisado : {};
    } catch {
      // Conteúdo inválido não é repassado ao manipulador nem registrado em log.
      return {};
    }
  }
  return {};
}

function mensagemSegura(erro) {
  if (erro == null) return null;
  const texto = typeof erro === 'string' ? erro : erro.message || 'Erro desconhecido';
  return redactPayload(String(texto)).slice(0, 500);
}

function limiteValido(limit) {
  const numero = Number(limit ?? LIMITE_PADRAO);
  if (!Number.isFinite(numero)) {
    throw erroDeValidacao('Limite da outbox deve ser um número.');
  }
  return Math.min(LIMITE_MAXIMO, Math.max(1, Math.trunc(numero)));
}

function resolverManipulador(operation, externos) {
  const chave = normalizeKeyPart(operation);
  if (manipuladores.has(chave)) return manipuladores.get(chave);
  if (!externos || typeof externos !== 'object') return null;

  for (const [nome, handler] of Object.entries(externos)) {
    if (normalizeKeyPart(nome) === chave && typeof handler === 'function') return handler;
  }
  return null;
}

/**
 * Reivindica itens da outbox e executa o manipulador registrado para cada
 * operação. Itens sem manipulador falham fechado (sem chamada de API).
 * Retorno: { claimed, processed, succeeded, failed, results }.
 * `handlers` é um mapa opcional por chamada, útil para testes e injeção.
 */
export async function processOutbox({ marketplace, limit, handlers } = {}) {
  if (!textoPreenchido(marketplace)) {
    throw erroDeValidacao('Marketplace é obrigatório para processar a outbox.');
  }
  const quantidade = limiteValido(limit);

  let reivindicados;
  try {
    reivindicados = await claimNextOutbox({
      marketplace: normalizeKeyPart(marketplace).toLowerCase(),
      limit: quantidade
    });
  } catch (erro) {
    throw new MarketplaceError('Falha ao reivindicar itens da outbox.');
  }

  const itens = itensReivindicados(reivindicados);
  const resultados = [];
  let sucessos = 0;
  let falhas = 0;

  for (const item of itens) {
    const outboxId = primeiroCampo(item, ['outbox_id', 'id', 'outboxId']);
    const operation = primeiroCampo(item, ['operation']);
    const idempotencyKey = primeiroCampo(item, ['idempotency_key', 'idempotencyKey']);

    if (outboxId == null) {
      falhas += 1;
      resultados.push({
        outboxId: null,
        operation: operation ?? null,
        status: 'failed',
        error: 'ITEM_SEM_IDENTIFICADOR'
      });
      continue;
    }

    const manipulador = resolverManipulador(operation, handlers);
    if (!manipulador) {
      falhas += 1;
      try {
        await markOutboxFailed(outboxId, 'SEM_MANIPULADOR_REGISTRADO');
      } catch {
        // A falha de persistência é refletida no status abaixo, sem expor detalhes.
      }
      resultados.push({
        outboxId,
        operation: operation ?? null,
        status: 'failed',
        error: 'SEM_MANIPULADOR_REGISTRADO'
      });
      continue;
    }

    const payload = payloadArmazenado(primeiroCampo(item, ['payload']));
    try {
      await manipulador({
        marketplace: primeiroCampo(item, ['marketplace']) ?? marketplace,
        operation,
        payload,
        idempotencyKey: idempotencyKey ?? null,
        outboxId,
        attempts: Number(primeiroCampo(item, ['attempts']) ?? 0),
        sku: payload.sku ?? null,
        externalId: payload.externalId ?? payload.external_id ?? null
      });
    } catch (erro) {
      const mensagem = mensagemSegura(erro);
      falhas += 1;
      try {
        await markOutboxFailed(outboxId, mensagem);
      } catch {
        // Não interrompe os demais itens da disputa atual.
      }
      resultados.push({ outboxId, operation, status: 'failed', error: mensagem });
      continue;
    }

    // O manipulador já terminou: nunca marcar como falha se a confirmação
    // no banco falhar, para não provocar reprocessamento indevido.
    let status = 'done';
    try {
      await markOutboxDone(outboxId);
    } catch {
      status = 'done_pending_confirmation';
    }
    sucessos += 1;
    resultados.push({ outboxId, operation, status, error: null });
  }

  return {
    claimed: itens.length,
    processed: sucessos + falhas,
    succeeded: sucessos,
    failed: falhas,
    results: resultados
  };
}
