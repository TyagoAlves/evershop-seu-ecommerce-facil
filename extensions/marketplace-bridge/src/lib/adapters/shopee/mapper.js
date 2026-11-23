// Mapeamento do catálogo EverShop para o payload de anúncio da Shopee BR.
// Nenhum preço é inferido: a única fonte é product.price, validada por pricing.js.

import { canPublish } from '../../config.js';
import { assertPublishablePrice, fromCents, toCents } from '../../pricing.js';
import { normalizeSku, normalizeText } from '../../normalize.js';
import { ConfigError, PriceNotAvailableError } from '../../errors.js';

const LIMITE_NOME = 120;
const LIMITE_DESCRICAO = 3000;

/** Normalização tolerante: falha de normalização nunca inventa um SKU. */
export function normalizeShopeeSku(value) {
  try {
    const sku = normalizeSku(value);
    return typeof sku === 'string' ? sku.trim() : '';
  } catch {
    return '';
  }
}

function safeText(value, limite) {
  try {
    const texto = normalizeText(value, limite);
    return typeof texto === 'string' ? texto.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Converte para reais com no máximo duas casas decimais. Centavos <= 0
 * bloqueiam o payload (evita transformar 0,001 em 0,00 publicável).
 */
export function formatBrPrice(value, campo) {
  const centavos = toCents(value);
  if (!Number.isSafeInteger(centavos) || centavos <= 0) {
    throw new PriceNotAvailableError(
      `${campo} inválido para a Shopee: o valor publicável deve ser maior que zero com duas casas decimais.`
    );
  }

  const numero = Number(fromCents(centavos).toFixed(2));
  if (!Number.isFinite(numero) || numero <= 0) {
    throw new PriceNotAvailableError(
      `${campo} inválido para a Shopee após o arredondamento para duas casas.`
    );
  }
  return numero;
}

/**
 * categoryMap é obrigatório. Uma entrada com categoryId null/não configurado
 * bloqueia o SKU — nunca publicamos em categoria inventada.
 */
export function resolveShopeeCategoryId(sku, settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new ConfigError(
      `Configuração da Shopee ausente; categoryMap não pode validar o SKU ${sku}.`,
      { code: 'SHOPEE_CONFIG_MISSING', marketplace: 'shopee' }
    );
  }

  if (settings.region && settings.region !== 'BR') {
    throw new ConfigError(
      'A integração Shopee deve usar region BR.',
      { code: 'SHOPEE_REGION_INVALID', marketplace: 'shopee' }
    );
  }

  const mapa = settings.categoryMap;
  if (!Array.isArray(mapa) || mapa.length === 0) {
    throw new ConfigError(
      `categoryMap da Shopee vazio; o SKU ${sku} não pode ser publicado.`,
      { code: 'SHOPEE_CATEGORY_MAP_EMPTY', marketplace: 'shopee' }
    );
  }

  const entradas = mapa.filter(
    (entrada) => entrada && typeof entrada === 'object' && !Array.isArray(entrada)
  );

  // Primeiro casa exata por sku; depois o prefixo mais específico.
  const exata = entradas.find((entrada) => {
    const entradaSku = normalizeShopeeSku(entrada.sku);
    return entradaSku !== '' && entradaSku === sku;
  });

  let escolhida = exata ?? null;
  if (!escolhida) {
    const porPrefixo = entradas
      .map((entrada) => ({ entrada, prefixo: normalizeShopeeSku(entrada.skuPrefix) }))
      .filter((item) => item.prefixo !== '' && sku.startsWith(item.prefixo))
      .sort((a, b) => b.prefixo.length - a.prefixo.length);
    escolhida = porPrefixo[0]?.entrada ?? null;
  }

  if (!escolhida) {
    throw new ConfigError(
      `Categoria da Shopee não configurada para o SKU ${sku}.`,
      { code: 'SHOPEE_CATEGORY_UNMAPPED', marketplace: 'shopee' }
    );
  }

  const bruto = escolhida.categoryId;
  const categoria = Number(bruto);
  if (
    bruto === null || bruto === undefined || bruto === '' ||
    !Number.isSafeInteger(categoria) || categoria <= 0
  ) {
    throw new ConfigError(
      `Categoria da Shopee inválida (null ou não configurada) para o SKU ${sku}.`,
      { code: 'SHOPEE_CATEGORY_NULL', marketplace: 'shopee' }
    );
  }

  return categoria;
}

/**
 * Mesmo com itemStatusDefault "NORMAL", sem canPublish o anúncio permanece
 * UNLIST. O padrão é UNLIST.
 */
export function resolveItemStatus(sku, settings) {
  const configurado = settings && typeof settings === 'object'
    ? settings.itemStatusDefault
    : null;
  const status = configurado === 'NORMAL' ? 'NORMAL' : 'UNLIST';

  if (status === 'NORMAL' && !canPublish('shopee', sku)) {
    return 'UNLIST';
  }
  return status;
}

function configuredImages(product, settings, sku) {
  const origens = [
    product?.shopeeImageIds,
    product?.imageIds,
    settings?.imageIdMap?.[sku],
    settings?.imageIdMap?.[product?.sku]
  ];

  for (const origem of origens) {
    if (!Array.isArray(origem)) {
      continue;
    }
    const ids = origem
      .map((valor) => String(valor).trim())
      .filter((valor) => /^\d{1,40}$/.test(valor));
    if (ids.length > 0) {
      // image_id é obtido via upload de imagem; nunca é inventado aqui.
      return ids.map((image_id) => ({ image_id }));
    }
  }
  return null;
}

function configuredAttributes(product, settings, sku) {
  const brutos = [];

  if (Array.isArray(settings?.attributeMap)) {
    const entrada = settings.attributeMap.find(
      (item) => item && typeof item === 'object' && normalizeShopeeSku(item.sku) === sku
    );
    if (entrada && Array.isArray(entrada.attributes)) {
      brutos.push(...entrada.attributes);
    }
  }
  if (Array.isArray(product?.attributes)) {
    brutos.push(...product.attributes);
  }

  const atributos = [];
  for (const bruto of brutos) {
    if (!bruto || typeof bruto !== 'object') {
      continue;
    }
    const id = Number(bruto.attribute_id ?? bruto.id);
    const valor = typeof bruto.attribute_value === 'string'
      ? bruto.attribute_value
      : (typeof bruto.value_name === 'string' ? bruto.value_name : '');
    if (Number.isSafeInteger(id) && id > 0 && valor.trim() !== '') {
      atributos.push({ attribute_id: id, attribute_value: valor.trim().slice(0, 500) });
    }
  }
  return atributos.length > 0 ? atributos : null;
}

function configuredWeight(product, settings, sku) {
  // product.weight do EverShop não tem unidade garantida: só usamos valores
  // explicitamente configurados como gramas. Nenhuma conversão é inventada.
  const candidatos = [
    product?.weightGrams,
    settings?.weightMap?.[sku],
    settings?.weightMap?.[product?.sku]
  ];
  for (const candidato of candidatos) {
    const numero = Number(candidato);
    if (Number.isFinite(numero) && numero > 0 && numero <= 1000000) {
      return Math.round(numero * 1000) / 1000;
    }
  }
  return null;
}

/**
 * Gera o corpo de v2.product.add_item / update_item.
 * @param {object} product produto normalizado do catálogo
 * @param {object|null} settings ajustes não secretos da empresa para Shopee
 * @returns {object} payload pronto para a API
 * @throws {PriceNotAvailableError} se product.price <= 0, nulo ou inválido
 * @throws {ConfigError} se SKU, nome ou categoryMap não estiverem configurados
 */
export function mapProductToPayload(product, settings) {
  // A validação de preço vem primeiro: preço indisponível bloqueia antes de
  // qualquer outra regra e antes de chamar a API.
  const preco = assertPublishablePrice(product);

  if (!product || typeof product !== 'object' || Array.isArray(product)) {
    throw new ConfigError(
      'Produto inválido para mapeamento na Shopee.',
      { code: 'SHOPEE_PRODUCT_INVALID', marketplace: 'shopee' }
    );
  }

  const sku = normalizeShopeeSku(product.sku);
  if (sku === '') {
    throw new ConfigError(
      'SKU obrigatório para criar o anúncio na Shopee.',
      { code: 'SHOPEE_SKU_MISSING', marketplace: 'shopee' }
    );
  }

  const nome = safeText(product.name, LIMITE_NOME);
  if (nome === '') {
    throw new ConfigError(
      'Nome do produto obrigatório para criar o anúncio na Shopee.',
      { code: 'SHOPEE_NAME_MISSING', marketplace: 'shopee' }
    );
  }

  const descricao = safeText(
    product.description || product.shortDescription || '',
    LIMITE_DESCRICAO
  ) || nome;

  const categoryId = resolveShopeeCategoryId(sku, settings);
  const precoBr = formatBrPrice(preco, 'price');
  // original_price não é preço "de" inventado: usa a mesma fonte autorizada.
  const originalBr = formatBrPrice(preco, 'original_price');
  const itemStatus = resolveItemStatus(sku, settings);

  // catalog.js devolve stockAvailability como booleano; a forma textual é
  // aceita apenas para compatibilidade com chamadores antigos.
  const semEstoque = product.manageStock === false ||
    product.stockAvailability === false ||
    product.stockAvailability === 'OUT_OF_STOCK';
  const quantidadeBruta = semEstoque ? 0 : Number(product.qty);
  const stock = Number.isFinite(quantidadeBruta) && quantidadeBruta > 0
    ? Math.floor(quantidadeBruta)
    : 0;

  const payload = {
    name: nome,
    description: descricao,
    item_type: 'NORMAL',
    category_id: categoryId,
    item_sku: sku,
    price: precoBr,
    original_price: originalBr,
    stock,
    item_status: itemStatus
  };

  const imagens = configuredImages(product, settings, sku);
  if (imagens) {
    payload.images = imagens;
  }

  const atributos = configuredAttributes(product, settings, sku);
  if (atributos) {
    payload.attributes = atributos;
  }

  const peso = configuredWeight(product, settings, sku);
  if (peso !== null) {
    payload.weight = peso;
  }

  return payload;
}
