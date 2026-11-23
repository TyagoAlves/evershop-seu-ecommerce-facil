/**
 * Webhook público do Mercado Livre: valida, grava o evento com dedupe, devolve
 * 200 rapidamente e deixa a consulta à API para o worker da outbox.
 */

import * as adaptador from '../../lib/adapters/mercadolivre/webhook.js';
import { enqueue } from '../../lib/outbox.js';
import { buscarEventIdPorDedupe } from '../_shared/eventos.js';
import { responderErro, responderJson } from '../_shared/resposta.js';
import { criarEnvelopeWebhook } from '../_shared/webhook.js';

const OPERACAO_NOTIFICACAO = 'processar_notificacao_mercadolivre';
const OPERACAO_MISSED_FEEDS = 'reprocessar_missed_feeds_mercadolivre';

export default async function (request, response, next) {
  try {
    const envelope = criarEnvelopeWebhook(request);
    const verificado = adaptador.verifyWebhook(envelope);
    const notificacao = adaptador.parseNotification(verificado?.body ?? verificado);

    // `processar: false` evita que o adaptador enfileire por conta própria:
    // esta rota anexa o eventId ao payload para o worker encerrar o evento.
    const resultado = await adaptador.handleNotification(envelope, {
      verificado: true,
      processar: false
    });

    if (
      resultado?.aceito === true &&
      resultado.duplicado !== true &&
      !resultado.ignorado &&
      resultado.dedupeKey &&
      notificacao.siteValido !== false
    ) {
      const eventId = await buscarEventIdPorDedupe('mercadolivre', resultado.dedupeKey);
      await enqueue({
        marketplace: 'mercadolivre',
        operation: notificacao.missedFeed ? OPERACAO_MISSED_FEEDS : OPERACAO_NOTIFICACAO,
        sku: null,
        externalId: resultado.dedupeKey,
        payload: {
          dedupeKey: resultado.dedupeKey,
          topic: notificacao.topic,
          resource: notificacao.resource,
          resourceId: notificacao.resourceId,
          externalEventId: notificacao.externalEventId,
          siteId: notificacao.siteId,
          missedFeed: notificacao.missedFeed,
          janela: notificacao.janela,
          eventId
        }
      });
    }

    responderJson(response, 200, {
      recebido: true,
      duplicado: Boolean(resultado?.duplicado)
    });
  } catch (erro) {
    responderErro(
      response,
      erro,
      'Não foi possível aceitar a notificação do Mercado Livre.'
    );
  }
}
