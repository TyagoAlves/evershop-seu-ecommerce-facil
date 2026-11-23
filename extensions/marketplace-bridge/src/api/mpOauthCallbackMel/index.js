/** Callback público do Mercado Livre: consome o state e grava tokens cifrados. */

import * as oauth from '../../lib/adapters/mercadolivre/oauth.js';
import { MarketplaceError } from '../../lib/errors.js';
import { salvarContaConectada, validarCallback } from '../_shared/oauth.js';
import { responderErro, responderJson } from '../_shared/resposta.js';

export default async function (request, response, next) {
  try {
    const { code } = await validarCallback({
      marketplace: 'mercadolivre',
      request
    });

    const tokens = await oauth.exchangeCode(code);
    const identidade = await oauth.getSellerIdentity(tokens.accessToken);
    if (identidade?.siteId !== 'MLB') {
      throw new MarketplaceError('Conta do Mercado Livre fora do site MLB.', {
        code: 'ML_SITE_NOT_ALLOWED',
        marketplace: 'mercadolivre'
      });
    }

    const conta = await salvarContaConectada({
      marketplace: 'mercadolivre',
      sellerId: identidade.sellerId,
      siteId: identidade.siteId,
      tokens
    });

    responderJson(response, 200, {
      ok: true,
      marketplace: 'mercadolivre',
      sellerId: conta.sellerId,
      proximo: 'Consulte o status em /admin/marketplaces/status.'
    });
  } catch (erro) {
    responderErro(
      response,
      erro,
      'Não foi possível concluir a autorização com o Mercado Livre.'
    );
  }
}
