import { createHash } from 'node:crypto';
import { MarketplaceError } from './errors.js';

// Versão do formato da chave: alterá-la cria uma nova geração de chaves.
const VERSAO_CHAVE = 'idempotencia-v1';

function erroDeValidacao(mensagem, marketplace) {
  return new MarketplaceError(mensagem, {
    code: 'VALIDACAO_IDEMPOTENCIA',
    ...(typeof marketplace === 'string' && marketplace.trim()
      ? { marketplace: marketplace.trim().toLowerCase() }
      : {})
  });
}

function textoPreenchido(valor) {
  return typeof valor === 'string' && valor.trim().length > 0;
}

/**
 * Normaliza uma parte da chave: remove acentos e caracteres de controle,
 * colapsa espaços e usa maiúsculas. A normalização é estável entre chamadas.
 */
export function normalizeKeyPart(valor) {
  if (valor == null) return '';
  return String(valor)
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function normalizeSkuPart(valor) {
  return normalizeKeyPart(valor).replace(/[^A-Z0-9._/\-]/g, '');
}

function canonico(valor, profundidade = 0) {
  if (valor == null) return null;
  if (profundidade > 20) return '[PROFUNDIDADE_EXCEDIDA]';
  if (Array.isArray(valor)) {
    return valor.map((item) => canonico(item, profundidade + 1));
  }
  if (typeof valor === 'object') {
    const objeto = {};
    for (const chave of Object.keys(valor).sort()) {
      objeto[chave] = canonico(valor[chave], profundidade + 1);
    }
    return objeto;
  }
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor === 'bigint') return valor.toString();
  if (typeof valor === 'function' || typeof valor === 'symbol') return null;
  return valor;
}

/** Hash SHA-256 determinístico de uma lista de partes já normalizadas. */
export function stableHash(partes) {
  const lista = Array.isArray(partes) ? partes : [partes];
  const conteudo = JSON.stringify(canonico(lista));
  return createHash('sha256').update(conteudo, 'utf8').digest('hex');
}

/**
 * Chave de idempotência determinística e estável.
 * Assinatura obrigatória: makeIdempotencyKey({ marketplace, operation, sku, externalId }).
 * `sellerId` é opcional e permite cumprir a regra marketplace + seller_id + sku
 * (ou + external_order_id) sem quebrar quem chama com apenas os quatro campos.
 */
export function makeIdempotencyKey({ marketplace, operation, sku, externalId, sellerId } = {}) {
  if (!textoPreenchido(marketplace)) {
    throw erroDeValidacao('Marketplace é obrigatório para gerar a chave de idempotência.');
  }
  if (!textoPreenchido(operation)) {
    throw erroDeValidacao('Operação é obrigatória para gerar a chave de idempotência.', marketplace);
  }

  const skuNormalizado = normalizeSkuPart(sku);
  const externoNormalizado = normalizeKeyPart(externalId);

  if (!skuNormalizado && !externoNormalizado) {
    throw erroDeValidacao(
      'Informe ao menos SKU ou identificador externo para gerar a chave de idempotência.',
      marketplace
    );
  }

  return stableHash([
    VERSAO_CHAVE,
    normalizeKeyPart(marketplace),
    normalizeKeyPart(sellerId),
    normalizeKeyPart(operation),
    skuNormalizado,
    externoNormalizado
  ]);
}

/** Violação de unicidade do PostgreSQL (23505) ou mensagem equivalente. */
export function isUniqueViolation(erro) {
  if (!erro) return false;
  if (erro.code === '23505') return true;
  const mensagem = typeof erro.message === 'string' ? erro.message.toLowerCase() : '';
  return (
    mensagem.includes('duplicate key') ||
    mensagem.includes('unique constraint') ||
    mensagem.includes('violates unique')
  );
}
