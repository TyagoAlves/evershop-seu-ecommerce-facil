import { SecretsMissingError } from './errors.js';

// Apenas os nomes da seção 4 da especificação. Nenhum valor real vive no código.
const SECRET_NAMES = Object.freeze([
  'MARKETPLACE_TOKEN_ENCRYPTION_KEY',
  'ML_APP_ID',
  'ML_CLIENT_SECRET',
  'ML_REDIRECT_URI',
  'ML_WEBHOOK_SECRET',
  'SHOPEE_PARTNER_ID',
  'SHOPEE_PARTNER_KEY',
  'SHOPEE_REDIRECT_URI',
  'SHOPEE_WEBHOOK_SECRET',
  'SHOPEE_ENV'
]);

// A chave de criptografia é comum: tokens de ambos os marketplaces ficam cifrados em repouso.
const REQUIRED_BY_MARKETPLACE = Object.freeze({
  mercadolivre: Object.freeze([
    'MARKETPLACE_TOKEN_ENCRYPTION_KEY',
    'ML_APP_ID',
    'ML_CLIENT_SECRET',
    'ML_REDIRECT_URI',
    'ML_WEBHOOK_SECRET'
  ]),
  shopee: Object.freeze([
    'MARKETPLACE_TOKEN_ENCRYPTION_KEY',
    'SHOPEE_PARTNER_ID',
    'SHOPEE_PARTNER_KEY',
    'SHOPEE_REDIRECT_URI',
    'SHOPEE_WEBHOOK_SECRET'
  ])
});

const REDACTED = '[REDACTED]';

/** Valor configurado para um nome conhecido, ou null se vazio/ausente. */
export function getSecret(name) {
  if (typeof name !== 'string' || !SECRET_NAMES.includes(name)) {
    return null;
  }

  const value = process.env[name];
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Devolve os segredos obrigatórios do marketplace ou lança SecretsMissingError.
 * A mensagem e a propriedade .missing listam somente os nomes ausentes.
 */
export function requireSecrets(marketplace) {
  const names = Object.prototype.hasOwnProperty.call(REQUIRED_BY_MARKETPLACE, marketplace)
    ? REQUIRED_BY_MARKETPLACE[marketplace]
    : null;

  if (!names) {
    const error = new SecretsMissingError(
      `Marketplace sem lista de segredos definida: ${String(marketplace)}.`
    );
    error.marketplace = marketplace;
    error.missing = [];
    throw error;
  }

  const values = {};
  const missing = [];
  for (const name of names) {
    const value = getSecret(name);
    if (value === null) {
      missing.push(name);
    } else {
      values[name] = value;
    }
  }

  if (missing.length > 0) {
    const error = new SecretsMissingError(
      `Segredos ausentes para ${marketplace}: ${missing.join(', ')}.`
    );
    error.marketplace = marketplace;
    error.missing = missing;
    throw error;
  }

  return values;
}

/** Texto seguro para logs: nunca devolve o valor original. */
export function redact(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  return REDACTED;
}
