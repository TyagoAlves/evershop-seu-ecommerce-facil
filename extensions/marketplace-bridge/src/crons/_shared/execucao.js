/**
 * Ponto comum dos crons: todos entram em `run({ marketplace, limit })` e,
 * quando aplicável, drenam a outbox com manipuladores já registrados pelos
 * serviços. Nenhum segredo, payload bruto ou mensagem de API é registrado.
 */

import { isEnabled, readMarketplaceConfig } from '../../lib/config.js';
import { markEventAsProcessed } from '../../lib/events.js';
import { processOutbox } from '../../lib/outbox.js';
import * as reconcile from '../../services/reconcile.js';
import * as syncInventory from '../../services/sync-inventory.js';
import * as syncListings from '../../services/sync-listings.js';
import * as syncOrders from '../../services/sync-orders.js';
import {
  buscarEventIdPorDedupe,
  listarEventosDaFila
} from '../../api/_shared/eventos.js';

export const SERVICOS = Object.freeze({
  listings: syncListings,
  orders: syncOrders,
  inventory: syncInventory,
  reconcile
});

const MERCADOS = Object.freeze(['mercadolivre', 'shopee']);
const LIMITE_PADRAO = 20;
const LIMITE_MAXIMO = 100;

/** Expressão de configuração válida; qualquer valor suspeito usa o default. */
export function agendarCron(valor, padrao) {
  if (typeof valor !== 'string') return padrao;
  const expressao = valor.trim();
  return /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(expressao) ? expressao : padrao;
}

export function mercadosAtivos() {
  return MERCADOS.filter((marketplace) => isEnabled(marketplace));
}

export function limiteConfigurado() {
  const bruto = readMarketplaceConfig()?.sync?.batchSize;
  const numero = Number(bruto);
  return Number.isInteger(numero) && numero > 0
    ? Math.min(numero, LIMITE_MAXIMO)
    : LIMITE_PADRAO;
}

function resumoSeguro(valor) {
  if (!valor || typeof valor !== 'object') return null;
  return {
    situacao: typeof valor.situacao === 'string' ? valor.situacao : null,
    executado: typeof valor.executado === 'boolean' ? valor.executado : null,
    contas: Number.isFinite(valor.contas) ? valor.contas : null,
    processados: Number.isFinite(valor.processados) ? valor.processados : null,
    ignorados: Number.isFinite(valor.ignorados) ? valor.ignorados : null,
    erros: Number.isFinite(valor.erros) ? valor.erros : null,
    reivindicados: Number.isFinite(valor.claimed) ? valor.claimed : null,
    concluidos: Number.isFinite(valor.succeeded) ? valor.succeeded : null,
    falhas: Number.isFinite(valor.failed) ? valor.failed : null
  };
}

async function fecharEventos({ marketplace, vinculos, fila }) {
  const resultados = Array.isArray(fila?.results) ? fila.results : [];
  for (const item of resultados) {
    const vinculo = vinculos.get(String(item.outboxId));
    if (!vinculo) continue;

    let eventId = vinculo.eventId;
    if (!eventId && vinculo.dedupeKey) {
      eventId = await buscarEventIdPorDedupe(marketplace, vinculo.dedupeKey);
    }
    if (!eventId) continue;

    const erro = item.status === 'failed' ? item.error ?? 'FALHA_NO_WORKER' : null;
    try {
      await markEventAsProcessed(eventId, erro);
    } catch {
      // Encerramento é auditoria: não desfaz o resultado da fila nem expõe detalhes.
    }
  }
}

async function drenarOutbox(marketplace, limite) {
  const vinculos = await listarEventosDaFila(marketplace, limite);
  const fila = await processOutbox({ marketplace, limit: limite });
  await fecharEventos({ marketplace, vinculos, fila });
  return fila;
}

/** Executa um serviço por marketplace ativo, sem expor detalhes de erro. */
export async function executarCron({ nome, servico, incluirFila = true } = {}) {
  const resultado = {
    cron: typeof nome === 'string' ? nome : 'marketplace',
    executado: false,
    mercadoCount: 0,
    mercados: []
  };

  const ativos = mercadosAtivos();
  if (ativos.length === 0 || typeof servico?.run !== 'function') {
    resultado.motivo = 'Nenhum marketplace ativo ou serviço indisponível; nenhuma ação executada.';
    return resultado;
  }

  const limite = limiteConfigurado();
  resultado.executado = true;
  resultado.mercadoCount = ativos.length;

  for (const marketplace of ativos) {
    const item = { marketplace, servico: null, fila: null };
    try {
      item.servico = resumoSeguro(await servico.run({ marketplace, limit: limite }));
      if (incluirFila) {
        item.fila = resumoSeguro(await drenarOutbox(marketplace, limite));
      }
    } catch {
      item.erro = 'Falha interna; detalhes não registrados.';
    }
    resultado.mercados.push(item);
  }

  return resultado;
}
