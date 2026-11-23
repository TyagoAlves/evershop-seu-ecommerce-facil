/** Callback público da Shopee BR: consome o state e grava tokens cifrados. */

import * as oauth from '../../lib/adapters/shopee/oauth.js';
import { MarketplaceError } from '../../lib/errors.js';
import {
  salvarContaConectada,
  textoDaQuery,
  validarCallback
} from '../_shared/oauth.js';
import { responderErro, responderJson } from '../_shared/resposta.js';

export default async function (request, response, next) {
  try {
    const { code } = await validarCallback({
      marketplace: 'shopee',
      request
    });
    const shopId = textoDaQuery(request?.query?.shop_id, 32);
    if (!shopId || !/^\d+$/.test(shopId)) {
      throw new MarketplaceError('Identificador da loja Shopee ausente ou inválido.', {
        code: 'SHOPEE_SHOP_ID_INVALIDO',
        marketplace: 'shopee'
      });
    }

    const tokens = await oauth.exchangeCode(code, shopId);
    const conta = await salvarContaConectada({
      marketplace: 'shopee',
      sellerId: tokens.sellerId,
      shopId: tokens.shopId,
      siteId: null,
      tokens
    });

    responderJson(response, 200, {
      ok: true,
      marketplace: 'shopee',
      shopId: conta.shopId,
      proximo: 'Consulte o status em /admin/marketplaces/status.'
    });
  } catch (erro) {
    responderErro(
      response,
      erro,
      'Não foi possível concluir a autorização com a Shopee.'
    );
  }
}
