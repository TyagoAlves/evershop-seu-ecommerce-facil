/**
 * Consultas de apoio para ligar itens da outbox ao evento de webhook recebido.
 * Somente leitura: nenhuma função desta pasta altera estado.
 */

import { withConnection } from '../../lib/db.js';

function textoPreenchido(valor) {
  return typeof valor === 'string' && valor.trim() !== '';
}

function payloadComoObjeto(valor) {
  if (valor && typeof valor === 'object' && !Array.isArray(valor)) return valor;
  if (typeof valor !== 'string') return null;
  try {
    const analisado = JSON.parse(valor);
    return analisado && typeof analisado === 'object' && !Array.isArray(analisado) ? analisado : null;
  } catch {
    return null;
  }
}

function eventoDoPayload(payload) {
  const dados = payloadComoObjeto(payload);
  if (!dados) return null;

  const bruto = dados.eventId ?? dados.event_id ?? null;
  const numero = Number(bruto);
  const eventId = Number.isInteger(numero) && numero > 0 ? numero : null;
  const dedupeKey = dados.dedupeKey ?? dados.dedupe_key ?? null;

  return eventId || textoPreenchido(String(dedupeKey ?? '')) ? { eventId, dedupeKey } : null;
}

/** Localiza o evento já gravado pelo adaptador a partir da chave de dedupe. */
export async function buscarEventIdPorDedupe(marketplace, dedupeKey) {
  if (!textoPreenchido(marketplace) || !textoPreenchido(dedupeKey)) return null;

  return withConnection(async (client) => {
    const resultado = await client.query(
      `SELECT "marketplace_event_id" AS "eventId"
       FROM "marketplace_event"
       WHERE "marketplace" = $1::text AND "dedupe_key" = $2::text
       LIMIT 1`,
      [marketplace.trim().toLowerCase(), dedupeKey.trim()]
    );
    const linha = resultado.rows?.[0];
    const numero = Number(linha?.eventId);
    return Number.isInteger(numero) && numero > 0 ? numero : null;
  });
}

/**
 * Retrata os itens elegíveis da outbox antes de `processOutbox` reivindicá-los.
 * Devolve um Mapa por id, com o eventId/dedupeKey que as rotas anexaram.
 */
export async function listarEventosDaFila(marketplace, limite = 20) {
  if (!textoPreenchido(marketplace)) return new Map();

  const quantidade = Number.isInteger(limite) && limite > 0 ? Math.min(limite, 100) : 20;
  return withConnection(async (client) => {
    const resultado = await client.query(
      `SELECT "marketplace_outbox_id" AS "id", "payload" AS "payload"
       FROM "marketplace_outbox"
       WHERE "marketplace" = $1::text
         AND "next_attempt_at" <= CURRENT_TIMESTAMP
         AND (
           "status" = 'pending'
           OR (
             "status" = 'processing'
             AND "updated_at" < CURRENT_TIMESTAMP - INTERVAL '10 minutes'
           )
         )
       ORDER BY "created_at" ASC, "marketplace_outbox_id" ASC
       LIMIT $2::int`,
      [marketplace.trim().toLowerCase(), quantidade]
    );

    const mapa = new Map();
    for (const linha of resultado.rows ?? []) {
      const vinculo = eventoDoPayload(linha.payload);
      if (!vinculo) continue;
      mapa.set(String(linha.id), vinculo);
    }
    return mapa;
  });
}
