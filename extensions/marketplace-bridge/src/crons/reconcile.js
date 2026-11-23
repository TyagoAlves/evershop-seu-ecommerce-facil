/** Cron de reconciliação: somente registra divergências, sem escrita remota. */

import { executarCron, SERVICOS } from './_shared/execucao.js';

export default async function () {
  return executarCron({
    nome: 'reconciliacao-marketplaces',
    servico: SERVICOS.reconcile,
    incluirFila: false
  });
}
