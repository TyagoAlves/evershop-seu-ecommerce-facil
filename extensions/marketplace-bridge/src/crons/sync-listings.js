/** Cron de anúncios: único ponto de entrada é `run({ marketplace, limit })`. */

import { executarCron, SERVICOS } from './_shared/execucao.js';

export default async function () {
  return executarCron({ nome: 'sincronizacao-anuncios', servico: SERVICOS.listings });
}
