/** Inicia o OAuth do Mercado Livre (somente administradores autenticados). */

import * as oauth from '../../lib/adapters/mercadolivre/oauth.js';
import { iniciarAutorizacao } from '../_shared/oauth.js';
import { responderErro, responderJson } from '../_shared/resposta.js';

export default async function (request, response, next) {
  try {
    const url = await iniciarAutorizacao({
      marketplace: 'mercadolivre',
      request,
      adapter: oauth
    });
    response.setHeader('Cache-Control', 'no-store');
    response.redirect(302, url);
  } catch (erro) {
    responderErro(
      response,
      erro,
      'Não foi possível iniciar a autorização com o Mercado Livre.'
    );
  }
}
