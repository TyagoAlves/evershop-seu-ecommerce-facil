import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSku } from './normalize.js';

const DEFAULT_COMPANY_SLUG = 'loja-exemplo';
const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SUPPORTED_MARKETPLACES = ['mercadolivre', 'shopee'];

// Vale para src/ e dist/: os dois ficam um nível abaixo da raiz da extensão.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, '..', '..', '..', '..');

function getCompanySlug() {
  const raw = typeof process.env.COMPANY_SLUG === 'string' ? process.env.COMPANY_SLUG.trim() : '';
  if (raw === '') {
    return DEFAULT_COMPANY_SLUG;
  }

  // Slug inválido nunca deve atravessar diretórios: falha fechada.
  return SLUG_PATTERN.test(raw) ? raw : null;
}

function settingsFrom(config, marketplace) {
  if (!config || !SUPPORTED_MARKETPLACES.includes(marketplace)) {
    return null;
  }

  const marketplaces = config.marketplaces;
  if (!marketplaces || typeof marketplaces !== 'object' || Array.isArray(marketplaces)) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(marketplaces, marketplace)) {
    return null;
  }

  const settings = marketplaces[marketplace];
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : null;
}

/** Config não secreta da empresa ativa, ou null se ausente/ilegível/inválida. */
export function readMarketplaceConfig() {
  const slug = getCompanySlug();
  if (!slug) {
    return null;
  }

  const file = path.join(projectRoot, 'companies', `${slug}.marketplaces.json`);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    // Sem arquivo próprio, nenhuma integração fica habilitada.
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Config corrompida também é tratada como ausente.
  }
  return null;
}

/** Ajustes do marketplace na empresa ativa, ou null se não existir. */
export function getMarketplaceSettings(marketplace) {
  return settingsFrom(readMarketplaceConfig(), marketplace);
}

/** Só habilita quando a empresa e o marketplace estiverem explicitamente ativos. */
export function isEnabled(marketplace) {
  const config = readMarketplaceConfig();
  if (!config || config.enabled !== true) {
    return false;
  }

  const settings = settingsFrom(config, marketplace);
  return Boolean(settings && settings.enabled === true);
}

/**
 * Publicação permitida apenas com marketplace ativo, allowlist explícita
 * preenchida e SKU presente nessa allowlist (comparação normalizada).
 */
export function canPublish(marketplace, sku) {
  try {
    if (!isEnabled(marketplace)) {
      return false;
    }

    const settings = getMarketplaceSettings(marketplace);
    if (!settings || settings.publishAllowed !== true) {
      return false;
    }

    const allowlist = settings.publishSkus;
    if (!Array.isArray(allowlist) || allowlist.length === 0 || typeof sku !== 'string') {
      return false;
    }

    const normalizedSku = normalizeSku(sku);
    if (typeof normalizedSku !== 'string' || normalizedSku === '') {
      return false;
    }

    // Lista vazia nunca significa "todos os SKUs".
    return allowlist.some((item) => {
      if (typeof item !== 'string') {
        return false;
      }
      try {
        return normalizeSku(item) === normalizedSku;
      } catch {
        return false;
      }
    });
  } catch {
    // Qualquer falha de configuração ou normalização bloqueia a publicação.
    return false;
  }
}
