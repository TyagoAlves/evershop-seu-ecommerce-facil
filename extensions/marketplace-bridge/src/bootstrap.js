/**
 * Bootstrap da extensão marketplace-bridge.
 *
 * A extensão permanece desativada por padrão em config/default.json. Mesmo
 * habilitada, nenhum job é registrado sem configuração de empresa explícita
 * com pelo menos um marketplace ativo. As importações dos serviços garantem
 * que os manipuladores da outbox fiquem registrados no processo web e no cron.
 */

import path from 'node:path';
import { registerJob } from '@evershop/evershop/lib/cronjob';

import { isEnabled, readMarketplaceConfig } from './lib/config.js';
import { agendarCron } from './crons/_shared/execucao.js';
import './services/reconcile.js';
import './services/sync-inventory.js';
import './services/sync-listings.js';
import './services/sync-orders.js';

const DEFAULTS = Object.freeze({
  listingsCron: '*/15 * * * *',
  ordersCron: '*/5 * * * *',
  inventoryCron: '*/10 * * * *',
  reconcileCron: '17 3 * * *'
});

const MERCADOS = Object.freeze(['mercadolivre', 'shopee']);

export default function () {
  const config = readMarketplaceConfig();
  const algumAtivo = MERCADOS.some((marketplace) => isEnabled(marketplace));
  if (!algumAtivo) return;

  const sync = config?.sync && typeof config.sync === 'object' && !Array.isArray(config.sync)
    ? config.sync
    : {};

  const jobs = [
    {
      name: 'marketplace-sync-listings',
      file: 'sync-listings.js',
      schedule: agendarCron(sync.listingsCron, DEFAULTS.listingsCron)
    },
    {
      name: 'marketplace-sync-orders',
      file: 'sync-orders.js',
      schedule: agendarCron(sync.ordersCron, DEFAULTS.ordersCron)
    },
    {
      name: 'marketplace-sync-inventory',
      file: 'sync-inventory.js',
      schedule: agendarCron(sync.inventoryCron, DEFAULTS.inventoryCron)
    },
    {
      name: 'marketplace-reconcile',
      file: 'reconcile.js',
      schedule: agendarCron(sync.reconcileCron, DEFAULTS.reconcileCron)
    }
  ];

  for (const job of jobs) {
    registerJob({
      name: job.name,
      resolve: path.resolve(import.meta.dirname, 'crons', job.file),
      schedule: job.schedule,
      enabled: true
    });
  }
}
