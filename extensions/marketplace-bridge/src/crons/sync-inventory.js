/** Cron de estoque: único ponto de entrada é `run({ marketplace, limit })`. */

import { executarCron, SERVICOS } from './_shared/execucao.js';

export default async function () {
  return executarCron({ nome: 'sincronizacao-estoque', servico: SERVICOS.inventory });
}
