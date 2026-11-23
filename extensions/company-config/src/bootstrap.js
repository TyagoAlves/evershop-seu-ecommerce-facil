import config from 'config';
import { addProcessor } from '@evershop/evershop/lib/util/registry';
import { merge } from '@evershop/evershop/lib/util/merge';
import { getCompanyData, readGeneratedCompany } from './company-config.js';

export default function bootstrap() {
  addProcessor('configurationSchema', (schema) => {
    merge(schema, {
      properties: {
        company: {
          type: 'object',
          properties: {
            slug: { type: 'string' },
            name: { type: 'string' },
            theme: { type: 'string' },
            domain: { type: 'string' }
          }
        }
      }
    });
    return schema;
  }, 20);

  // Tema: useAppState().config.company (mesmo seam de base/bootstrap.js:26).
  addProcessor('appConfig', (appConfig) => ({
    ...appConfig,
    company: getCompanyData()
  }), 20);

  const generated = readGeneratedCompany();
  if (generated) {
    const defaults = {};
    for (const key of ['slug', 'name', 'theme', 'domain']) {
      if (typeof generated[key] === 'string' && generated[key] !== '') {
        defaults[key] = generated[key];
      }
    }
    if (Object.keys(defaults).length > 0) {
      config.util.setModuleDefaults('company', defaults);
    }
  }
}
