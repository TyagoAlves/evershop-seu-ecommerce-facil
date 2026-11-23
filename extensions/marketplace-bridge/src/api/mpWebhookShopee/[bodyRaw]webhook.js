/**
 * Webhook público da Shopee BR: valida o push, registra o evento com dedupe,
 * devolve o ACK 200 e deixa a consulta do detalhe para o worker da outbox.
 */

import * as adaptador from '../../lib/adapters/shopee/webhook.js';
import { enqueue } from '../../lib/outbox.js';
import { responderErro, responderJson } from '../_shared/resposta.js';
import {
  caminhoWebhookConfigurado,
  criarEnvelopeWebhook,
  obterTokenShopeePorLoja
} from '../_shared/webhook.js';

// Caminho real em runtime no EverShop 2.4 (rotas de src/api recebem prefixo /api).
const CAMINHO_PADRAO = '/api/marketplaces/shopee/webhook';

export default async function (request, response, next) {
  try {
    const envelope = criarEnvelopeWebhook(request);
    const webhookPath = caminhoWebhookConfigurado('shopee', CAMINHO_PADRAO);

    const resultado = await adaptador.handleNotification(envelope, {
      webhookPath,
      deferRemoteRefresh: true,
      // Nunca exposta na URL: a credencial é resolvida somente no servidor.
      getAccessToken: async ({ shopId }) => obterTokenShopeePorLoja(shopId)
    });

    const followUp = resultado?.followUp;
    if (followUp?.operation && resultado.duplicate !== true && resultado.eventId) {
      await enqueue({
        marketplace: 'shopee',
        operation: followUp.operation,
        sku: null,
        externalId:
          resultado.dedupeKey ??
          resultado.notification?.ordersn ??
          `${followUp.shopId}:${followUp.ordersn}`,
        payload: {
          shopId: followUp.shopId,
          ordersn: followUp.ordersn,
          reason: followUp.reason,
          eventId: resultado.eventId,
          dedupeKey: resultado.dedupeKey ?? null
        }
      });
    }

    const ack = adaptador.webhookAck(resultado);
    responderJson(response, ack.status, ack.body);
  } catch (erro) {
    responderErro(response, erro, 'Não foi possível aceitar o push da Shopee.');
  }
}
